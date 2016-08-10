"use strict";
/* eslint-env node, jasmine */

require("log4js").configure({
    "levels": {"[all]": "TRACE"},
    "appenders": [{"type": "console"}]
});

var PendingRefunds = require("../pendingRefunds.js").PendingRefunds,
    diff = require("deep-diff").diff,
    Invoice = require("chartmoguljs").import.Invoice;
    // moment = require("moment");

describe("PendingRefunds", function(){

    it("Refund added on invoice", function() {
        var invoice = new Invoice({
            "external_id": "I-01",
            "date": "2015-11-29T11:12:58+00:00",
            "currency": "USD",
            "due_date": "2015-11-29T00:00:00+00:00",
            "line_items": [
                {
                    "type": "subscription",
                    "subscription_external_id": "S01",
                    "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                    "service_period_start": "2015-11-29T00:00:00+00:00",
                    "service_period_end": "2015-12-28T23:59:59+00:00",
                    "amount_in_cents": 24000,
                    "prorated": false,
                    "quantity": 24,
                    "discount_amount_in_cents": 0,
                    "tax_amount_in_cents": 0,
                    "external_id": "100",
                    "__amendmentType": "UpdateProduct"
                }
            ],
            "transactions": [
                {
                    "date": "2015-11-29T13:00:05+00:00",
                    "type": "payment",
                    "result": "successful",
                    "external_id": "P-01-I-01"
                }
            ],
            "__balance": 0
        });

        var result = PendingRefunds._addRefundsFromStandaloneCBA([{
            "CreditBalanceAdjustment": {
                "AccountingCode": "",
                "Amount": 33,
                "CreatedDate": "2015-12-18T23:14:09+0000",
                "Id": "001",
                "ReasonCode": "Standard Adjustment",
                "SourceTransactionType": "Refund",
                "Status": "Processed",
                "Type": "Decrease"
            },
            "Account": {
                "AccountNumber": "A01"
            },
            "Invoice": {
                "InvoiceNumber": ""
            },
            "Payment": {
                "Amount": "",
                "Id": "",
                "PaymentNumber": ""
            },
            "Refund": {
                "Amount": 33,
                "Id": "002",
                "RefundDate": "2015-12-18",
                "RefundNumber": "R-01",
                "Status": "Processed"
            }
        }],
        invoice
        );
        const EXPECTED = {cbas: []};
        const EXPECTED_INVOICE = {
            "external_id": "I-01",
            "date": "2015-11-29T11:12:58+00:00",
            "currency": "USD",
            "due_date": "2015-11-29T00:00:00+00:00",
            "line_items": [
                {
                    "type": "subscription",
                    "subscription_external_id": "S01",
                    "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                    "service_period_start": "2015-11-29T00:00:00+00:00",
                    "service_period_end": "2015-12-28T23:59:59+00:00",
                    "amount_in_cents": 24000,
                    "prorated": false,
                    "quantity": 24,
                    "discount_amount_in_cents": 0,
                    "tax_amount_in_cents": 0,
                    "external_id": "100",
                    "__amendmentType": "UpdateProduct"
                }
            ],
            "transactions": [
                {
                    "date": "2015-11-29T13:00:05+00:00",
                    "type": "payment",
                    "result": "successful",
                    "external_id": "P-01-I-01"
                },
                {
                    "date": "2015-12-18T00:00:00+00:00",
                    "type": "refund",
                    "result": "successful",
                    "external_id": "R-01-001"
                }
            ],
            "__balance": 0
        };
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
        expect(JSON.stringify(diff(EXPECTED_INVOICE, invoice), null, 2)).toEqual();
    });

    it("Refund added, other invoices remain", function(){
        var invoices = [new Invoice({
            "external_id": "I-01",
            "date": "2015-11-29T11:12:58+00:00",
            "currency": "USD",
            "due_date": "2015-11-29T00:00:00+00:00",
            "line_items": [
                {
                    "type": "subscription",
                    "subscription_external_id": "S01",
                    "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                    "service_period_start": "2015-11-29T00:00:00+00:00",
                    "service_period_end": "2015-12-28T23:59:59+00:00",
                    "amount_in_cents": 24000,
                    "prorated": false,
                    "quantity": 24,
                    "discount_amount_in_cents": 0,
                    "tax_amount_in_cents": 0,
                    "external_id": "100",
                    "__amendmentType": "UpdateProduct"
                }
            ],
            "transactions": [
                {
                    "date": "2015-11-29T13:00:05+00:00",
                    "type": "payment",
                    "result": "successful",
                    "external_id": "P-01-I-01"
                }
            ],
            "__balance": 0
        }),
        new Invoice({
            "external_id": "I-02",
            "date": "2015-12-18T23:09:57+00:00",
            "currency": "USD",
            "due_date": "2015-12-18T00:00:00+00:00",
            "line_items": [
                {
                    "type": "subscription",
                    "subscription_external_id": "A-S00031034",
                    "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                    "service_period_start": "2015-12-18T00:00:00+00:00",
                    "service_period_end": "2015-12-28T23:59:59+00:00",
                    "amount_in_cents": -3300,
                    "prorated": true,
                    "quantity": -9,
                    "discount_amount_in_cents": 0,
                    "tax_amount_in_cents": 0,
                    "external_id": "123",
                    "__amendmentType": "UpdateProduct"
                }
            ],
            "transactions": [],
            "__balance": 0
        }),
        new Invoice({
            "external_id": "I-03",
            "date": "2015-12-29T10:40:07+00:00",
            "currency": "USD",
            "due_date": "2015-12-29T00:00:00+00:00",
            "line_items": [
                {
                    "type": "subscription",
                    "subscription_external_id": "A-S00031034",
                    "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                    "service_period_start": "2015-12-29T00:00:00+00:00",
                    "service_period_end": "2016-01-28T23:59:59+00:00",
                    "amount_in_cents": 15000,
                    "prorated": false,
                    "quantity": 15,
                    "discount_amount_in_cents": 0,
                    "tax_amount_in_cents": 0,
                    "external_id": "154",
                    "__amendmentType": "UpdateProduct"
                }
            ],
            "transactions": [
                {
                    "date": "2015-12-29T13:00:01+00:00",
                    "type": "payment",
                    "result": "successful",
                    "external_id": "P-4-I-03"
                }
            ],
            "__balance": 0
        })];

        var result = PendingRefunds.addHangingRefunds([{
            "CreditBalanceAdjustment": {
                "AccountingCode": "",
                "Amount": 33,
                "CreatedDate": "2015-12-18T23:14:09+0000",
                "Id": "001",
                "ReasonCode": "Standard Adjustment",
                "SourceTransactionType": "Refund",
                "Status": "Processed",
                "Type": "Decrease"
            },
            "Account": {
                "AccountNumber": "A01"
            },
            "Invoice": {
                "InvoiceNumber": ""
            },
            "Payment": {
                "Amount": "",
                "Id": "",
                "PaymentNumber": ""
            },
            "Refund": {
                "Amount": 33,
                "Id": "002",
                "RefundDate": "2015-12-18",
                "RefundNumber": "R-01",
                "Status": "Processed"
            }
        }],
        invoices
        );
        const EXPECTED_INVOICES = [{
            "external_id": "I-01",
            "date": "2015-11-29T11:12:58+00:00",
            "currency": "USD",
            "due_date": "2015-11-29T00:00:00+00:00",
            "line_items": [
                {
                    "type": "subscription",
                    "subscription_external_id": "S01",
                    "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                    "service_period_start": "2015-11-29T00:00:00+00:00",
                    "service_period_end": "2015-12-28T23:59:59+00:00",
                    "amount_in_cents": 24000,
                    "prorated": false,
                    "quantity": 24,
                    "discount_amount_in_cents": 0,
                    "tax_amount_in_cents": 0,
                    "external_id": "100",
                    "__amendmentType": "UpdateProduct"
                }
            ],
            "transactions": [
                {
                    "date": "2015-11-29T13:00:05+00:00",
                    "type": "payment",
                    "result": "successful",
                    "external_id": "P-01-I-01"
                },
                {
                    "date": "2015-12-18T00:00:00+00:00",
                    "type": "refund",
                    "result": "successful",
                    "external_id": "R-01-001"
                }
            ],
            "__balance": 0
        },
            {
                "external_id": "I-02",
                "date": "2015-12-18T23:09:57+00:00",
                "currency": "USD",
                "due_date": "2015-12-18T00:00:00+00:00",
                "line_items": [
                    {
                        "type": "subscription",
                        "subscription_external_id": "A-S00031034",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2015-12-18T00:00:00+00:00",
                        "service_period_end": "2015-12-28T23:59:59+00:00",
                        "amount_in_cents": -3300,
                        "prorated": true,
                        "quantity": -9,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "123",
                        "__amendmentType": "UpdateProduct"
                    }
                ],
                "transactions": [],
                "__balance": 0
            },
            {
                "external_id": "I-03",
                "date": "2015-12-29T10:40:07+00:00",
                "currency": "USD",
                "due_date": "2015-12-29T00:00:00+00:00",
                "line_items": [
                    {
                        "type": "subscription",
                        "subscription_external_id": "A-S00031034",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2015-12-29T00:00:00+00:00",
                        "service_period_end": "2016-01-28T23:59:59+00:00",
                        "amount_in_cents": 15000,
                        "prorated": false,
                        "quantity": 15,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "154",
                        "__amendmentType": "UpdateProduct"
                    }
                ],
                "transactions": [
                    {
                        "date": "2015-12-29T13:00:01+00:00",
                        "type": "payment",
                        "result": "successful",
                        "external_id": "P-4-I-03"
                    }
                ],
                "__balance": 0
            }];
        expect(JSON.stringify(diff(EXPECTED_INVOICES, result), null, 2)).toEqual();
    });
});
