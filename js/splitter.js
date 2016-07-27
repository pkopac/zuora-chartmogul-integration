"use strict";

var Invoice = require("./importer.js").Invoice,
    VError = require("verror"),
    moment = require("moment"),
    InvoiceBuilder = require("./invoiceBuilder.js").InvoiceBuilder,
    logger = require("log4js").getLogger("splitter");

var Splitter = {};

/**
 * Splits invoice in two - the new one is refunded.
 * Mutates the invoice (deducts the refunded part).
 * TODO: how to deal with quantity?
 * @param refundedAmount: positive amount_in_cents
 * @returns the new invoice.
 */
Splitter.splitInvoice = function(invoice, refundedAmount, date) {
    logger.debug("Splitting invoice %s: refunded %d", invoice.external_id, refundedAmount);

    /* Create new invoice for the refunded part */
    let newInvoice = new Invoice(JSON.parse(JSON.stringify(invoice)));

    /* Because removing shouldn't be duplicated. */
    newInvoice.line_items = newInvoice.line_items.filter(item => item.__amendmentType !== "RemoveProduct");

    if (newInvoice.line_items.length != 1) {
        logger.debug(invoice.line_items);
        throw new VError("Not yet implemented: multiple items in invoice " + invoice.external_id + " to be splitted!");
    }

    invoice.line_items[0].amount_in_cents = refundedAmount;
    newInvoice.line_items[0].amount_in_cents -= refundedAmount;

    if (date) { // split by non-overlapping time range
        newInvoice.line_items[0].service_period_end = date;
        invoice.line_items[0].service_period_start = moment.utc(date).add(1, "day").toDate();
    }

    /* New fake ID's must be unique! */
    var suffix = "-" + Math.round(Math.random() * 100);
    newInvoice.external_id += suffix;
    newInvoice.line_items.forEach(p => p.external_id += suffix);
    newInvoice.transactions.forEach(t => t.external_id += suffix);
    return newInvoice;
};

/**
 * Mutates invoice (adds refund) + returns the rest to be added later.
 */
Splitter.splitAdjustment = function(invoice, refundedAmount, invoiceTotal, cba) {
    logger.debug("Splitting adjustment %s: %d - %d = %d",
        cba.Refund.RefundNumber, refundedAmount, invoiceTotal, refundedAmount - invoiceTotal);
    // make new object, not to mutate original
    let processNow = JSON.parse(JSON.stringify(cba)),
        processNext = JSON.parse(JSON.stringify(cba));
    /* New fake ID's must be unique! */
    processNow.Refund.RefundNumber += "a";
    processNext.Refund.RefundNumber += "b";
    processNow.CreditBalanceAdjustment.Amount = invoiceTotal/100; //refund only the part that belongs to this invoice
    processNext.CreditBalanceAdjustment.Amount -= invoiceTotal/100; // try to find where to put the rest next time
    InvoiceBuilder.addPayments([processNow], invoice, "Refund");
    return processNext;
};

exports.Splitter = Splitter;
