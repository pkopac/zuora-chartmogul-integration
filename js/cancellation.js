"use strict";

var logger = require("log4js").getLogger("cancellation"),
    VError = require("verror"),
    _ = require("lodash"),
    moment = require("moment");

var Cancellation = {}; // only static methods, not state

/*
 1) Invoice with prorated credit -amount and no replacement (is different to +10 -11 for example)
    a) invoice has just one term
       -> find previous invoice with term containing the start of service refund item -> add cancel date
    b) invoice has multiple terms
       -> find the first invoice, cancel it, remove the following up to what was canceled
    c) invoice has multiple subscriptions and multiple terms
       -> solve on per-subscription basis
    d) invoice has one item, but it cancels multiple items in the past

*/

/**
 * If invoice only removed relevant products, it means it very probably
 * downgraded the customer to Free or canceled the subscription.
 * In any case, the customer has practically canceled.
 * The problem is the downgrade is really a cancel and if we want to track it as such,
 * we have to omit the downgrage and cancel the previous invoice with item matching the subscription.
 */
Cancellation.cancelInvoices = function(invoices) {
    var cancellationInvoices = [];
    for (var i = 0; i < invoices.length; i++) {
        var invoice = invoices[i],
            isVoid = invoice.line_items.every(item => // transfer to Free
                !item.amount_in_cents && !item.discount_amount_in_cents),
            isRefund = invoice.line_items.every(item =>
                item.__amendmentType === "RemoveProduct" &&
                item.amount_in_cents < 0);

        logger.trace("%s %s %s", invoice.external_id, isVoid, isRefund);

        /* Classification of cancelation invoices */
        if (isRefund || isVoid) {
            try {
                invoices.splice(i, 1); // throw away cancelation invoice
                invoice.__isRefund = isRefund;
                cancellationInvoices.push(invoice);
            } catch (err) {
                throw new VError(err, "Couldn't process cancellation invoice " + invoice.external_id);
            }
        }
    }

    // This operation possibly changes invoices array by dropping further invoices
    cancellationInvoices.forEach(invoice =>
        Cancellation._processCancellations(invoice, invoices));

    return Cancellation._removeMetadata(invoices);
};

/**
 * Here, match cancellations onto previous invoices (sorted by numbers, which increment in time).
 * If no match can be found, something is wrong. Either unexpected invoice structure or cancelling something non-existing.
 */
Cancellation._processCancellations = function(invoice, invoices) {
    var isRefund = invoice.__isRefund,
        bySub = _.groupBy(invoice.line_items.filter(item => !isRefund || item.amount_in_cents), "subscription_external_id");

    logger.debug("Processing %s cancellation invoice...", invoice.external_id);

    Object.keys(bySub).forEach(subscription => {
        var items = _.sortBy(bySub[subscription], "service_period_start"),
            canceled = false;

        for (var y = 0; y < items.length; y++) {
            var cancelItem = items[y],
                found = false;

            // Go through previous invoices
            for (var k = 0; k < invoices.length && invoices[k].external_id < invoice.external_id; k++) {
                var changedInvoice = invoices[k];
                var cancellable = changedInvoice.line_items
                    .filter(item => item.subscription_external_id === subscription)
                    .filter(item => item.__amendmentType !== "RemoveProduct");

                logger.trace("First: %s", invoices[k].external_id, cancellable);
                if (isRefund) { // prorated refund
                    cancellable = cancellable.filter(i => // matching period?
                        moment.utc(i.service_period_end) >= moment.utc(cancelItem.service_period_start) &&
                        moment.utc(i.service_period_end) <= moment.utc(cancelItem.service_period_end)
                    );
                }
                // _.sortBy(cancellable, "service_period_start");

                logger.trace("Second: %s", invoices[k].external_id, cancellable);
                if (cancellable.length) { // we found the items to cancel
                    var canceledItems = [];
                    cancellable.forEach(item => {
                        item.cancelled_at = cancelItem.service_period_start;
                        cancelItem.amount_in_cents += item.amount_in_cents;
                        canceledItems.push(item.external_id);
                    });
                    logger.trace(canceledItems);
                    if (!canceled) {
                        canceledItems.shift(); // shift the first item away
                    }
                    // remove the rest of the items, they would result in reactivation!
                    changedInvoice.line_items = changedInvoice.line_items
                        .filter(i => canceledItems.indexOf(i.external_id) < 0);

                    // no items -> remove
                    if (!changedInvoice.line_items.length) {
                        invoices.splice(k, 1);
                    }
                    found = true;
                    canceled = true;
                    // void or everything refunded?
                    if (!isRefund || cancelItem.amount_in_cents >= 0) {
                        break;
                    }
                }
            }

            // We didn't cancel... or did, but not for enough amount... but that can actually happen... what's next? :(
            if (isRefund) {
                if (cancelItem.amount_in_cents < 0) {
                    logger.warn("Couldn't apply all of refund, maybe wrong adjustment on invoices?"+
                        " Invoice ID: %s Subscription: %s, missing amount: %d",
                        invoice.external_id, subscription, cancelItem.amount_in_cents);
                }
                if (!found) {
                    throw new VError("Couldn't find invoice by subscription ID " + subscription +
                                        " to cancel with " + invoice.external_id);
                }
            }
        }
    });
};

/**
 * Since these "private" metadata are only for the need of this module,
 * we must remove them before the data is sent to Chartmogul.
 */
Cancellation._removeMetadata = function(invoices) {
    return invoices.map(invoice => {
        delete invoice.__processed;
        invoice.line_items.forEach(i =>
            delete i.__amendmentType
        );
        return invoice;
    });
};

exports.Cancellation = Cancellation;
