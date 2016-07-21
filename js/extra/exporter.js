"use strict";

var cm = require("chartmoguljs"),
    Q = require("q"),
    _ = require("lodash"),
    fs = require("fs"),
    json2csv = require("json2csv"),
    getDataSource = new (require("../importer.js").Importer)().getDataSourceOrFail,
    logger = require("log4js").getLogger("exporter");

var Exporter = function() {
    this.SUPPORTED_TYPES = {csv: 1};
};

Exporter.prototype.configure = function (json) {
    logger.debug("Configuring chartmogul client...");
    cm.config(json);
    return this;
};

Exporter.prototype.run = function (dataSource, exportType, outputFile) {
    if (! (exportType in this.SUPPORTED_TYPES)) {
        throw new Error("Unsupported type: " + exportType);
    }

    if (exportType !== "csv") {
        throw new Error("Not yet implemented! Supported types: " + Object.keys(this.SUPPORTED_TYPES));
    }
    
    var customerExternalIds;
    return getDataSource(dataSource)
        .then(ds => Q.all([ds, cm.import.listAllCustomers(ds)]))
        .spread((ds, customers) => {
            logger.info("Fetched %d customers", customers.length);
            customerExternalIds = customers.map(c => c.external_id);
            return Q.all(customers.map(c => cm.metrics.listAllActivities(c.uuid)));
        })
        .then(activities => {
            logger.info("Saving customer activities as %s (%s)", outputFile, exportType);
            activities = activities.filter(Boolean);
            logger.debug("%d customers have any activities", activities.length);
            for (var i = 0; i < activities.length; i++) {
                var e_id = customerExternalIds[i];
                logger.trace(activities[i]);
                activities[i].forEach(a => a.customer_external_id = e_id);
            }
            return _.flatten(activities);
        })
        .then(activities => json2csv({ data: activities}))
        .then(csvString => Q.ninvoke(fs, "writeFile", outputFile, csvString));
};

exports.Exporter = Exporter;
