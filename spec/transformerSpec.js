"use strict";
/* eslint-env node, jasmine */

var Importer = require("../importer.js").Importer;
var Transformer = require("../transformer.js").Transformer;
var diff = require('deep-diff').diff;

describe("Transformer", function(){
    it("inserts one customer per account", function(){
        var loader = {},
            importer = jasmine.createSpyObj("importer", ["insertCustomer"]);
        var tested = new Transformer(loader, importer);

        const EXPECTED = {someInfo: "info"},
            SOME_ITEMS = {acc1Id: [EXPECTED, {}]};

        tested.importCustomersFromItems(SOME_ITEMS);

        expect(importer.insertCustomer)
            .toHaveBeenCalledWith("acc1Id", EXPECTED);
        expect(importer.insertCustomer.calls.count()).toEqual(1);
    });

    const ACCOUNT1 = "acc1",
        ACCOUNT2 = "acc2",
        ACCOUNT3 = "acc3",
        ACC1_ITEM1 = {AccountingCode: "FREE", Account: {AccountNumber: ACCOUNT1}, Invoice: {Amount : 0}},
        ACC1_ITEM2 = {AccountingCode: "NON_FREE", Account: {AccountNumber: ACCOUNT1}, Invoice: {Amount : 10}},
        ITEMS = [ACC1_ITEM1,
                // ACCOUNT2 should be filtered
                {AccountingCode: "FREE", Account: {AccountNumber: ACCOUNT2}, Invoice: {Amount : 0}},
                // ACCOUNT1 has a non-free invoice item that costed something
                ACC1_ITEM2,
                // ACCOUNT3 should be filtered, since it paid nothing ever
                {AccountingCode: "NON_FREE", Account: {AccountNumber: ACCOUNT3}, Invoice: {Amount : 0}}];

    it("filters out accounts with only FREE items that haven't paid anything", function(){
        var loader = {},
            importer = {};
        var tested = new Transformer(loader, importer);

        var result = tested.filterAndGroupItems(ITEMS);

        expect(result[ACCOUNT1])
            .toEqual([ACC1_ITEM1, ACC1_ITEM2]);
        expect(result[ACCOUNT2])
            .toBe(undefined);
        expect(result[ACCOUNT3])
            .toBe(undefined);
    });

    const PLANS_BY_ID = {};
    var uuid = 0;
    Object.keys(Importer.PLANS)
        .forEach(key =>
            PLANS_BY_ID[Importer.PLANS[key]] = uuid++);
    const CUSTOMERS_BY_ID = {};
    CUSTOMERS_BY_ID[ACCOUNT1] = uuid++;

    const PAID_SIMPLEST_ITEM = {
        Invoice: {
            InvoiceNumber: "INVO-123",
            Amount : 10,
            PostedDate: "2012-12-07T14:53:49+0000",
            DueDate: "2013-01-06"
        },
        AccountingCode: "MONTHLYFEE",
        ChargeAmount: 10,
        Quantity: 1,
        ChargeName: "Users",
        Id: "ITEM-001",
        "ServiceEndDate": "2013-03-09",
        "ServiceStartDate": "2012-12-10",
        Account: {
            AccountNumber: ACCOUNT1,
            Currency: "US Dollar"
        },
        Subscription: {
            Name: "SUB-001"
        }
    };

    describe("generates invoices", function(){

        it("simple unpaid invoice for $10", function(){
            var loader = {},
                importer = jasmine.createSpyObj("importer", ["insertInvoices"]);
            var tested = new Transformer(loader, importer);

            const PAID_INVOICE_ITEMS1 = {};
            PAID_INVOICE_ITEMS1[ACCOUNT1] = [PAID_SIMPLEST_ITEM];
            const EXPECTED_RESULTS1 = [{
                "external_id": "INVO-123",
                "date": "2012-12-07T14:53:49+00:00",
                "currency": "USD",
                "due_date": "2013-01-06T00:00:00+00:00",
                "line_items": [
                    {
                        "type": "subscription",
                        "subscription_external_id": "SUB-001",
                        "plan_uuid": 1,
                        "service_period_start": "2012-12-10T00:00:00+00:00",
                        "service_period_end": "2013-03-09T00:00:00+00:00",
                        "amount_in_cents": 1000,
                        "prorated": false,
                        "quantity": 1,
                        "discount_amount_in_cents": 0,
                        "external_id": "ITEM-001"
                    }
                ],
                "transactions": []
            }];

            tested.makeInvoices(
                PLANS_BY_ID, CUSTOMERS_BY_ID, PAID_INVOICE_ITEMS1,
                {}, {}, {},
                {}, {}, {}
            );
            expect(JSON.stringify(
                diff(importer.insertInvoices.calls.argsFor(0),
                    [3, EXPECTED_RESULTS1]), null, 4)
            ).toEqual();
            // expect()
            //     .toHaveBeenCalledWith(CUSTOMERS_BY_ID[ACCOUNT1], [{}]);
            expect(importer.insertInvoices.calls.count()).toEqual(1);

        });



        it("prorated downgrade", function(){
            var loader = {},
                importer = jasmine.createSpyObj("importer", ["insertInvoices"]);
            var tested = new Transformer(loader, importer);

            const PRORATED_CREDIT = {
                Invoice: {
                    InvoiceNumber: "INVO-123",
                    Amount : 0,
                    PostedDate: "2012-12-07T14:53:49+0000",
                    DueDate: "2013-01-06"
                },
                AccountingCode: "MONTHLYFEE",
                ChargeAmount: 20,
                Quantity: 2,
                ChargeName: "Users -- Proration Credit",
                Id: "ITEM-001",
                "ServiceEndDate": "2013-03-09",
                "ServiceStartDate": "2012-12-10",
                Account: {
                    AccountNumber: ACCOUNT1,
                    Currency: "US Dollar"
                },
                Subscription: {
                    Name: "SUB-001"
                }
            };

            const PRORATED_DOWNGRADE_ITEM = {
                Invoice: {
                    InvoiceNumber: "INVO-123",
                    Amount : 0,
                    PostedDate: "2012-12-07T14:53:49+0000",
                    DueDate: "2013-01-06"
                },
                AccountingCode: "MONTHLYFEE",
                ChargeAmount: 10,
                Quantity: 2,
                ChargeName: "Users -- Proration",
                Id: "ITEM-001",
                "ServiceEndDate": "2013-03-09",
                "ServiceStartDate": "2013-02-01",
                Account: {
                    AccountNumber: ACCOUNT1,
                    Currency: "US Dollar"
                },
                Subscription: {
                    Name: "SUB-001"
                }
            };

            const PRORATED_DOWNGRADE = {};
            PRORATED_DOWNGRADE[ACCOUNT1] = [PRORATED_CREDIT, PRORATED_DOWNGRADE_ITEM];

            var EXPECTED_RESULTS = {};

            tested.makeInvoices(
                PLANS_BY_ID, CUSTOMERS_BY_ID, PRORATED_DOWNGRADE,
                {}, {}, {},
                {}, {}, {}
            );
            expect(JSON.stringify(
                diff(importer.insertInvoices.calls.argsFor(0),
                    [3, EXPECTED_RESULTS]), null, 4)
            ).toEqual();
            // expect()
            //     .toHaveBeenCalledWith(CUSTOMERS_BY_ID[ACCOUNT1], [{}]);
            expect(importer.insertInvoices.calls.count()).toEqual(1);

        });

        //TODO: two invoices with one payment assigned to both
        //TODO: partial payment
        //TODO: partial refund
    });
});
