"use strict";

var logger = require("log4js").getLogger("invoiceBuilder"),
    VError = require("verror"),
    // _ = require("lodash"),
    moment = require("moment"),
    ItemsBuilder = require("./itemsBuilder.js").ItemsBuilder,
    Invoice = require("./importer.js").Invoice;

var InvoiceBuilder = function() {

};

/* These constants are definitely company-specific and maybe should be refactored
 * out into config file. */

InvoiceBuilder.MONTHS_UNPAID_TO_CANCEL = 2;

InvoiceBuilder.CURRENCY = {
    // AQuA vs CSV Export
    USD: "USD", // "US Dollar": "USD",
    EUR: "EUR" // "Euro": "EUR"
};

InvoiceBuilder.getCurrency = function(zuoraCurrency) {
    var result = InvoiceBuilder.CURRENCY[zuoraCurrency];
    if (!result) {
        throw new VError("Unknown currency from Zuora: " + zuoraCurrency);
    }
    return result;
};

InvoiceBuilder.buildInvoice = function(invoiceNumber, invoiceItems, postedDate,
    dueDate, currency, itemAdjs, invoiceAdjs, creditAdjs, payments, refunds,
    plansById) {
    try {
        if (!postedDate) {
            throw new VError("postedDate " + postedDate);
        }
        if (!dueDate) {
            throw new VError("dueDate " + dueDate);
        }
        // TODO: Currency per account! If currency changes, this might be wrong.
        var invoice = new Invoice(
            invoiceNumber,
            moment.utc(postedDate),
            InvoiceBuilder.getCurrency(currency),
            moment.utc(dueDate)
        );

        InvoiceBuilder.addInvoiceItems(
            invoiceItems,
            invoice,
            itemAdjs,
            invoiceAdjs,
            creditAdjs,
            plansById
        );

        let totalPayments = InvoiceBuilder.addPayments(payments,
            invoice,
            "Payment");

        let totalRefunds = InvoiceBuilder.addPayments(refunds,
            invoice,
            "Refund");

        var totalCreditAdjusted = InvoiceBuilder.testCreditAdjustmentCorrect(invoice, creditAdjs, totalPayments, totalRefunds);

        //HACK: chartmogul doesn't allow partial refunds, let's ignore them :(
        //TODO: there are multiple cases when this can happen - can be an error, a late discount done wrong etc.
        InvoiceBuilder.removePartialRefunds(invoice, totalPayments, totalRefunds, totalCreditAdjusted);

        /* 0 amount, 0 quantity doesn't change MRR or anything, so no point in keeping that.
         * Downgrade must be prorated with negative amount or unprorated with lower (not 0) amount.
         * Cancel must be "cancelled_at" date. */
        invoice.line_items = invoice.line_items.filter(line_item =>
             line_item.discount_amount_in_cents ||
             line_item.amount_in_cents ||
             line_item.quantity
        );

        return invoice;
    } catch (error) {
        logger.debug(error.stack);
        throw new VError(error, "Couldn't build invoice " + invoiceNumber);
    }
};

InvoiceBuilder.removePartialRefunds = function(invoice, totalPayments, totalRefunds, totalCreditAdjusted) {
    if (totalPayments === 0 && totalRefunds === 0) {
        return; // nothing paid or refunded
    }

    var invoiceTotal = Math.round(invoice.line_items.reduce(
                        (prev, item) => prev + item.amount_in_cents, 0));

    if (invoiceTotal === totalPayments &&
        (totalPayments === totalRefunds || totalRefunds === 0) &&
        totalCreditAdjusted === 0) {
        return; // is paid and optionally refunded (both in full)
    }

    // partial refund => ignore
    var clearPayment = totalPayments - totalRefunds + totalCreditAdjusted;
    if (clearPayment !== 0 && clearPayment === invoiceTotal) {
        invoice.transactions = invoice.transactions.filter(t => t.type === "payment");
        return;
    }

    if (invoiceTotal === 0 && totalPayments - totalRefunds === 0) {
        logger.warn("Invoice was adjusted to 0 and refunded.");
        return;
    }

    throw new VError("Unexpected payment case: invoiceTotal %d, totalPayments %d, totalRefunds %d, totalCreditAdjusted %d, clearPayment %d",
        invoiceTotal, totalPayments, totalRefunds, totalCreditAdjusted, clearPayment);
};


/**
 * Credit adjustment behaves as payment, it just doesn't go anywhere, so
 * it doesn't affect cashflow. But we should still check it's correct.
 * TODO: what with partially adjusted/paid/refunded invoices?
 */
