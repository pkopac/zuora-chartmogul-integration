"use strict";

var logger = require("log4js").getLogger("pendingRefunds"),
    VError = require("verror"),
    _ = require("lodash"),
    moment = require("moment"),
    InvoiceBuilder = require("./invoiceBuilder.js").InvoiceBuilder,
    Splitter = require("./splitter.js").Splitter;

var PendingRefunds = {};

PendingRefunds.addHangingRefunds = function(pendingCBARefunds, invoicesToImport) {
    // sort without mutating original, iterate in reverse order
    var invoices = _.sortBy(invoicesToImport, "external_id").reverse();
    for (var i = 0; i < invoices.length; i++) {
        let invoice = invoices[i];
        let result = PendingRefunds.addRefundsFromStandaloneCBA(pendingCBARefunds, invoice);
        pendingCBARefunds = result[0];
        let additionalInvoice = result[1];
        if (additionalInvoice) {
            invoices.push(additionalInvoice);
        }
    }
    // we need to re-sort, since we possibly added some invoices and reverted order
    invoices = _.sortBy(invoices, "external_id");
    if (pendingCBARefunds && pendingCBARefunds.length) {
        throw new VError("Pending extra-invoice refunds " + JSON.stringify(pendingCBARefunds));
    }
    return invoices;
};

/**
 * Some credit balance adjustments are done outside of invoices.
 * It's not possible to match them directly, so let's match them heuristically
 * by date and amount.
 * Tries to match first adjustment to invoice by date.
 */
PendingRefunds.addRefundsFromStandaloneCBA = function(cbas, invoice) {
    if (!cbas || !cbas.length) {
        return [cbas];
    }
    const invoiceDateM = moment.utc(invoice.date),
        invoiceTotal = invoice.line_items.reduce(function (prev, cur) {
            return prev + cur.amount_in_cents;
        }, 0);

    if (invoiceTotal <= 0) { // can't refund an invoice that has 0 amount to be paid
        return [cbas];
    }
    /* Same date or later and same amount => matches */
    let found = cbas.find(cba => moment.utc(cba.CreditBalanceAdjustment.CreatedDate).isSameOrAfter(invoiceDateM));
    if (!found) {
        return [cbas];
    }

    logger.debug("Found extra-invoice refund %s from credit, attaching it to invoice %s.",
        found.Refund.RefundNumber, invoice.external_id);
    let refundedAmount = Math.round(found.CreditBalanceAdjustment.Amount * 100),
        filteredCbas = cbas.filter(cba =>
            cba.CreditBalanceAdjustment.Id !== found.CreditBalanceAdjustment.Id);

    // matches exactly => just add refund
    if (refundedAmount == invoiceTotal) {
        InvoiceBuilder.addPayments([found], invoice, "Refund");
        return [filteredCbas];

    // split invoice, because chartMogul doesn't support partial refund
    } else if (refundedAmount < invoiceTotal) {
        var newInvoice = Splitter.splitInvoice(invoice, refundedAmount);
        InvoiceBuilder.addPayments([found], newInvoice, "Refund");
        return [filteredCbas, newInvoice];
     // split adjustment, because it is more than there's on the invoice
    } else {
        filteredCbas.push(Splitter.splitAdjustment(invoice, refundedAmount, invoiceTotal, found));
        return [filteredCbas];
    }
};

exports.PendingRefunds = PendingRefunds;
