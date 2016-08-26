//TODO: the custom lib can be removed when official has something like "listAllCustomers".
const cm = require("chartmoguljs"),
    ChartMogul = require("chartmogul-node"),
    Q = require("q"),
    MongoClient = require("mongodb").MongoClient,
    logger = require("log4js").getLogger("enrichment");

/**
 * This module uses both custom and official CM libs.
 */
var Enrichment = function() {
    this.TYPES = {
        string: "String",
        number: "Integer",
        object: "Timestamp",
        boolean: "Boolean"
    };
};

Enrichment.prototype.configure = function (cmJson, enrichmentJson) {
    logger.debug("Configuring chartmogul clients...");
    cm.config(cmJson);
    this.cmConfig = new ChartMogul.Config(cmJson.accountToken, cmJson.secretKey);
    if (enrichmentJson) {
        this.mongo = enrichmentJson.mongo;
    }
    return this;
};

function unexpected(_id, key, val) {
    throw new Error("Unexpected value type: " + val + " for key: " + key + " id:" + _id);
}

function shorten(value) {
    return typeof value === "string" ? value.substring(0, 255) : value;
}

Enrichment.prototype.run = function () {
    if (!this.mongo || !this.mongo.url || !this.mongo.collections || !this.mongo.collections.attributesTags) {
        throw new Error("Please supply enrichment MongoDB configuration, see template.");
    }
    const colName = this.mongo.collections.attributesTags,
        URL = this.mongo.url,
        T = this.TYPES,
        cmConfig = this.cmConfig;
    return Q.all([
        cm.import.listAllCustomers(),
        MongoClient.connect(URL)
            .then(db => Q(db.collection(colName).find().toArray())
                .finally(() => db && db.close())
            )
    ])
        .spread((customers, data) => {
            var map = {};
            logger.info("All data loaded, uploading...");
            customers.forEach(c => map[c.external_id] = c.uuid);
            return Q.all(data.map(d =>
                Q.all([
                    d.attributes && Object.keys(d.attributes).length && map[d._id] &&
                    ChartMogul.Enrichment.CustomAttribute.add(cmConfig, map[d._id], {
                        "custom": Object.keys(d.attributes)
                            .map(key => ({
                                key,
                                type: T[typeof d.attributes[key]] || unexpected(d._id, key, d.attributes[key]),
                                value: shorten(d.attributes[key])
                            })
                        )}),
                    d.tags && d.tags.length &&
                    ChartMogul.Enrichment.Tag.add(cmConfig, map[d._id], {
                        "tags": d.tags
                    })
                ])
            ));
        })
        .tap(() => logger.info("Enrichment finished."));
};

exports.Enrichment = Enrichment;