InvoiceBuilder.testCreditAdjustmentCorrect = function(invoice, creditAdjs, totalPayments, totalRefunds) {
    let creditAdjusted = InvoiceBuilder.processCreditAdjustments(creditAdjs),
        invoiceTotal = Math.round(invoice.line_items.reduce(
                            (prev, item) => prev + item.amount_in_cents, 0)),
        successfulTransactions = invoice.transactions.filter((tr) => tr.result === "successful").length;

    if (creditAdjusted) {
        creditAdjusted = Math.round(-creditAdjusted * 100);
        if (totalPayments || totalRefunds) {
            //TODO: if we want correct cash flow in Chartmogul, we'd need to
            // split the invoice, because CM doesn't allow partial payment.
            logger.warn("Invoice has both payments/refunds and credit adjustment! Cashflow incorrect.");
            return creditAdjusted;
        }
        if (creditAdjusted !== invoiceTotal) { // outstanding balance = yet unpaid
            logger.warn("Credit adjusted, but not the same as invoice amount! " +
                "creditAdjusted !== invoiceTotal: %d !== %d", creditAdjusted, invoiceTotal);
        } else if(successfulTransactions) {
            throw new VError("Partially refunded/paid and credit adjusted!");
        }
    }
    return creditAdjusted;
};

//TODO: refactor to a separate module for payments & refunds
/**
 * @param type Refund|Payment
 */
InvoiceBuilder.addPayments = function(zuoraPayments, invoice, type) {
    if (!zuoraPayments || !zuoraPayments.length) {
        return 0;
    }
    var total = 0;

    zuoraPayments.forEach(function (payment) {
        try {
            var p = payment[type];
            var transaction = {
                date: moment.utc(p.CreatedDate || p.RefundDate),
                type: type.toLowerCase(),
                result: p.Status === "Processed" ? "successful" : "failed",
                // because one payment number can be assigned to multiple invoices
                external_id: (type === "Payment" ? p.PaymentNumber : p.RefundNumber) + "-" + payment.Invoice.InvoiceNumber
            };

            if (transaction.result === "successful") {
                let amount;
                if (type === "Payment") {
                    amount = payment.InvoicePayment.Amount;
                } else if (type === "Refund") {
                    amount = (payment.RefundInvoicePayment || payment.CreditBalanceAdjustment).RefundAmount;
                }
                total += amount * 100; //for debug
            }

            invoice.addTransaction(transaction);
        } catch (error) {
            logger.trace(payment);
            throw new VError(error, "Invalid payment");
        }
    });

    return Math.round(total);
};

InvoiceBuilder.addInvoiceItems = function(invoiceItems, invoice, adjustments, invoiceAdjustments, creditAdjustments, plans) {

    // logger.trace("adjustments", adjustments);
    // logger.trace("invoiceAdjustments", invoiceAdjustments);
    // logger.trace("creditAdjustments", creditAdjustments);

    var processedAdjustments = InvoiceBuilder.processAdjustments(adjustments),
        adjustmentMap = processedAdjustments[0],
        itemAdjustmentAmountTotal = processedAdjustments[1],
        invoiceAdjustmentAmount = InvoiceBuilder.processInvoiceAdjustments(invoiceAdjustments),
        discountMap = InvoiceBuilder.processDiscounts(invoiceItems);

    var processedLineItems = InvoiceBuilder.itemsForInvoice(invoiceItems,
        invoiceAdjustmentAmount,
        discountMap,
        adjustmentMap,
        plans);

    logger.trace("adjustmentMap", adjustmentMap);
    InvoiceBuilder.testTotalOfInvoiceEqualsTotalOfLineItems( // runtime sanity check
        invoiceItems[0], processedLineItems, itemAdjustmentAmountTotal, invoiceAdjustmentAmount);

    InvoiceBuilder.cancelLongDueInvoices(invoiceItems[0], processedLineItems);

    processedLineItems
        .forEach(invoice.addLineItem.bind(invoice));

    return invoice;
};

InvoiceBuilder.testTotalOfInvoiceEqualsTotalOfLineItems = function (
    firstItem, items, itemAdjustmentAmountTotal, invoiceAdjustmentAmount) {
    var shouldBeTotal = Math.round((firstItem.Invoice.Amount + itemAdjustmentAmountTotal + invoiceAdjustmentAmount) * 100),
        total = items.reduce(function (prev, cur) {
            return prev + cur.amount_in_cents;
        }, 0);
    if (total !== shouldBeTotal) {
        logger.debug(items);
        logger.error("line items: %d, input: %d = (invoice amount: %d + item adj. total: %d + invoice adj. total: %d) * 100",
            total, shouldBeTotal, firstItem.Invoice.Amount, itemAdjustmentAmountTotal, invoiceAdjustmentAmount);

        throw new VError("Total of line items not the total of invoice!");
    }
};

/**
 * HACK: unpaid invoice more than X months -> cancel subscriptions.
 * Under normal circumstances such accounts should be dealt with by sales
 * retention process.
 */
InvoiceBuilder.cancelLongDueInvoices = function (firstItem, positiveItems) {
    if (firstItem.Invoice.Amount > 0 &&
            firstItem.Invoice.Balance > 0 &&
            moment().diff(moment.utc(firstItem.Invoice.DueDate), "month") >= InvoiceBuilder.MONTHS_UNPAID_TO_CANCEL &&
            !positiveItems[0].cancelled_at) {

        positiveItems.forEach(function (item) {
            item.cancelled_at = positiveItems
                .filter(i => i.amount_in_cents > 0)[0]
                .service_period_start;
        });
    }
};

