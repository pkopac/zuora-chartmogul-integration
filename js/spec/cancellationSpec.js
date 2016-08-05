"use strict";
/* eslint-env node, jasmine */

var logger = require("log4js").getLogger("test");
var Cancellation = require("../cancellation.js").Cancellation;
var diff = require("deep-diff").diff;

describe("Cancellation", function(){
    // it("Simple refund invoice", function(){
    // });
    it("Simple void invoice removed", function(){
        var result = Cancellation.cancelInvoices([
            {external_id: "A01", line_items: [
                {amount_in_cents: 0, discount_amount_in_cents:0, quantity: 10}
            ]}
        ]);

        expect(result).toEqual([]);
    });

    it("Simple void invoice cancels previous of its subscription, leaves alone others", function(){
        var result = Cancellation.cancelInvoices([
            {external_id: "I01", line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"}
            ]},
            {external_id: "I02", line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"}
            ]},
            {external_id: "I05", line_items: [
                {subscription_external_id: "S01", amount_in_cents: 0, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30"}
            ]}
        ]);

        const EXPECTED = [
            {
                "external_id": "I01",
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "cancelled_at": "2016-06-01"
                    }
                ]
            },
            {
                "external_id": "I02",
                "line_items": [
                    {
                        "subscription_external_id": "S02",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 500,
                        "quantity": 10,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30"
                    }
                ]
            }];
        expect(JSON.stringify(diff(result, EXPECTED), null, 2)).toEqual();
    });

    it("Simple refund invoice cancels previous of its subscription, leaves alone others", function(){
        var result = Cancellation.cancelInvoices([
            {external_id: "I01", line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"}
            ]},
            {external_id: "I02", line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"}
            ]},
            {external_id: "I05", line_items: [
                {subscription_external_id: "S01", amount_in_cents: -400, discount_amount_in_cents:0, quantity: -5,
                 __amendmentType: "RemoveProduct", prorated: true,
                 service_period_start: "2016-05-05", service_period_end: "2016-05-30"}
            ]}
        ]);

        const EXPECTED = [
            {
                "external_id": "I01",
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "cancelled_at": "2016-05-05"
                    }
                ]
            },
            {
                "external_id": "I02",
                "line_items": [
                    {
                        "subscription_external_id": "S02",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 500,
                        "quantity": 10,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30"
                    }
                ]
            }];
        expect(JSON.stringify(diff(result, EXPECTED), null, 2)).toEqual();
    });

    it("Two-item refund invoice cancels two previous of its subscription, leaves alone others", function(){
        var result = Cancellation.cancelInvoices([
            {external_id: "I01", line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"}
            ]},
            {external_id: "I03", line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30"}
            ]},
            {external_id: "I05", line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"}
            ]},
            {external_id: "I07", line_items: [
                {subscription_external_id: "S01", amount_in_cents: -500, discount_amount_in_cents:0, quantity: -5,
                 __amendmentType: "RemoveProduct", prorated: true,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"},
                {subscription_external_id: "S01", amount_in_cents: -500, discount_amount_in_cents:0, quantity: -5,
                 __amendmentType: "RemoveProduct", prorated: true,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30"}
            ]}
        ]);

        const EXPECTED = [
            {
                "external_id": "I01",
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "cancelled_at": "2016-05-01"
                    }
                ]
            },
            {
                "external_id": "I05",
                "line_items": [
                    {
                        "subscription_external_id": "S02",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 500,
                        "quantity": 10,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30"
                    }
                ]
            }];
        expect(JSON.stringify(diff(result, EXPECTED), null, 2)).toEqual();
    });

    it("Combination item refund invoice cancels two previous of its subscription, leaves alone others and reactivation", function(){
        var result = Cancellation.cancelInvoices([
            {external_id: "I01", line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", "external_id": "ii01"}
            ]},
            {external_id: "I03", line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30", "external_id": "ii02"}
            ]},
            {external_id: "I05", line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", "external_id": "ii03"}
            ]},
            {external_id: "I07", line_items: [
                {subscription_external_id: "S01", amount_in_cents: -1000, discount_amount_in_cents:0, quantity: -5,
                 __amendmentType: "RemoveProduct", prorated: true,
                 service_period_start: "2016-05-01", service_period_end: "2016-06-30", "external_id": "ii04"}
            ]},
            {external_id: "I09", line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-08-01", service_period_end: "2016-08-30", "external_id": "ii05"}
            ]}
        ]);

        const EXPECTED = [
            {
                "external_id": "I01",
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "cancelled_at": "2016-05-01",
                        "external_id": "ii01"
                    }
                ]
            },
            {
                "external_id": "I05",
                "line_items": [
                    {
                        "subscription_external_id": "S02",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 500,
                        "quantity": 10,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "external_id": "ii03"
                    }
                ]
            },
            {
                "external_id": "I09",
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-08-01",
                        "service_period_end": "2016-08-30",
                        "external_id": "ii05"
                    }
                ]
            }];
        // logger.debug(JSON.stringify(result, null, 2))
        expect(JSON.stringify(diff(result, EXPECTED), null, 2)).toEqual();
    });

    it("Combination item refund invoice cancels previous two-item invoice", function(){
        var result = Cancellation.cancelInvoices([
            {external_id: "I01", line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", external_id: "ii01"},
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30", external_id: "ii02"}
            ]},
            {external_id: "I05", line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", external_id: "ii03"}
            ]},
            {external_id: "I07", line_items: [
                {subscription_external_id: "S01", amount_in_cents: -1000, discount_amount_in_cents:0, quantity: -5,
                 __amendmentType: "RemoveProduct", prorated: true,
                 service_period_start: "2016-05-01", service_period_end: "2016-06-30", external_id: "ii04"}
            ]},
            {external_id: "I09", line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-08-01", service_period_end: "2016-08-30", external_id: "ii05"}
            ]}
        ]);

        const EXPECTED = [
            {
                "external_id": "I01",
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "cancelled_at": "2016-05-01",
                        "external_id": "ii01"
                    }
                ]
            },
            {
                "external_id": "I05",
                "line_items": [
                    {
                        "subscription_external_id": "S02",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 500,
                        "quantity": 10,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "external_id": "ii03"
                    }
                ]
            },
            {
                "external_id": "I09",
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-08-01",
                        "service_period_end": "2016-08-30",
                        "external_id": "ii05"
                    }
                ]
            }];
        expect(JSON.stringify(diff(result, EXPECTED), null, 2)).toEqual();
    });

});
