"use strict";
// var logger = require("log4js").getLogger();
var ZuoraAqua = require("./zuora.js").ZuoraAqua;

var Loader = function() {
};

/**
 * Class contains ZOQLs for export of invoice-related data.
 * Depends on custom field Account.SamepageId__c!
 * Serves as reference to the incoming data (ZOQL => CSV => JSON keep structure),
 * Fields sorted alphabetically for convenience, but in JSON it doesn't matter.
 * Zuora AQuA time format is ISO 8601 with UTC timezone.
 */
Loader.prototype.configure = function(json) {
    this.aqua = new ZuoraAqua();
    this.aqua.configure(json);
};

/**
 *  Fetches all invoice items with prejoined info about its Invoice, Account,
 *  Billing (address) and subscription.
 */
Loader.prototype.getAllInvoiceItems = function() {
    return this.aqua.zoqlRequest(
        "select "+
        "AccountingCode,AppliedToInvoiceItemId,ChargeAmount,ChargeName,Id,"+
        "Quantity,ServiceEndDate,ServiceStartDate,SubscriptionId,TaxAmount,UOM,UnitPrice,"+
        "Amendment.Type,"+
        "Account.Currency,Account.Name,Account.AccountNumber,Account.SamepageId__c,Account.Status,"+
        "BillToContact.City,BillToContact.Country,BillToContact.PostalCode,BillToContact.State,"+
        "Invoice.AdjustmentAmount,Invoice.Amount,Invoice.Balance,Invoice.DueDate,"+
        "Invoice.InvoiceDate,Invoice.InvoiceNumber,Invoice.PaymentAmount,"+
        "Invoice.PostedDate,Invoice.RefundAmount,Invoice.Status,"+
        "Subscription.CancelledDate,Subscription.Id,Subscription.Name,Subscription.Status,Subscription.SubscriptionEndDate"+
        " from InvoiceItem",

        "all Invoice Items"
    );
};

/**
 * Invoice payments + invoice number + payment realization.
 */
Loader.prototype.getAllInvoicePayments = function() {
    return this.aqua.zoqlRequest("select " +
        "InvoicePayment.Amount," +
        "Invoice.InvoiceNumber," +
        "Payment.CreatedDate,Payment.Id,Payment.PaymentNumber,Payment.Status" +
        " from InvoicePayment",

        "all Invoice Payments"
    );
};

Loader.prototype.getAllRefundInvoicePayments = function() {
    return this.aqua.zoqlRequest(
        "select " +
        "RefundAmount," +
        "Invoice.InvoiceNumber," +
        "Refund.Amount,Refund.Id,Refund.RefundDate,Refund.RefundNumber,Refund.Status" +
        " from RefundInvoicePayment",

        "all Refund Invoice Payments"
    );
};

Loader.prototype.getAllInvoiceItemAdjustments = function() {
    return this.aqua.zoqlRequest(
        "select "+
        "Amount,Status,Type,"+
        "Invoice.InvoiceNumber,InvoiceItem.Id"+
        " from InvoiceItemAdjustment",

        "all Invoice Item Adjustments"
    );
};

Loader.prototype.getAllInvoiceAdjustments = function() {
    return this.aqua.zoqlRequest(
        "select "+
        "Amount,Id,Status,Type,"+
        "Invoice.InvoiceNumber"+
        " from InvoiceAdjustment",

        "all Invoice Adjustments"
    );
};

/**
 * Adjustments are quite tricky - it can mean an extra payment or refunding
 * a whole invoice, or just a part of it.
 */
Loader.prototype.getAllCreditBalanceAdjustments = function() {
    return this.aqua.zoqlRequest(
        "select "+
        "AccountingCode,Amount,CreatedDate,Id,ReasonCode,SourceTransactionType,Status,Type,"+
        "Account.SamepageId__c,Account.AccountNumber,"+
        "Invoice.InvoiceNumber,"+
        "Payment.Amount,Payment.Id,Payment.PaymentNumber,"+
        "Refund.Amount,Refund.Id,Refund.RefundDate,Refund.RefundNumber,Refund.Status"+
        " from CreditBalanceAdjustment",

        "all Credit Balance Adjustments"
    );
};

exports.Loader = Loader;
