"use strict";

var logger = require("log4js").getLogger();
var cm = require("chartmoguljs"),
    Q = require("q");

/* Private helper functions */
//.catch(ignore(cm.import.PLAN_EXISTS_ERROR));
// function ignore(exceptionNames) {
//     return function (error) {
//         if (!error || exceptionNames.indexOf(error.name) < 0) {
//             throw error;
//         }
//     };
// }

/**
 * Handles manipulating data in Chartmogul. Knows about chartmogul API, should be
 * independent of Zuora.
 */
var Importer = function () {
    this.dataSource = null; // must be set later
};

Importer.PLANS = {
    PRO_ANNUALLY: "Pro Annually",
    PRO_MONTHLY: "Pro Monthly",
    PRO_QUARTERLY: "Pro Quarterly"
};

Importer.prototype.configure = function (json) {
    logger.debug("Configuring chartmogul client...");
    cm.config(json);
};

Importer.prototype.dropAndCreateDataSource = function(name) {
    logger.trace("dropAndCreateDataSource");
    return cm.import.listDataSources()
        .then(function (response) {
            logger.debug("Existing data sources: ", response.data_sources);

            var ds = response.data_sources.find(d => d.name === name);

            if (ds) {
                logger.info("Cleaning data source - %s...", ds.name);
                return cm.import.deleteDataSource(ds.uuid)
                    .then(() => cm.import.createDataSource(name))
                    .then((createdDs) => createdDs.uuid);
            } else {
                logger.info("Creating new data source...");
                return cm.import.createDataSource(name)
                    .then((createdDs) => createdDs.uuid);
            }
        });
};

Importer.prototype.getDataSourceOrFail = function (name) {
    return cm.import.listDataSources()
        .then(function (response) {
            logger.debug("Existing data sources: ", response.data_sources);
            var ds = response.data_sources.find(d => d.name === name);

            if (!ds) {
                throw new Error("Data source not found " + name);
            }

            logger.info("Found data source %s...", ds.uuid);
            return ds.uuid;
        });
};

Importer.prototype.getOrCreateDataSource = function (name) {
    return cm.import.listDataSources()
        .then(function (response) {
            logger.debug("Existing data sources: ", response.data_sources);
            var ds = response.data_sources.find(d => d.name === name);

            if (!ds) {
                logger.info("Creating new data source...");
                return cm.import.createDataSource(name)
                    .then((createdDs) => createdDs.uuid);
            }

            logger.info("Found data source %s...", ds.uuid);
            return ds.uuid;
        });
};

Importer.prototype._insertPlan = function(dataSourceUuid, plan, amout, period) {
    return cm.import.importPlan(dataSourceUuid, plan, amout, period, plan);
};

Importer.prototype.insertPlans = function () {
    return Q.all([this._insertPlan(this.dataSource, Importer.PLANS.PRO_ANNUALLY, 1, "year"),
                  this._insertPlan(this.dataSource, Importer.PLANS.PRO_MONTHLY, 1, "month"),
                  this._insertPlan(this.dataSource, Importer.PLANS.PRO_QUARTERLY, 3, "month")]);
};

Importer.prototype.insertCustomer = function(accountId, info) {
    return cm.import.importCustomer(this.dataSource,
            accountId,
            info.Account.Name,
            null,
            null,
            info.BillToContact.Country,
            info.BillToContact.State,
            info.BillToContact.City,
            info.BillToContact.PostalCode);
};

Importer.prototype.insertInvoices = function(customerUuid, invoicesToImport) {
    if (!invoicesToImport.length) {
        return;
    }
    logger.debug("Saving invoices", invoicesToImport.map(invo => invo.external_id));
    return cm.import.importInvoices(customerUuid, invoicesToImport);
};

exports.Invoice = cm.import.Invoice;

exports.Importer = Importer;
