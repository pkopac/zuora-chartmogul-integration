"use strict";
/* eslint-env node, jasmine */

// var Importer = require("../importer.js").Importer;
var Transformer = require("../transformer.js").Transformer;
var diff = require("deep-diff").diff;
//var logger = require("log4js").getLogger("spec");

describe("Transformer", function(){
    it("inserts one customer per account", function(){
        var loader = {},
            importer = jasmine.createSpyObj("importer", ["insertCustomers"]);
        var tested = new Transformer(loader, importer);

        const EXPECTED1 = {someInfo: "info"},
            EXPECTED2 = {thisIsProcessedOnDifferentLayer: "so it can be whatever"},
            SOME_ITEMS = {acc1Id: [EXPECTED1, {}], acc2: [EXPECTED2]};

        tested.importCustomers(SOME_ITEMS);

        expect(importer.insertCustomers)
            .toHaveBeenCalledWith([["acc1Id", EXPECTED1], ["acc2", EXPECTED2]]);
        expect(importer.insertCustomers.calls.count()).toEqual(1);
    });

    const ACCOUNT1 = "acc1",
        ACCOUNT2 = "acc2",
        ACCOUNT3 = "acc3",
        ACC1_ITEM1 = {InvoiceItem: {AccountingCode: "FREE"}, Account: {AccountNumber: ACCOUNT1}, Invoice: {Amount : 0, Status: "Posted"}, Subscription: {}},
        ACC1_ITEM2 = {InvoiceItem: {AccountingCode: "NON_FREE"}, Account: {AccountNumber: ACCOUNT1}, Invoice: {Amount : 10, Status: "Posted"}, Subscription: {}},
        ITEMS = [ACC1_ITEM1,
                // ACCOUNT2 should be filtered
                {InvoiceItem: {AccountingCode: "FREE"}, Account: {AccountNumber: ACCOUNT2}, Invoice: {Amount : 0}, Subscription: {}},
                // ACCOUNT1 has a non-free invoice item that costed something
                ACC1_ITEM2,
                // ACCOUNT3 should be filtered, since it paid nothing ever
                {InvoiceItem: {AccountingCode: "NON_FREE"}, Account: {AccountNumber: ACCOUNT3}, Invoice: {Amount : 0}, Subscription: {}}];

    it("filters out accounts with only FREE items that haven't paid anything", function(){
        var loader = {},
            importer = {};
        var tested = new Transformer(loader, importer);

        var result = tested.filterAndGroupItems(ITEMS);
        expect(result[ACCOUNT1])
            .toEqual([ACC1_ITEM2]);
        expect(result[ACCOUNT2])
            .toBe(undefined);
        expect(result[ACCOUNT3])
            .toBe(undefined);
    });

    it("fails on missing data from Zuora", function(){
        var loader = {},
            importer = {};
        var tested = new Transformer(loader, importer),
            badItems = [{InvoiceItem: {AccountingCode: "NON_FREE"}, Account: {AccountNumber: ACCOUNT3}, Invoice: {Amount : 0}}];
        var call = tested.filterAndGroupItems.bind(tested, ITEMS.concat(badItems));

        expect(call).toThrowError("Missing data from Zuora!");
    });

    describe("Secondary", function(){
        it("custom Account ID is propagated from loader settings", function(){
            var tested = new Transformer({customId: "blabla"}, {});
            const TEST_ITEM = {InvoiceItem: {AccountingCode: "NON_FREE"}, Account: {blabla: ACCOUNT1}, Invoice: {Amount : 10, Status: "Posted"}, Subscription: {}};
            var result = tested.filterAndGroupItems([TEST_ITEM]);
            expect(diff({"acc1": [TEST_ITEM]}, result)).toEqual();
        });
    });
});
