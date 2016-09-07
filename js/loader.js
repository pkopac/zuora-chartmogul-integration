"use strict";
// var logger = require("log4js").getLogger();
var ZuoraAqua = require("./zuora.js").ZuoraAqua;

var Loader = function() {
    this.customId = null;
};

/**
 * Class contains ZOQLs for import of invoice-related data.
 * Serves as reference to the incoming data (ZOQL => CSV => JSON keep structure),
 * Fields sorted alphabetically for convenience, but in JSON it doesn't matter.
 * Zuora AQuA time format is ISO 8601 with UTC timezone.
 */
Loader.prototype.configure = function(aquaConfig, loaderConfig) {
    this.aqua = new ZuoraAqua();
    this.aqua.configure(aquaConfig);
    if (loaderConfig && loaderConfig.customId) {
        this.customId = loaderConfig.customId;
    }
};

/**
 *  Fetches all invoice items with prejoined info about its Invoice, Account,
 *  Billing (address) and subscription.
 */
Loader.prototype.getAllInvoiceItems = function() {
    return this.aqua.zoqlRequest(
        "select "+
        "InvoiceItem.AccountingCode,InvoiceItem.AppliedToInvoiceItemId,InvoiceItem.ChargeAmount,"+
        "InvoiceItem.ChargeName,InvoiceItem.Id,InvoiceItem.Quantity,InvoiceItem.ServiceEndDate,"+
        "InvoiceItem.ServiceStartDate,InvoiceItem.TaxAmount,"+
        "Amendment.Type,"+
        "Account.Currency,Account.Name,Account.AccountNumber,Account.Status,"+
        (this.customId ? "Account." + this.customId + "," : "") +
        "BillToContact.City,BillToContact.Country,BillToContact.PostalCode,BillToContact.State,"+
        "Invoice.AdjustmentAmount,Invoice.Amount,Invoice.Balance,Invoice.DueDate,"+
        "Invoice.InvoiceDate,Invoice.InvoiceNumber,Invoice.PaymentAmount,"+
        "Invoice.PostedDate,Invoice.RefundAmount,Invoice.Status,"+
        "ProductRatePlan.Id," +
        "ProductRatePlanCharge.ChargeType,ProductRatePlanCharge.Id," +
        "Subscription.CancelledDate,Subscription.Id,Subscription.Name,Subscription.Status,Subscription.SubscriptionEndDate"+
        " from InvoiceItem",

        "all Invoice Items"
    );
};

Loader.prototype.getAllCustomers = function() {
    return this.aqua.zoqlRequest(
        "select " +
        "Account.Name,Account.AccountNumber,Account.Status," +
        (this.customId ? "Account." + this.customId + "," : "") +
        "BillToContact.City,BillToContact.Country,BillToContact.PostalCode,BillToContact.State" +
        " from Account",
        "all Accounts"
    );
};

Loader.prototype.getAllPlans = function() {
    return this.aqua.zoqlRequest(
        "select " +
        "ProductRatePlan.Id,ProductRatePlan.Name," +
        "ProductRatePlanCharge.AccountingCode,ProductRatePlanCharge.BillingPeriod,ProductRatePlanCharge.Id" +
        " from ProductRatePlanCharge",
        "all plans"
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
        "RefundInvoicePayment.RefundAmount," +
        "Invoice.InvoiceNumber," +
        "Refund.Amount,Refund.Id,Refund.RefundDate,Refund.RefundNumber,Refund.Status" +
        " from RefundInvoicePayment",

        "all Refund Invoice Payments"
    );
};

Loader.prototype.getAllInvoiceItemAdjustments = function() {
    return this.aqua.zoqlRequest(
        "select "+
        "InvoiceItemAdjustment.Amount,InvoiceItemAdjustment.Status,InvoiceItemAdjustment.Type,"+
        "Invoice.InvoiceNumber,InvoiceItem.Id"+
        " from InvoiceItemAdjustment",

        "all Invoice Item Adjustments"
    );
};

Loader.prototype.getAllInvoiceAdjustments = function() {
    return this.aqua.zoqlRequest(
        "select "+
        "InvoiceAdjustment.Amount,InvoiceAdjustment.Id,InvoiceAdjustment.Status,InvoiceAdjustment.Type,"+
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
        "CreditBalanceAdjustment.AccountingCode,CreditBalanceAdjustment.Amount,CreditBalanceAdjustment.CreatedDate,"+
        "CreditBalanceAdjustment.Id,CreditBalanceAdjustment.ReasonCode,CreditBalanceAdjustment.SourceTransactionType,"+
        "CreditBalanceAdjustment.Status,CreditBalanceAdjustment.Type,"+
        "Account.AccountNumber,"+
        (this.customId ? "Account." + this.customId + "," : "") +
        "Invoice.InvoiceNumber,"+
        "Payment.Amount,Payment.Id,Payment.PaymentNumber,"+
        "Refund.Amount,Refund.Id,Refund.RefundDate,Refund.RefundNumber,Refund.Status"+
        " from CreditBalanceAdjustment",

        "all Credit Balance Adjustments"
    );
};

exports.Loader = Loader;
