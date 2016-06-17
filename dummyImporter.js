"use strict";

var logger = require("log4js").getLogger("importer"),
    Q = require("q"),
    fs = require("fs");

var Importer = function () {
    this.dataSource = null; // must be set later
};

Importer.PLANS = {
    PRO_ANNUALLY: "Pro Annually",
    PRO_MONTHLY: "Pro Monthly",
    PRO_QUARTERLY: "Pro Quarterly"
};

Importer.prototype.configure = function () {
    logger.debug("Configuring dummy client...");
};

Importer.prototype.getDataSource = function(name) {
    logger.trace("getDataSource");
    return "fake_datasource_uuid_" + name;
};

Importer.prototype.dropAndCreateDataSource = function(name) {
    logger.trace("dropAndCreateDataSource");
    return "fake_datasource_uuid_" + name;
};

Importer.prototype.getDataSourceOrFail = function (name) {
    return "fake_datasource_uuid_" + name;
};

Importer.prototype.getOrCreateDataSource = function (name) {
    return "fake_datasource_uuid_" + name;
};

Importer.prototype._insertPlan = function(dataSourceUuid, plan) {
    return {uuid: "fake_plan_uuid_" + plan, external_id: plan};
};

Importer.prototype.insertPlans = function () {
    return Q.all([this._insertPlan(this.dataSource, Importer.PLANS.PRO_ANNUALLY, 1, "year"),
                  this._insertPlan(this.dataSource, Importer.PLANS.PRO_MONTHLY, 1, "month"),
                  this._insertPlan(this.dataSource, Importer.PLANS.PRO_QUARTERLY, 3, "month")]);
};

Importer.prototype.insertCustomers = function(array) {
    return Q.all(array.map(i => this._insertCustomer(i[0])));
};

Importer.prototype._insertCustomer = function(accountId) {
    return Q({uuid: "fake_customer_uuid_" + accountId, external_id: accountId});
};

Importer.prototype.insertInvoices = function(customerUuid, invoicesToImport) {
    if (!invoicesToImport.length) {
        return;
    }
    logger.debug("Saving invoices", invoicesToImport.map(invo => invo.external_id));
    return Q.all(invoicesToImport.map(
        invo => Q.ninvoke(fs, "writeFile",
                            "./dump/" + invo.external_id + ".json",
                            JSON.stringify(invo, null, 2))
    ));
};

exports.Invoice = require("chartmoguljs").import.Invoice;

exports.Importer = Importer;
