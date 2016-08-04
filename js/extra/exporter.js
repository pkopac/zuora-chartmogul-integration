"use strict";

var cm = require("chartmoguljs"),
    Q = require("q"),
    _ = require("lodash"),
    fs = require("fs"),
    json2csv = require("json2csv"),
    getDataSource = new (require("../importer.js").Importer)().getDataSourceOrFail,
    logger = require("log4js").getLogger("exporter");

var Exporter = function() {
    this.SUPPORTED_TYPES = {csv: 1, json: 1};
};

Exporter.prototype.configure = function (json) {
    logger.debug("Configuring chartmogul client...");
    cm.config(json);
    return this;
};


function transform(exportType) {
    return (data) =>  {
        if (exportType === "csv") {
            return json2csv({data});
        } else if (exportType === "json") {
            return JSON.stringify(data, null, 2);
        }
    };
}

function fetchAllTheMetrics(dataSource, exportType, outputFile, action) {
    var customerExternalIds;
    return getDataSource(dataSource)
        .then(ds => Q.all([ds, cm.import.listAllCustomers(ds)]))
        .spread((ds, customers) => {
            logger.info("Fetched %d customers", customers.length);
            customerExternalIds = customers.map(c => c.external_id);
            return Q.all(customers.map(c => cm.metrics[action](c.uuid)));
        })
        .then(metrics => {
            logger.info("Saving customer data as %s (%s)", outputFile, exportType);
            metrics = metrics.filter(Boolean);
            logger.debug("%d customers have any data", metrics.length);
            for (var i = 0; i < metrics.length; i++) {
                var e_id = customerExternalIds[i];
                // logger.trace(metrics[i]);
                metrics[i].forEach(a => a.customer_external_id = e_id);
            }
            return _.flatten(metrics);
        })
        .then(transform(exportType))
        .then(csv => Q.ninvoke(fs, "writeFile", outputFile, csv));
}

Exporter.prototype.run_subscriptions = function (dataSource, exportType, outputFile) {
    if (! (exportType in this.SUPPORTED_TYPES)) {
        throw new Error("Unsupported type: " + exportType + " Supported types: " + Object.keys(this.SUPPORTED_TYPES));
    }

    return fetchAllTheMetrics(dataSource, exportType, outputFile, "listAllSubscriptions");
};

Exporter.prototype.run_activities = function (dataSource, exportType, outputFile) {
    if (! (exportType in this.SUPPORTED_TYPES)) {
        throw new Error("Unsupported type: " + exportType + " Supported types: " + Object.keys(this.SUPPORTED_TYPES));
    }

    return fetchAllTheMetrics(dataSource, exportType, outputFile, "listAllActivities");
};

function check(params, field) {
    if (!params[field]) {
        throw new Error("Please add param " + field);
    }
}

Exporter.prototype.run_mrr = function (dataSource, exportType, outputFile, params) {
    check(params, "end-date");
    check(params, "start-date");
    if (! (exportType in this.SUPPORTED_TYPES)) {
        throw new Error("Unsupported type: " + exportType + " Supported types: " + Object.keys(this.SUPPORTED_TYPES));
    }

    return cm.metrics.retrieveMRR(params["start-date"], params["end-date"], "day")
        .then(transform(exportType))
        .then(csv => Q.ninvoke(fs, "writeFile", outputFile, csv));

};

exports.Exporter = Exporter;
