"use strict";

var logger = require("log4js").getLogger("cancellation"),
    Splitter = require("./splitter.js").Splitter,
    VError = require("verror"),
    _ = require("lodash"),
    moment = require("moment");

var Cancellation = {}; // only static methods, not state

/**
 * If invoice only removed relevant products, it means it very probably
 * downgraded the customer to Free or canceled the subscription.
 * In any case, the customer has practically canceled.
 * The problem is the downgrade is really a cancel and if we want to track it as such,
 * we have to omit the downgrage and cancel the previous invoice with item matching the subscription.
 */
Cancellation.cancelInvoices = function(invoices) {
    for (var i = 0; i < invoices.length; i++) {
        var invoice = invoices[i];

        /* Classification of cancelation invoices */
        if (invoice.line_items.every(
                item => item.__amendmentType === "RemoveProduct" &&
                item.amount_in_cents < 0)
            ) {

            logger.trace("Cancellation invoice: " + invoice.external_id);

            try {
                invoices.splice(i, 1); // throw away cancelation invoice
                Cancellation._findAndProcessCancellations(invoice, invoices, i);

            } catch (err) {
                throw new VError(err, "Couldn't process cancellation invoice " + invoice.external_id);
            }
        }
    }

    return Cancellation._removeMetadata(invoices);
};

/**
 * Here, match cancellations onto previous invoices (sorted by numbers, which increment in time).
 * If no match can be found, something is wrong. Either unexpected invoice structure or cancelling something non-existing.
 */
Cancellation._findAndProcessCancellations = function(invoice, invoices, i) {
    var toAdd = [];

    // Only take the last cancelation per subscription to prevent UP and DOWN jumps in MRR
    var bySub = _.groupBy(invoice.line_items.filter(item => item.amount_in_cents), "subscription_external_id");
    var cancelationItems = Object.keys(bySub).map(sub => _.sortBy(bySub[sub], "service_period_start").reverse()[0]);

    for (var j = 0; j < cancelationItems.length; j++) {
        var cancelItem = cancelationItems[j];

        // find closest previous invoice by subscription ID
        var searchedSubscription = cancelItem.subscription_external_id,
            toProcessInvoice = null,
            toProcessItems = null,
            canBeSplitted = false;

        for (var k = i - 1; k >= 0; k--) {
            if (invoices[k].line_items.every(i => i.__processed)) {
                continue;
            }
            // On one invoice, there can be multiple subscriptions canceled
            toProcessItems = invoices[k].line_items
                                .filter(item => item.__amendmentType !== "RemoveProduct")
                                .filter(i => !i.__processed)
                                .filter(item => item.subscription_external_id === searchedSubscription);
            if (toProcessItems.length > 0) {
                toProcessItems.forEach(i => i.__processed = true);
                toProcessInvoice = invoices[k];

                if (toProcessItems.length === toProcessInvoice.line_items.length) {
                    canBeSplitted = true; // how to split invoice, but only some items? not implemented
                }

                break;
            }
        }

        if (!toProcessInvoice) {
            throw new VError("Couldn't find invoice by subscription ID " + searchedSubscription +
                                " to cancel with " + invoice.external_id);
        }

        var result = Cancellation._resolveCancellation(toProcessInvoice, toProcessItems, cancelItem, canBeSplitted);
        if (result === true) { // process again
            j--;
        } else if (typeof result === "object") { // new invoice created by splitting
            toAdd.push({k, newInvoice: result});
        }
    }

    if (toAdd.length) { // adding after cycle, so the index doesn't get screwed
        toAdd.forEach(a => invoices.splice(a.k + 1, 0, a.newInvoice));
    }
};

/**
 * This function gets the found match and tries to apply possible cancellation ways.
 */
Cancellation._resolveCancellation = function(toProcessInvoice, toProcessItems, cancelItem, canBeSplitted) {
    var totalThatCanBeCanceled = toProcessItems.reduce((sum, next) => sum + next.amount_in_cents, 0),
        refundedAmount = cancelItem.amount_in_cents,
        // HACK: Chartmogul goes haywire if canceled on the same day :/
        splitDate = moment.utc(cancelItem.service_period_start).add(1, "day").toDate();

    logger.debug("cancellation: totalThatCanBeCanceled %d, refundedAmount %d", totalThatCanBeCanceled, refundedAmount);

    // Cancel the subscription.
    toProcessItems.forEach(i => i.cancelled_at = splitDate);

    /* Handling some edge cases. */
    // 1) several invoices with monthly payments canceled by one invoice with a total of them
    if (totalThatCanBeCanceled < -refundedAmount) {
        cancelItem.amount_in_cents += totalThatCanBeCanceled;
        return true; //process the rest in the next pass

    // 2) only partially canceled & split by date. Useful, so we get the cancellation date correct.
    } else if (canBeSplitted &&
                totalThatCanBeCanceled > -refundedAmount &&
                toProcessItems.length === 1 &&
                toProcessItems[0].service_period_start < splitDate && splitDate < toProcessItems[0].service_period_end) {

        try {
            var newInvoice = Splitter.splitInvoice(toProcessInvoice, -refundedAmount, splitDate);
            newInvoice.line_items.forEach(item => item.cancelled_at = splitDate);
            return newInvoice;
        } catch (err) {
            logger.warn("Couldn't split canceled invoice. Canceling subscription on it.");
        }
    }
    // note: if nothing previous matched, the previous invoice is simply canceled and that's it
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
