"use strict";

var logger = require("log4js").getLogger("transformer"),
    Q = require("q"),
    //moment = require("moment"),
    _ = require("lodash"),
    VError = require("verror"),
    InvoiceBuilder = require("./invoiceBuilder.js").InvoiceBuilder,
    PendingRefunds = require("./pendingRefunds.js").PendingRefunds;
/**
 * Uses loader and importer to manipulate I/O. Contains business logic of
 * changing zuora data into chartmogul data.
 */
var Transformer = function(loader, importer) {
    this.loader = loader;
    this.importer = importer;
};

/**
 * Main pipeline: fetches all Zuora data -> filters, covers special cases -> uploads.
 * TODO: @param differential boolean: false -> drop & complete reload of data
 * So far we've been unable to make differential updates because of retroactive changes.
 */
Transformer.prototype.run = function () {
    var self = this;
    return this.reloadAll()
                .spread(self.groupInsertPlansAndCustomers.bind(self))
                .spread(self.makeInvoices.bind(self));
};

Transformer.prototype.reloadAll = function () {
    logger.info("Exporting data from Zuora...");

    return Q.all([
        this.loader.getAllInvoiceItems(),
        this.loader.getAllInvoicePayments(),
        this.loader.getAllRefundInvoicePayments(),
        this.loader.getAllInvoiceItemAdjustments(),
        this.loader.getAllInvoiceAdjustments(),
        this.loader.getAllCreditBalanceAdjustments(),
        this.importer.getDataSource(this.dataSource)
    ]);
};

Transformer.prototype.groupInsertPlansAndCustomers = function (
    invoices, payments, refunds, itemAdjs, invoiceAdjs, creditAdjs, dsUuid) {

    logger.info("Processing data...");

    var self = this;
    self.importer.dataSource = dsUuid;
    var itemsByAccount = self.filterAndGroupItems(invoices);
    return Q.all([self.importer.insertPlans()
                    .then(self.extIds2Uuids),
                  self.importCustomersFromItems(itemsByAccount)
                    .then(self.extIds2Uuids),
                  itemsByAccount,
                  _.groupBy(payments,
                            p => p.Invoice.InvoiceNumber),
                  _.groupBy(refunds.filter(r => r.Refund.Status === "Processed"),
                            p => p.Invoice.InvoiceNumber),
                  _.groupBy(itemAdjs.filter(a => a.InvoiceItemAdjustment.Status === "Processed"),
                            p => p.Invoice.InvoiceNumber),
                  _.groupBy(invoiceAdjs.filter(a => a.InvoiceAdjustment.Status === "Processed"),
                            p => p.Invoice.InvoiceNumber),
                  _.groupBy(creditAdjs.filter(a => a.CreditBalanceAdjustment.Status === "Processed"),
                            p => p.Invoice.InvoiceNumber),
                  _.groupBy(creditAdjs.filter(a =>
                              a.Refund.RefundNumber !== "" &&
                              a.CreditBalanceAdjustment.Status === "Processed" &&
                              a.Invoice.InvoiceNumber === ""),
                            p => p.Account.SamepageId__c || p.Account.AccountNumber)
              ]);
};

Transformer.prototype.getCustomerUuid = function(customersById, accountId) {
    var customerUuid = customersById[accountId];
    if (!customerUuid) {
        logger.trace(JSON.stringify(customersById, null, 1));
        throw new VError("Missing customer UUID accountId: " + accountId);
    }
    return customerUuid;
};

/**
 * From all information available in Zuora creates Invoices compatible with
 * Chartmogul.
 */
