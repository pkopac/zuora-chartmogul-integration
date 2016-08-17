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
    /* This is mostly because working with keys that have dashes in them in JavaScript is a pain. */
    this.MONGO_TRANSFORM = {
        mrr: entry => { return {
            newBusiness: entry["mrr-new-business"],
            expansion: entry["mrr-expansion"],
            contraction: entry["mrr-contraction"],
            churn: entry["mrr-churn"],
            reactivation: entry["mrr-reactivation"]
        }; },
        all: entry => { return {
            customerChurnRate: entry["customer-churn-rate"],
            mrrChurnRate: entry["mrr-churn-rate"],
            ltv: entry["ltv"],
            customers: entry["customers"],
            asp: entry["asp"],
            arpa: entry["arpa"],
            arr: entry["arr"],
            mrr: entry["mrr"]
        }; },
        activities: entry => {
            delete entry.customer_external_id;
            delete entry.date;
            return entry; },
        subscriptions: entry => {
            return {
                "startDate": new Date(entry["start-date"]),
                "endDate": new Date(entry["end-date"]),
                "billingCycle": entry["billing-cycle"],
                "billingCycleCount": entry["billing-cycle-count"],
                "currency": entry["currency"],
                "currencySign": entry["currency-sign"],
                "plan": entry["plan"],
                "quantity": entry["quantity"],
                "mrr": entry["mrr"],
                "arr": entry["arr"],
                "status": entry["status"]
            }; }
    };
    /* How the data is indexed in MongoDB */
    this.MONGO_ID = {
        mrr: entry => {return new Date(entry.date); },
        all: entry => {return new Date(entry.date); },
        activities: entry => {return {customer: entry.customer_external_id, date: new Date(entry.date)}; },
        subscriptions: entry => {return {customer: entry.customer_external_id, subscription: entry.id}; }
    };
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

function check(params, field) {
    if (!params[field]) {
        throw new Error("Please add param " + field);
    }
}

Exporter.prototype.run = function (type, dataSource, outputType, outputFile, pwd, params) {
    if (outputType === "mongo") {
        if (!(this.mongo && this.mongo.collections && this.mongo.collections[type] && this.mongo.url)) {
            throw new Error("There's no export.mongo.url or export.mongo.collections.type_of_export for MongoDB connection in config file!");
        }
    }
    if (outputFile && !outputFile.startsWith("/") && pwd) {
        path.join(pwd, outputFile);
    }
    if (type in {"mrr": 1, "all": 1}) {
        check(params, "end-date");
        check(params, "start-date");
    }

    var dataPromise;
    switch(type) {
    case "mrr":
        dataPromise = cm.metrics.retrieveMRR(params["start-date"], params["end-date"], "day");
        break;
    case "all":
        dataPromise = cm.metrics.retrieveAll(params["start-date"], params["end-date"], "day");
        break;
    case "activities":
        dataPromise = fetchAllTheThings(dataSource, "listAllActivities");
        break;
    case "subscriptions":
        dataPromise = fetchAllTheThings(dataSource, "listAllSubscriptions");
        break;
    default:
        throw new Error("Unsupported export: " + type + "! Type --help.");
    }

    switch(outputType) {
    case "mongo":
        return saveToMongo(this.mongo.url, this.mongo.collections[type], this.MONGO_ID[type], this.MONGO_TRANSFORM[type], dataPromise);
    case "json":
    case "csv":
        return dataPromise.then(transform(outputType))
                .then(data => Q.ninvoke(fs, "writeFile", outputFile, data));
    default:
        throw new Error("Unsupported type: " + outputType + " Supported types: " + Object.keys(this.SUPPORTED_TYPES));
    }
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

function fetchAllTheThings(dataSource, action) {
    var customerExternalIds;
    return getDataSource(dataSource)
        .then(ds => Q.all([ds, cm.import.listAllCustomers(ds)]))
        .spread((ds, customers) => {
            logger.info("Fetched %d customers", customers.length);
            customerExternalIds = customers.map(c => c.external_id);
            return Q.all(customers.map(c => cm.metrics[action](c.uuid)));
        })
        .then(metrics => {
            logger.info("Saving all customer data...");
            metrics = metrics.filter(Boolean);
            logger.debug("%d customers have data", metrics.length);
            for (var i = 0; i < metrics.length; i++) {
                var e_id = customerExternalIds[i];
                // logger.trace(metrics[i]);
                metrics[i].forEach(a => a.customer_external_id = e_id);
            }
            return _.flatten(metrics);
        });
}

function saveToMongo(url, collection, id, transform, cmData) {
    var MongoClient = require("mongodb").MongoClient,
        db;

    return Q(MongoClient.connect(url))
        .then(connection => Q.all([db = connection, Q.ninvoke(db, "collection", collection), cmData]))
        .spread((db, col, data) => {
            var bulk = col.initializeUnorderedBulkOp();
            (Array.isArray(data.entries) ? data.entries : data)
                .forEach(entry => {
                    bulk.find({_id: id(entry)})
                        .upsert()
                        .updateOne({$set: transform(entry)});
                });
            return bulk.execute();
        })
        .then(bulk => logger.info("Upload completed: ", bulk.isOk()))
        .finally(() => db && db.close());
}

exports.Exporter = Exporter;
