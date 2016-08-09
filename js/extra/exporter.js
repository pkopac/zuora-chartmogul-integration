"use strict";

var cm = require("chartmoguljs"),
    Q = require("q"),
    _ = require("lodash"),
    fs = require("fs"),
    path = require("path"),
    json2csv = require("json2csv"),
    getDataSource = new (require("../importer.js").Importer)().getDataSourceOrFail,
    logger = require("log4js").getLogger("exporter");

var Exporter = function() {
    this.SUPPORTED_TYPES = {csv: 1, json: 1, mongo: 1};
};

Exporter.prototype.configure = function (cmJson, exportJson) {
    logger.debug("Configuring chartmogul client...");
    cm.config(cmJson);
    if (!exportJson) {
        return this;
    }
    this.mongo = exportJson.mongo;
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

function saveToMongo(url, collection, mrr) {
    var MongoClient = require("mongodb").MongoClient,
        db;

    return Q(MongoClient.connect(url))
        .then(connection => Q.all([db = connection, Q.ninvoke(db, "collection", collection), mrr]))
        .spread((db, col, data) => {
            var bulk = col.initializeUnorderedBulkOp();
            data.entries.forEach(entry => {
                bulk.find({_id: new Date(entry.date)})
                    .upsert()
                    .updateOne({$set: {
                        newBusiness: entry["mrr-new-business"],
                        expansion: entry["mrr-expansion"],
                        contraction: entry["mrr-contraction"],
                        churn: entry["mrr-churn"],
                        reactivation: entry["mrr-reactivation"]
                    }});
            });
            return bulk.execute();
        })
        .then(bulk => logger.info("Upload completed: ", bulk.isOk()))
        .finally(() => db && db.close());
}

//TODO: refactor common code into one function
Exporter.prototype.run_subscriptions = function (dataSource, exportType, outputFile, pwd) {
    if (! (exportType in this.SUPPORTED_TYPES)) {
        throw new Error("Unsupported type: " + exportType + " Supported types: " + Object.keys(this.SUPPORTED_TYPES));
    }
    if (exportType === "mongo") {
        throw new Error("Only MRR Mongo export implemented.");
    }
    if (outputFile && !outputFile.startsWith("/") && pwd) {
        path.join(pwd, outputFile);
    }
    return fetchAllTheMetrics(dataSource, exportType, outputFile, "listAllSubscriptions");
};

Exporter.prototype.run_activities = function (dataSource, exportType, outputFile, pwd) {
    if (! (exportType in this.SUPPORTED_TYPES)) {
        throw new Error("Unsupported type: " + exportType + " Supported types: " + Object.keys(this.SUPPORTED_TYPES));
    }
    if (exportType === "mongo") {
        throw new Error("Only MRR Mongo export implemented.");
    }
    if (outputFile && !outputFile.startsWith("/") && pwd) {
        path.join(pwd, outputFile);
    }
    return fetchAllTheMetrics(dataSource, exportType, outputFile, "listAllActivities");
};

function check(params, field) {
    if (!params[field]) {
        throw new Error("Please add param " + field);
    }
}

Exporter.prototype.run_mrr = function (dataSource, exportType, outputFile, pwd, params) {
    check(params, "end-date");
    check(params, "start-date");

    if (! (exportType in this.SUPPORTED_TYPES)) {
        throw new Error("Unsupported type: " + exportType + " Supported types: " + Object.keys(this.SUPPORTED_TYPES));
    }

    if (exportType === "mongo" && !(this.mongo && this.mongo.collection && this.mongo.url)) {
        throw new Error("There's no export.mongo.url or export.mongo.collection for MongoDB connection in config file!");
    }

    if (outputFile && !outputFile.startsWith("/") && pwd) {
        path.join(pwd, outputFile);
    }

    var mrr = cm.metrics.retrieveMRR(params["start-date"], params["end-date"], "day");
    if (exportType === "mongo") {
        return saveToMongo(this.mongo.url, this.mongo.collection, mrr);
    } else {
        return mrr.then(transform(exportType))
            .then(data => Q.ninvoke(fs, "writeFile", outputFile, data));
    }
};

exports.Exporter = Exporter;
