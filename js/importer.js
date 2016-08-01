"use strict";

var logger = require("log4js").getLogger("importer");
var cm = require("chartmoguljs"),
    cd = require("country-data"),
    queue = require("block-queue"),
    Q = require("q");

//TODO: HTTP 422 means "Unprocessable entity". It must be checked therefore, whether the error is duplicate index key, or something else!

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

const CHARTMOGUL_DELAY = 10000,
    MAX_PARALLEL_CUSTOMERS_REQUESTS = 1000;

Importer.PLANS = {
    PRO_ANNUALLY: "Pro Annually",
    PRO_MONTHLY: "Pro Monthly",
    PRO_QUARTERLY: "Pro Quarterly"
};

Importer.prototype.configure = function (json) {
    logger.debug("Configuring chartmogul client...");
    this.skip = json.update;
    cm.config(json);
};

Importer.prototype.getDataSource = function(name) {
    if (this.skip) {
        return this.getOrCreateDataSource(name);
    } else {
        return this.dropAndCreateDataSource(name);
    }
};

//TODO: exponential backoff
Importer.prototype.dropAndCreateDataSource = function(name) {
    logger.trace("dropAndCreateDataSource");
    return cm.import.listDataSources()
        .then(function (response) {
            logger.trace("Existing data sources: ", response.data_sources);

            var ds = response.data_sources.find(d => d.name === name);

            if (ds) {
                logger.info("Cleaning data source - %s...", ds.name);
                return cm.import.deleteDataSource(ds.uuid)
                    .then(() => {
                        var d = Q.defer();
                        var retry = setInterval(() => {
                            cm.import.createDataSource(name)
                            .then((result) => {
                                clearInterval(retry);
                                logger.info("Successfully cleaned data source.");
                                d.fulfill(result);
                            })
                            .catch((err) => {
                                if (err.statusCode !== 422) {
                                    logger.debug(err.statusCode);
                                    clearInterval(retry);
                                    d.reject(err);
                                }
                                logger.debug("Waiting " + CHARTMOGUL_DELAY/1000 + " s for Chartmogul to clean DataSource...");
                                // in case of 422, try again
                            });

                        }, CHARTMOGUL_DELAY);
                        return d.promise;
                    })
                    .tap(d => logger.trace(d))
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

/**
 * Handles allSettled result - failover for existing customers/plans
 */
function listHandler(error, fc, skip) {
    return (results) => {
        var rejectedItems = results
                              .filter(item => item.state === "rejected")
                              .map(p => p.reason);
        var existsErrors = rejectedItems.filter(item => item.name && item.name === error);
        var otherErrors = rejectedItems.filter(item => !item.name || item.name !== error);

        // some unexpected problems
        if (otherErrors.length) {
            if (!skip) {
                otherErrors = otherErrors.concat(existsErrors);
            }
            throw otherErrors;
        }

        // some customers exists already
        if (existsErrors.length) {
            if (skip) {
                return fc();
            } else {
                throw existsErrors;
            }
        }

        // no problems, all imported; promises -> values
        return results.map(p => p.value);
    };
}

Importer.prototype.insertPlans = function () {
    return Q.allSettled(
        [this._insertPlan(this.dataSource, Importer.PLANS.PRO_ANNUALLY, 1, "year"),
          this._insertPlan(this.dataSource, Importer.PLANS.PRO_MONTHLY, 1, "month"),
          this._insertPlan(this.dataSource, Importer.PLANS.PRO_QUARTERLY, 3, "month")])
      .then(listHandler(
          cm.import.PLAN_EXISTS_ERROR,
          cm.import.listAllPlans.bind(null, this.dataSource),
          this.skip));
};

Importer.prototype.insertCustomers = function(customers) {
    customers = customers.slice(0, 100);
    var cap = this._cap(MAX_PARALLEL_CUSTOMERS_REQUESTS, "customers");

    customers.map(info => cap.limit(
        this._insertCustomer.bind(this, info[0], info[1])
    ));

    return cap.result.then(listHandler(
          cm.import.CUSTOMER_EXISTS_ERROR,
          cm.import.listAllCustomers.bind(null, this.dataSource),
          this.skip));
};

Importer.prototype._countryCode = function(longIsoCountry) {
    var data = cd.lookup.countries({name: longIsoCountry})[0];
    return data ? data.alpha2 : undefined;
};

/**
 * Necessary, because we can't send 60 000 HTTP requests all at once -> Out of memory
 */
Importer.prototype._cap = function(limit, desc) {
    var counter = 0,
        pending = 0,
        allData = [],
        all = Q.defer();

    var q = queue(limit, (call, done) => {
        if (++counter % 1000 === 0) {
            logger.debug("Sending " + counter + " " + desc + " request...");
        }
        call()
        /* keeping API of allSettled, not using it, because the final promises don't exist
           at time of returning of our artificial promise. */
            .then(value => allData.push({value, state: "fulfilled"}),
                  reason => allData.push({reason, state: "rejected"}))
            .fin(() => {
                pending--;
                if (!pending) {
                    logger.info("Processed " + counter + " " + desc);
                    all.resolve(allData);
                }
                done();
            });
    });

    return {
        /** call must be bound function returning promise */
        limit: function (call) {
            pending++;
            q.push(call);
        },
        /** listen to this promise for final result */
        result: all.promise
    };

};

Importer.prototype._insertCustomer = function(accountId, info) {

    return cm.import.importCustomer(this.dataSource,
            accountId,
            info.Account.Name,
            undefined,
            undefined,
            this._countryCode(info.BillToContact.Country) || undefined,
            String(info.BillToContact.State) || undefined,
            info.BillToContact.City || undefined,
            String(info.BillToContact.PostalCode));
};

Importer.prototype.insertInvoices = function(customerUuid, invoicesToImport) {
    if (!invoicesToImport.length) {
        return Q();
    }
    logger.debug("Saving invoices", invoicesToImport.map(invo => invo.external_id));
    var self = this;
    return cm.import.importInvoices(customerUuid, invoicesToImport)
        .catch((err) => {
            if (self.skip && err.statusCode === 422) {
                return Q();
            } else {
                throw err;
            }});
};

exports.Invoice = cm.import.Invoice;

exports.Importer = Importer;