InvoiceBuilder.itemsForInvoice = function(invoiceItems,
    invoiceAdjustmentAmount,
    discountMap, adjustmentMap, plans) {

    var charged = [],
        usersProration = [],
        proratedUsersCredit = [],
        proratedStorageCredit = [];

    invoiceItems
    .filter(item => item.InvoiceItem.ChargeAmount) // ignore 0 charges
    .forEach(function(item) {
        var name = item.InvoiceItem.ChargeName;
        if (name in ItemsBuilder.USERS_ITEMS || name in ItemsBuilder.PERSONAL) {
            // because negative charges are really wrongly-invoiced credits
            // this will help detect invoices that aren't correctly marked as prorated
            if (item.InvoiceItem.ChargeAmount < 0) {
                proratedUsersCredit.push(item);
            } else {
                charged.push(item);
            }
        } else if (name in ItemsBuilder.USERS_PRORATION) {
            if (item.InvoiceItem.ChargeAmount < 0) {
                proratedUsersCredit.push(item);
            } else {
                usersProration.push(item);
            }
        } else if (name in ItemsBuilder.STORAGE_ITEMS || name in ItemsBuilder.STORAGE_PRORATION) {
            if (item.InvoiceItem.ChargeAmount < 0) {
                proratedStorageCredit.push(item);
            } else {
                charged.push(item);
            }
        } else if (name in ItemsBuilder.USER_PRORATION_CREDIT) {
            // although proration credit is done when removing/replacing/refunding, the relation is
            // to the original Amendment of type NewProduct, which is confusing (wouldn't be able to detect cancellation)
            item.Amendment.Type = "RemoveProduct";
            proratedUsersCredit.push(item);
        } else if (name in ItemsBuilder.STORAGE_PRORATION_CREDIT) {
            proratedStorageCredit.push(item);
        } else if (name in ItemsBuilder.DISCOUNTS) {
            //do nothing
        } else {
            logger.error(item);
            throw new VError("Unknown item type: " + name);
        }
    });

    // IMPORTANT: prorated users processed first to prioritize credit attachment
    return ItemsBuilder.processItems(
        usersProration.concat(charged),
        proratedUsersCredit, proratedStorageCredit,
        {discountMap,
            adjustmentMap,
            plans,
            invoiceAdjustmentAmount
        });
};

InvoiceBuilder.processAdjustments = function(adjustments) {
    var adjustmentMap = {};
    var itemAdjustmentAmountTotal = 0;
    if (adjustments && adjustments.length) {
        adjustments.forEach(function (adjustment) {
            var amount = adjustment.InvoiceItemAdjustment.Amount;
            if (adjustment.InvoiceItemAdjustment.Type !== "Charge") {
                amount = -amount;
            }
            itemAdjustmentAmountTotal += amount;
            adjustmentMap[adjustment.InvoiceItem.Id] = amount;
        });
    }
    return [adjustmentMap, itemAdjustmentAmountTotal];
};

InvoiceBuilder.processInvoiceAdjustments = function(invoiceAdjustments) {
    var invoiceAdjustmentAmount = 0;
    if (invoiceAdjustments && invoiceAdjustments.length) {
        invoiceAdjustments.forEach(function (invoiceAdjustment) {
            var amount = invoiceAdjustment.InvoiceAdjustment.Amount;
            if (invoiceAdjustment.InvoiceAdjustment.Type !== "Charge") {
                amount = -amount;
            }
            invoiceAdjustmentAmount += amount;
        });
    }
    return invoiceAdjustmentAmount;
};

/**
 * Zuora contains discounts as invoice items. They have a special type and contain
 * ID to which other item they are related, so in the web GUI they look like a "subitem".
 * @returns a map of discounts by ID of their respective items.
 */
InvoiceBuilder.processDiscounts = function(invoiceItems) {
    var discountMap = {};
    invoiceItems
        .filter(i => i.InvoiceItem.ChargeName in ItemsBuilder.DISCOUNTS)
        .forEach(function (discount) {
            discountMap[discount.InvoiceItem.AppliedToInvoiceItemId] = discount.InvoiceItem.ChargeAmount;
        });

    return discountMap;
};

InvoiceBuilder.processCreditAdjustments = function(creditAdjustments) {
    var adjustments = 0;
    if (creditAdjustments && creditAdjustments.length) {
        creditAdjustments.forEach(function (creditAdjustment) {
            var amount = creditAdjustment.CreditBalanceAdjustment.Amount;
            if (creditAdjustment.CreditBalanceAdjustment.Type !== "Increase") {
                amount = -amount;
            }
            adjustments += amount;
        });
    }
    return adjustments;
};

exports.InvoiceBuilder = InvoiceBuilder;
