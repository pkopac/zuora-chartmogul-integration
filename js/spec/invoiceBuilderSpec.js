"use strict";
/* eslint-env node, jasmine */

var InvoiceBuilder = require("../invoiceBuilder.js").InvoiceBuilder;
var Invoice = require("../importer.js").Invoice;
var VError = require("verror");
var moment = require("moment");
var diff = require("deep-diff").diff;

describe("invoiceBuilder", function() {
    describe("getCurrency", function() {
        it("supported currency", function() {
            expect(function(){ InvoiceBuilder.getCurrency("UNSUPPORTED"); }).toThrowError(VError);
        });

        it("supported currency", function() {
            var currency = InvoiceBuilder.getCurrency("USD");
            expect(currency).toEqual("USD");
        });
    });

    describe("removePartialRefunds", function() {
        var invoice = {
            line_items: [
                { amount_in_cents: 10 },
                { amount_in_cents: 10 }
            ],
            transactions: [
                { type: "payment" },
                { type: "payment" },
                { type: "payment" },
                { type: "something" }
            ]
        };

        it("nothing paid or refunded", function() {
            var totalPayments = 0,
                totalRefunds = 0,
                result = InvoiceBuilder.removePartialRefunds({}, totalPayments, totalRefunds, 0);
            expect(result).toEqual(undefined);
        });

        it("is paid and optionally refunded", function() {
            var totalPayments = 20,
                totalRefunds = 20,
                result = InvoiceBuilder.removePartialRefunds(invoice, totalPayments, totalRefunds, 0);
            expect(result).toEqual(undefined);

            result = InvoiceBuilder.removePartialRefunds(invoice, totalPayments, 0, 0);
            expect(result).toEqual(undefined);
        });

        it("invoice adjusted", function() {
            let invoice = {
                line_items: [
                    { amount_in_cents: -10 },
                    { amount_in_cents: 10 }
                ]
            };

            var totalPayments = 10,
                totalRefunds = 10,
                result = InvoiceBuilder.removePartialRefunds(invoice, totalPayments, totalRefunds, 0);
            expect(result).toEqual(undefined);
        });

        it("partial refund", function() {
            var totalPayments = 20,
                totalRefunds = 10,
                totalCreditAdjusted = 10,
                result = InvoiceBuilder.removePartialRefunds(invoice, totalPayments, totalRefunds, totalCreditAdjusted);
            expect(result).toEqual(undefined);

            var expectedTransactions = [
                { type: "payment" },
                { type: "payment" },
                { type: "payment" }
            ];
            expect(diff(invoice.transactions, expectedTransactions)).toEqual();
        });

        it("unexpected payment case", function() {
            var totalPayments = 0,
                totalRefunds = 10,
                totalCreditAdjusted = 10;
            expect(function(){ InvoiceBuilder.removePartialRefunds(
                invoice, totalPayments, totalRefunds, totalCreditAdjusted); }).toThrowError(VError);
        });
    });

    describe("addPayments", function() {
        it("missing payments", function() {
            var total = InvoiceBuilder.addPayments(0);
            expect(total).toEqual(0);

            total = InvoiceBuilder.addPayments([]);
            expect(total).toEqual(0);
        });

        var zuoraPayments = [
            {
                Payment: {
                    CreatedDate: "2016-05-01",
                    Status: "Processed",
                    PaymentNumber: "payNum"
                },
                Refund: {
                    RefundDate: "2016-05-1",
                    Status: "Processed",
                    RefundNumber: "refNum"
                },
                Invoice: { InvoiceNumber: "invNum" },
                InvoicePayment: { Amount: 10 },
                RefundInvoicePayment: { RefundAmount: 20 }
            }
        ];

        it("add transaction to invoice - payment", function() {
            var invoice = new Invoice("default", moment.utc("1970-01-01"), "default", moment.utc("1970-01-01")),
                total = InvoiceBuilder.addPayments(zuoraPayments, invoice, "Payment");
            expect(total).toEqual(1000);

            var expectedTransactions = [
                {
                    date: "2016-05-01T00:00:00+00:00",
                    type: "payment",
                    result: "successful",
                    external_id: "payNum-invNum"
                }
            ];
            expect(diff(invoice.transactions, expectedTransactions)).toEqual();
        });

        it("add transaction to invoice - refund", function() {
            var invoice = new Invoice("default", moment.utc("1970-01-01"), "default", moment.utc("1970-01-01")),
                total = InvoiceBuilder.addPayments(zuoraPayments, invoice, "Refund");
            expect(total).toEqual(2000);

            var expectedTransactions = [
                {
                    date: "2016-05-01T00:00:00+00:00",
                    type: "refund",
                    result: "successful",
                    external_id: "refNum-invNum"
                }
            ];
            expect(diff(invoice.transactions, expectedTransactions)).toEqual();
        });

        it("invalid type", function() {
            expect(function(){ InvoiceBuilder.addPayments(["something"], ["something"], "Unknown"); }).toThrowError(VError);
        });
    });

    describe("processDiscounts", function() {
        it("works", function() {
            var invoiceItems = [
                {
                    InvoiceItem: {
                        ChargeName: "Initial Discount: 1 Year",
                        ChargeAmount: 10,
                        AppliedToInvoiceItemId: "id1"
                    }
                },
                {
                    InvoiceItem: {
                        ChargeName: "Initial Discount: 1 Year",
                        ChargeAmount: 20,
                        AppliedToInvoiceItemId: "id2"
                    }
                },
                {
                    InvoiceItem: {
                        ChargeName: "Users",
                        ChargeAmount: 30,
                        AppliedToInvoiceItemId: "id3"
                    }
                }
            ];

            var discountMap = InvoiceBuilder.processDiscounts(invoiceItems);
            expect(diff(discountMap, { id1: 10, id2: 20 })).toEqual();
        });
    });

    describe("processCreditAdjustments", function() {
        it("works", function() {
            var creditAdjustments = [
                { CreditBalanceAdjustment: {Amount: 10, Type: "Decrease"} },
                { CreditBalanceAdjustment: {Amount: 10, Type: "Decrease"} },
                { CreditBalanceAdjustment: {Amount: 20, Type: "Increase"} }
            ];
            var adjustments = InvoiceBuilder.processCreditAdjustments(creditAdjustments);
            expect(adjustments).toEqual(0);
        });
    });

    describe("processInvoiceAdjustments", function() {
        it("works", function() {
            var invoiceAdjustments = [
                {InvoiceAdjustment: {Amount: 10, Type: "Credit"}},
                {InvoiceAdjustment: {Amount: 10, Type: "Credit"}},
                {InvoiceAdjustment: {Amount: 20, Type: "Charge"}}
            ];
            var adjustments = InvoiceBuilder.processInvoiceAdjustments(invoiceAdjustments);
            expect(adjustments).toEqual(0);
        });
    });

    describe("processAdjustments", function() {
        it("works", function() {
            var invoiceItemAdjustments = [
                {InvoiceItem: {Id: "id1"}, InvoiceItemAdjustment: {Amount: 10, Type: "Credit"}},
                {InvoiceItem: {Id: "id2"}, InvoiceItemAdjustment: {Amount: 20, Type: "Credit"}},
                {InvoiceItem: {Id: "id3"}, InvoiceItemAdjustment: {Amount: 30, Type: "Charge"}}
            ];

            var expected = [{id1: -10, id2: -20, id3: 30}, 0],
                adjustments = InvoiceBuilder.processAdjustments(invoiceItemAdjustments);
            expect(diff(adjustments, expected)).toEqual();
        });
    });

    describe("testTotalOfInvoiceEqualsTotalOfLineItems", function() {
        var items = [
            { amount_in_cents: 0 },
            { amount_in_cents: 1000 },
            { amount_in_cents: 2000 }
        ];

        it("total of invoice matches", function() {
            var firstItem = { Invoice: {Amount: 30 } };
            expect(function() { InvoiceBuilder.testTotalOfInvoiceEqualsTotalOfLineItems(firstItem, items, 0, 0); }).not.toThrow();
        });

        it("total of invoice does not match", function() {
            var firstItem = { Invoice: {Amount: 50 } };
            expect(function() { InvoiceBuilder.testTotalOfInvoiceEqualsTotalOfLineItems(firstItem, items, 0, 0); }).toThrowError(VError);
        });
    });

    describe("testCreditAdjustmentCorrect", function() {
        var creditAdjustments = [
            { CreditBalanceAdjustment: {Amount: 10, Type: "Decrease"} },
            { CreditBalanceAdjustment: {Amount: 10, Type: "Decrease"} },
            { CreditBalanceAdjustment: {Amount: 30, Type: "Increase"} }
        ];

        var invoice = {
            line_items: [ { amount_in_cents: 0 }, { amount_in_cents: 1000 }, { amount_in_cents: -2000 } ],
            transactions: [{ result: "successful" }, { result: "successful" }, { result: "failed" }]
        };

        var totalPayments = 10,
            totalRefunds = 10;

        it("credit adjusted - incorrect cashflow", function() {
            var creditAdjusted = InvoiceBuilder.testCreditAdjustmentCorrect(invoice, creditAdjustments, totalPayments, totalRefunds);
            expect(creditAdjusted).toEqual(-1000);
        });

        it("credit adjusted - throws error", function() {
            expect(function() { InvoiceBuilder.testCreditAdjustmentCorrect(invoice, creditAdjustments, 0, 0); }).toThrowError(VError);
        });

        it("credit not adjusted", function() {
            var creditAdjusted = InvoiceBuilder.testCreditAdjustmentCorrect(invoice, [], totalPayments, totalRefunds);
            expect(creditAdjusted).toEqual(0);
        });
    });

    describe("generates invoices", function(){
        const PLANS_BY_ID = {zuora_plan_id: "plan_cm_uuid"};

        const PAID_SIMPLEST_ITEM = {
            Amendment: {
                Type: "UpdateProduct"
            },
            Invoice: {
                InvoiceNumber: "INVO-123",
                Amount : 10,
                PostedDate: "2012-12-07T14:53:49+0000",
                DueDate: "2013-01-06"
            },
            ProductRatePlan: {
                Id: "zuora_plan_id"
            },
            InvoiceItem: {
                ChargeAmount: 10,
                Quantity: 1,
                ChargeName: "Users",
                Id: "ITEM-001",
                "ServiceEndDate": "2013-03-09",
                "ServiceStartDate": "2012-12-10"
            },
            Account: {
                Currency: "USD"
            },
            Subscription: {
                Name: "SUB-001"
            }
        };

        it("simple unpaid invoice for $10", function(){

            const invoiceItems = [PAID_SIMPLEST_ITEM],
                itemAdjsByInvoice = [],
                invoiceAdjsByInvoice = [],
                creditAdjsByInvoice = [],
                paymentsByInvoice = [],
                refundsByInvoice = [],
                EXPECTED = {
                    "external_id": "INVO-123",
                    "date": "2012-12-07T14:53:49+00:00",
                    "currency": "USD",
                    "due_date": "2013-01-06T00:00:00+00:00",
                    "line_items": [
                        {
                            "type": "subscription",
                            "subscription_external_id": "SUB-001",
                            "plan_uuid": "plan_cm_uuid",
                            "service_period_start": "2012-12-10T00:00:00+00:00",
                            "service_period_end": "2013-03-09T23:59:59+00:00", // end of period to end of day
                            "amount_in_cents": 1000,
                            "prorated": false,
                            "quantity": 1,
                            "discount_amount_in_cents": 0,
                            "external_id": "ITEM-001",
                            "__amendmentType": "UpdateProduct"
                        }
                    ],
                    "transactions": []
                };

            var invoice = InvoiceBuilder.buildInvoice("INVO-123",
                invoiceItems,
                PAID_SIMPLEST_ITEM.Invoice.PostedDate,
                PAID_SIMPLEST_ITEM.Invoice.DueDate,
                PAID_SIMPLEST_ITEM.Account.Currency,
                itemAdjsByInvoice,
                invoiceAdjsByInvoice,
                creditAdjsByInvoice,
                paymentsByInvoice,
                refundsByInvoice,
                PLANS_BY_ID
            );

            expect(JSON.stringify(diff(EXPECTED, invoice), null, 4)).toEqual();
        });

        it("prorated downgrade", function(){

            const PRORATED_CREDIT = {
                Invoice: {
                    InvoiceNumber: "INVO-123",
                    Amount : -10,
                    PostedDate: "2012-12-07T14:53:49+0000",
                    DueDate: "2013-01-06"
                },
                InvoiceItem: {
                    ChargeAmount: -20,
                    Quantity: 2,
                    ChargeName: "Users -- Proration Credit",
                    Id: "ITEM-001",
                    "ServiceEndDate": "2013-03-09",
                    "ServiceStartDate": "2012-12-10"
                },
                Account: {
                    AccountNumber: "whatever",
                    Currency: "USD"
                },
                Subscription: {
                    Name: "SUB-001"
                },
                ProductRatePlan: {
                    Id: "zuora_plan_id"
                },
                Amendment: {
                    Type: "UpdateProduct"
                }
            };

            const PRORATED_DOWNGRADE_ITEM = {
                Invoice: {
                    InvoiceNumber: "INVO-123",
                    Amount : -10,
                    PostedDate: "2012-12-07T14:53:49+0000",
                    DueDate: "2013-01-06"
                },
                InvoiceItem: {
                    ChargeAmount: 10,
                    Quantity: 1,
                    ChargeName: "Users -- Proration",
                    Id: "ITEM-001",
                    "ServiceEndDate": "2013-03-09",
                    "ServiceStartDate": "2013-02-01"
                },
                Account: {
                    AccountNumber: "whatever",
                    Currency: "USD"
                },
                Subscription: {
                    Name: "SUB-001"
                },
                ProductRatePlan: {
                    Id: "zuora_plan_id"
                },
                Amendment: {
                    Type: "UpdateProduct"
                }
            };

            const invoiceItems = [PRORATED_CREDIT, PRORATED_DOWNGRADE_ITEM],
                itemAdjsByInvoice = [],
                invoiceAdjsByInvoice = [],
                creditAdjsByInvoice = [],
                paymentsByInvoice = [],
                refundsByInvoice = [],
                EXPECTED = {
                    "external_id": "INVO-123",
                    "date": "2012-12-07T14:53:49+00:00",
                    "currency": "USD",
                    "due_date": "2013-01-06T00:00:00+00:00",
                    "line_items": [
                        {
                            "type": "subscription",
                            "subscription_external_id": "SUB-001",
                            "plan_uuid": "plan_cm_uuid",
                            "service_period_start": "2013-02-01T00:00:00+00:00",
                            "service_period_end": "2013-03-09T23:59:59+00:00", // end of period to end of day
                            "amount_in_cents": -1000,
                            "prorated": true,
                            "quantity": -1,
                            "discount_amount_in_cents": 0,
                            "external_id": "ITEM-001",
                            "__amendmentType": "UpdateProduct"
                        }
                    ],
                    "transactions": []
                };

            var invoice = InvoiceBuilder.buildInvoice("INVO-123",
                invoiceItems,
                PAID_SIMPLEST_ITEM.Invoice.PostedDate,
                PAID_SIMPLEST_ITEM.Invoice.DueDate,
                PAID_SIMPLEST_ITEM.Account.Currency,
                itemAdjsByInvoice,
                invoiceAdjsByInvoice,
                creditAdjsByInvoice,
                paymentsByInvoice,
                refundsByInvoice,
                PLANS_BY_ID
            );

            expect(JSON.stringify(diff(EXPECTED, invoice), null, 4)).toEqual();
        });

        //TODO: two invoices with one payment assigned to both
        //TODO: partial payment
        //TODO: partial refund
    });
});