Transformer.prototype.makeInvoices = function(
    plansById, customersById, itemsByAccount,
    paymentsByInvoice, refundsByInvoice, itemAdjsByInvoice,
    invoiceAdjsByInvoice, creditAdjsByInvoice, creditAdjsNoInvoiceByAccount) {

    var self = this,
        counter = 0;

    return Q.all(Object.keys(itemsByAccount)
        .map(function (accountId) {
            var invoices = _.groupBy(itemsByAccount[accountId], i => i.Invoice.InvoiceNumber);

            var customerUuid = self.getCustomerUuid(customersById, accountId);

            logger.debug("Processing accountId", accountId);

            var invoicesToImport = Object.keys(invoices)
                .sort() // sorts by keys, which are external_id and are growing with date
                .map(function (invoiceNumber) { // ordered processing
                    try {
                        logger.trace("Processing invoice", invoiceNumber);
                        var invoiceItems = invoices[invoiceNumber],
                            i = invoiceItems[0];

                        return InvoiceBuilder.buildInvoice(invoiceNumber,
                            invoiceItems,
                            i.Invoice.PostedDate,
                            i.Invoice.DueDate,
                            i.Account.Currency,
                            itemAdjsByInvoice[invoiceNumber],
                            invoiceAdjsByInvoice[invoiceNumber],
                            creditAdjsByInvoice[invoiceNumber],
                            paymentsByInvoice[invoiceNumber],
                            refundsByInvoice[invoiceNumber],
                            plansById
                        );

                    } catch (error) {
                        throw new VError(error, "Failed to process invoice " + invoiceNumber);
                    }
                })
                .filter(invoice => invoice.line_items.length);

            logger.trace("Invoices before hanging refunds", invoicesToImport.map(i => i.external_id));

            try {
                invoicesToImport = PendingRefunds.addHangingRefunds(
                                        creditAdjsNoInvoiceByAccount[accountId],
                                        invoicesToImport
                                    );
            } catch(err) {
                throw new VError(err, "Failed to add extra-invoice refunds to account " + accountId);
            }

            invoicesToImport = invoicesToImport.filter(invoice => invoice.line_items.every(
                    // any invoice containing deleted subscriptions must be removed
                    line_item => line_item.subscription_external_id
                ))
                .filter(Boolean); // remove null and empty invoices;


            /* Various checks */
            invoicesToImport
                .filter(invoice => invoice.line_items.some(line_item => !line_item.quantity))
                .forEach(invoice => {
                    logger.error(invoice);
                    throw new VError("Invoice can't have zero quantity!");
                });
            invoicesToImport
                .filter(invoice => invoice.line_items.some(line_item => !line_item.prorated && line_item.amount_in_cents < 0))
                .forEach(invoice => {
                    logger.error(invoice);
                    throw new VError("Invoice can't be unprorated with negative amount!");
                });


            return self.importer.insertInvoices(customerUuid, invoicesToImport)
                .tap(() => {
                    if (!(++counter % 100)) {
                        logger.info("Processed %d customers.", counter);
                    }
                });

        }));
};

Transformer.prototype.configure = function (json) {
    if (!json) {
        return;
    }
    this.dataSource = json.dataSource || "zuora";
    if (json.accounts) {
        this.includeAccounts = json.accounts.include && new Set(json.accounts.include);
        this.excludeAccounts = new Set(json.accounts.exclude || []);
    }
};


/**
 * Groups by tenantId (SamepageId__c field in Zuora) or Zuora Account ID.
 * Filters by include/exclude list. Removes FREE-only accounts (don't affect MRR).
 * @return map by accountId to array of items
 */
Transformer.prototype.filterAndGroupItems = function (invoiceItems) {
    var self = this;
    var itemsByAccountId = _.groupBy(invoiceItems
                .filter(i => i.Invoice.Status === "Posted") //remove invoices that were canceled/just drafted
                .filter(i => i.InvoiceItem.AccountingCode !== "FREE"), //remove free items
            (rec) =>
                rec.Account.SamepageId__c || rec.Account.AccountNumber);

    var filteredItemsByAccount = {};
    Object.keys(itemsByAccountId)
        .filter(accountId => itemsByAccountId[accountId]
            // remove never paying accounts
            .some(item => item.Invoice.Amount > 0))
        .filter(accountId => !this.includeAccounts || self.includeAccounts.has(accountId))
        .filter(accountId => !this.excludeAccounts || !self.excludeAccounts.has(accountId))
        .forEach(function (accountId) {
            filteredItemsByAccount[accountId] = itemsByAccountId[accountId];
        });
    return filteredItemsByAccount;
};

/**
 * Uses the BillToContact pre-joined info to load necessary customers.
 * Depends on which InvoiceItems have been filtered.
 * @returns promise for all customers insertion
 */
Transformer.prototype.importCustomersFromItems = function (itemsByAccountId) {
    var self = this;
    return self.importer.insertCustomers(Object.keys(itemsByAccountId)
        .map(accountId => [accountId, itemsByAccountId[accountId][0]]));
};

/* Helper functions */

/**
 * @param array - objects from Chartmogul response
 * @returns map[external id] -> uuid
 */
Transformer.prototype.extIds2Uuids = function (array) {
    var map = {};
    array.forEach(function (item) {
        map[item.external_id] = item.uuid;
    });
    return map;
};

exports.Transformer = Transformer;
