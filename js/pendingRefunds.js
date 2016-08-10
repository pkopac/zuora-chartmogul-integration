"use strict";

var logger = require("log4js").getLogger("pendingRefunds"),
    VError = require("verror"),
    moment = require("moment"),
    InvoiceBuilder = require("./invoiceBuilder.js").InvoiceBuilder,
    Splitter = require("./splitter.js").Splitter;

var PendingRefunds = {};

/**
 * Some credit balance adjustments are done outside of invoices.
 * It's not possible to match them directly, so let's match them heuristically by date and amount.
 * @param cbas - credit balance adjustments in Zuora format
 * @param invoices - converted invoices in CM format
 */
PendingRefunds.addHangingRefunds = function(cbas, invoices) {
    // sort without mutating original, iterate in reverse order
    var invoicesCopy = invoices.slice().reverse();
    for (var i = 0; i < invoicesCopy.length; i++) {
        if (!cbas || !cbas.length) {
            return invoices;
        }

        let invoice = invoicesCopy[i],
            result = PendingRefunds._addRefundsFromStandaloneCBA(cbas, invoice);

        cbas = result.cbas;
        // if (result.additionalInvoice) {
        //     invoices.splice(++i, 0, additionalInvoice); // add invoice after this one
        // }
    }
    // TODO: if adding splitted invoices reimplemented, we should rather _.sortBy than copy the array
    // and also make sure that INV00xxxxx-postfix is sorted correctly
    if (cbas && cbas.length) {
        logger.error(cbas);
        logger.error("Invoices", invoices.map(i => i.external_id));
        throw new VError("Pending extra-invoice refunds!");
    }
    return invoices;
};

/**
 * Tries to apply one of the available credit balance adjustments as refund to the selected invoice.
 * Matching adjustments to invoice by date.
 */
PendingRefunds._addRefundsFromStandaloneCBA = function(cbas, invoice) {
    // logger.trace(JSON.stringify(invoice), invoice.line_items)
    Object.keys(invoice).map(k => logger.trace(k, invoice[k]));
    var invoiceDateM = moment.utc(invoice.date),
        invoiceTotal = invoice.line_items.reduce(function (prev, cur) {
            return prev + cur.amount_in_cents;
        }, 0);

    // can't refund an invoice that has 0 amount to be paid
    // consequence: if the refund is added and downgrade/cancellation invoice removed later, it stays on the original, paid invoice
    if (invoiceTotal <= 0) {
        return {cbas};
    }

    /* Same date or later and same amount => matches */
    let found = cbas.find(cba => moment.utc(cba.CreditBalanceAdjustment.CreatedDate).isSameOrAfter(invoiceDateM));
    if (!found) {
        return {cbas};
    }

    logger.debug("Found extra-invoice refund %s from credit, attaching it to invoice %s.",
        found.Refund.RefundNumber, invoice.external_id);
    let refundedAmount = Math.round(found.CreditBalanceAdjustment.Amount * 100);
    cbas = cbas.filter(cba =>
        cba.CreditBalanceAdjustment.Id !== found.CreditBalanceAdjustment.Id);

    // matches exactly => just add refund
    if (refundedAmount === invoiceTotal) {
        InvoiceBuilder.addPayments([found], invoice, "Refund");
    } else if (refundedAmount < invoiceTotal) {
        // TODO: maybe split invoice in some other way
        // !!! Splitting turned off, because it generates unreal MRR in CM upgrades & downgrades instead of cancel.
        // var newInvoice = Splitter.splitInvoice(invoice, refundedAmount);
        InvoiceBuilder.addPayments([found], invoice, "Refund");
    } else {
        // split adjustment, because it is more than there's on the invoice
        cbas.push(Splitter.splitAdjustment(invoice, refundedAmount, invoiceTotal, found));
    }
    return {cbas};
};

exports.PendingRefunds = PendingRefunds;
