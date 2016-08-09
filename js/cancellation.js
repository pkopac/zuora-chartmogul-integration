"use strict";

var logger = require("log4js").getLogger("cancellation"),
    VError = require("verror"),
    _ = require("lodash"),
    moment = require("moment");

exports.DEFAULT_UNPAID_TO_CANCEL_MONTHS = 2;
exports.DEFAULT_NO_RENEWAL_TO_CANCEL_MONTHS = 2;

var Cancellation = function () {
    this.unpaidToCancelMonths = exports.DEFAULT_UNPAID_TO_CANCEL_MONTHS;
    this.noRenewalToCancelMonths = exports.DEFAULT_NO_RENEWAL_TO_CANCEL_MONTHS;
};

Cancellation.prototype.configure = function (json) {
    if (!json) {
        return;
    }
    if (json.unpaidToCancelMonths !== undefined) {
        this.unpaidToCancelMonths = json.unpaidToCancelMonths;
    }
    if (json.noRenewalToCancelMonths !== undefined) {
        this.noRenewalToCancelMonths = json.noRenewalToCancelMonths;
    }
};

/**
 * If invoice only removed relevant products, it means it very probably downgraded the customer to Free or canceled
 * the subscription. In any case, the customer has practically canceled.
 * The problem is the downgrade is really a cancel and if we want to track it as such,
 * we have to omit the downgrage and cancel the previous invoice with item matching the subscription.
 *
 * Another problem is the invoices which stay unpaid in the system for months.
 *
 * Also, there are customers who got some subscription and then were downgraded to zero/Free, but there was neither
 * a cancellation nor $0 invoice. Just no more invoices.
 */
Cancellation.prototype.cancelInvoices = function(invoices) {
    var mToday = moment.utc().startOf("day");

    /* These methods mutate the invoices object, including individual invoice[s]. */
    this._downgradeAsCancel(invoices);

    this._cancelLongDueInvoices(invoices, mToday);

    this._cancelNonrenewedSubscriptions(invoices, mToday);

    return this._removeMetadata(invoices);
};

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
Cancellation.prototype._downgradeAsCancel = function(invoices) {
    var cancellationInvoices = [];
    for (var i = 0; i < invoices.length; i++) {
        var invoice = invoices[i],
            isVoid = invoice.line_items.every(item => // transfer to Free
                !item.amount_in_cents && !item.discount_amount_in_cents && !item.prorated),
            isRefund = invoice.line_items.every(item =>
                item.__amendmentType === "RemoveProduct" &&
                item.amount_in_cents <= 0 && // can be 0, because of adjustments
                item.discount_amount_in_cents === 0); // typically there's no discount on cancellation (makes no sense)

        logger.trace("%s %s %s", invoice.external_id, isVoid, isRefund);

        /* Classification of cancelation invoices */
        if (isRefund || isVoid) {
            try {
                invoices.splice(i--, 1); // throw away cancelation invoice
                invoice.__isRefund = isRefund;
                cancellationInvoices.push(invoice);
            } catch (err) {
                throw new VError(err, "Couldn't process cancellation invoice " + invoice.external_id);
            }
        }
    }

    // This operation possibly changes invoices array by dropping further invoices
    cancellationInvoices.forEach(invoice =>
        this._processCancellations(invoice, invoices));

    return invoices;
};

/**
 * Example: there's an invoice for $10 monthly, but old and nothing new since then.
 * We don't want that in MRR, because the customer in reality churned
 * into Free plan without invoice or something similar.
 */
Cancellation.prototype._cancelNonrenewedSubscriptions = function (invoices, mToday) {
    var subs2Processed = {},
        self = this;
    invoices.slice().reverse() // shallow copy, traversing from the last invoice, changing the invoices
        .forEach(invo => {
            var items = invo.line_items.slice().reverse();
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (!subs2Processed[item.subscription_external_id]) {
                    var mEndOfPeriod = moment.utc(item.service_period_end);
                    if (!item.cancelled_at && mToday.diff(mEndOfPeriod, "month")
                                >= self.noRenewalToCancelMonths) {
                        // if too long no renew invoice -> cancel
                        item.cancelled_at = mEndOfPeriod.add(1, "second").toDate();
                    }
                    subs2Processed[item.subscription_external_id] = item.cancelled_at || item.service_period_end;
                }
            }
        });
    return invoices;
};

/**
 * Unpaid invoice more than X months -> cancel subscriptions.
 * Under normal circumstances such accounts should be dealt with by sales retention process.
 */
Cancellation.prototype._cancelLongDueInvoices = function (invoices, mToday) {
    for (var i = 0; i < invoices.length; i++) {
        var invoice = invoices[i],
            invoiceTotal = Math.round(invoice.line_items.reduce(
                            (prev, item) => prev + item.amount_in_cents, 0));
        if (invoice.__balance === undefined) {
            throw new VError("Missing metadata __balance!");
        }
        if (invoiceTotal > 0 && invoice.__balance > 0 && // has outstanding balance
                // has been unpaid for 2 or more months over due
                mToday.diff(moment.utc(invoice.due_date), "month") >= this.unpaidToCancelMonths &&
                // has uncancelled items
                invoice.line_items.some(i => !i.cancelled_at)) {

            var bySub = _.groupBy(invoice.line_items, "subscription_external_id");

            //TODO: use this advances thing in _processCancellations, too, because there's something very similar.
            // Per subscription adds cancel date if not there already and
            // removes any further items, so there's not false reactivation.
            Object.keys(bySub).forEach(sub => {
                var cancellable = _.sortBy(bySub[sub].filter(i => i.amount_in_cents >= 0), "service_period_start"),
                    removeMap = {};
                if (!cancellable[0].cancelled_at) {
                    cancellable[0].cancelled_at = cancellable[0].service_period_start;
                }
                cancellable.shift();
                cancellable.forEach(c => removeMap[c.external_id] = true);
                invoice.line_items = invoice.line_items.filter(i => !removeMap[i.external_id]);
            });
        }
    }
    return invoices;
};

/**
 * Here, match cancellations onto previous invoices (sorted by numbers, which increment in time).
 * If no match can be found, something is wrong. Either unexpected invoice structure or cancelling something non-existing.
 */
Cancellation.prototype._processCancellations = function(invoice, invoices) {
    var isRefund = invoice.__isRefund,
        bySub = _.groupBy(invoice.line_items.filter(item => !isRefund || item.amount_in_cents || item.__amendmentType === "RemoveProduct"), "subscription_external_id");

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
Cancellation.prototype._removeMetadata = function(invoices) {
    return invoices.map(invoice => {
        delete invoice.__balance;
        invoice.line_items.forEach(i =>
            delete i.__amendmentType
        );
        return invoice;
    });
};

exports.Cancellation = Cancellation;
