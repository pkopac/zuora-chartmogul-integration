"use strict";
/* eslint-env node, jasmine */

require("log4js").configure({
    "levels": {"[all]": "WARN"},
    "appenders": [{"type": "console"}]
});
var CancellationModule = require("../cancellation.js");
var Cancellation = CancellationModule.Cancellation;
var diff = require("deep-diff").diff,
    moment = require("moment");
// var logger = require("log4js").getLogger("spec");

describe("Cancellation", function(){
    var cancellation;

    beforeEach(function() {
        cancellation = new Cancellation();
        cancellation.configure({unpaidToCancelMonths: 10000, noRenewalToCancelMonths: 10000});
    });

    // it("Simple refund invoice", function(){
    // });
    it("Simple void invoice removed", function(){
        var result = cancellation.cancelInvoices([
            {
                "external_id": "A01",
                "__balance": 0,
                "line_items": [
                    {
                        "amount_in_cents": 0,
                        "discount_amount_in_cents":0,
                        "quantity": 10,
                        "external_id": "ii01"
                    }
                ]}
        ]);

        expect(result).toEqual([]);
    });

    it("Simple void invoice cancels previous of its subscription, leaves alone others", function(){
        var result = cancellation.cancelInvoices([
            {external_id: "I01", __balance: 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", "external_id": "ii01"}
            ]},
            {external_id: "I02", __balance: 0, line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", "external_id": "ii02"}
            ]},
            {external_id: "I05", __balance: 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 0, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30", "external_id": "ii03"}
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
                        "cancelled_at": "2016-06-01",
                        "external_id": "ii01"
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
                        "service_period_end": "2016-05-30",
                        "external_id": "ii02"
                    }
                ]
            }];
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
    });

    it("Seemingly void invoice DOESN'T cancel previous, because it is prorated.", function(){
        var result = cancellation.cancelInvoices([
            {external_id: "I01", __balance: 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", "external_id": "ii01"}
            ]},
            {external_id: "I02", __balance: 0, line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", "external_id": "ii02"}
            ]},
            {external_id: "I05", __balance: 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 0, prorated: true, discount_amount_in_cents:0, quantity: 0,
                 service_period_start: "2016-05-09", service_period_end: "2016-05-30", "external_id": "ii03"}
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
                        "external_id": "ii01"
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
                        "service_period_end": "2016-05-30",
                        "external_id": "ii02"
                    }
                ]
            },
            {
                "external_id": "I05",
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 0,
                        "prorated": true,
                        "discount_amount_in_cents": 0,
                        "quantity": 0,
                        "service_period_start": "2016-05-09",
                        "service_period_end": "2016-05-30",
                        "external_id": "ii03"
                    }
                ]
            }];
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
    });

    it("Simple refund invoice cancels previous of its subscription, leaves alone others", function(){
        var result = cancellation.cancelInvoices([
            {external_id: "I01", "__balance": 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"}
            ]},
            {external_id: "I02", "__balance": 0, line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"}
            ]},
            {external_id: "I05", "__balance": 0, line_items: [
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
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
    });

    it("Two-item refund invoice cancels two previous of its subscription, leaves alone others", function(){
        var result = cancellation.cancelInvoices([
            {external_id: "I01", "__balance": 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"}
            ]},
            {external_id: "I03", "__balance": 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30"}
            ]},
            {external_id: "I05", "__balance": 0, line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30"}
            ]},
            {external_id: "I07", "__balance": 0, line_items: [
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
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
    });

    it("Combination item refund invoice cancels two previous of its subscription, leaves alone others and reactivation", function(){
        var result = cancellation.cancelInvoices([
            {external_id: "I01", "__balance": 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", "external_id": "ii01"}
            ]},
            {external_id: "I03", "__balance": 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30", "external_id": "ii02"}
            ]},
            {external_id: "I05", "__balance": 0, line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", "external_id": "ii03"}
            ]},
            {external_id: "I07", "__balance": 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: -1000, discount_amount_in_cents:0, quantity: -5,
                 __amendmentType: "RemoveProduct", prorated: true,
                 service_period_start: "2016-05-01", service_period_end: "2016-06-30", "external_id": "ii04"}
            ]},
            {external_id: "I09", "__balance": 0, line_items: [
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
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
    });

    it("Combination item refund invoice cancels previous two-item invoice", function() {
        var result = cancellation.cancelInvoices([
            {external_id: "I01", "__balance": 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", external_id: "ii01"},
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30", external_id: "ii02"}
            ]},
            {external_id: "I05", "__balance": 0, line_items: [
                {subscription_external_id: "S02", amount_in_cents: 500, discount_amount_in_cents:500, quantity: 10,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", external_id: "ii03"}
            ]},
            {external_id: "I07", "__balance": 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: -1000, discount_amount_in_cents:0, quantity: -5,
                 __amendmentType: "RemoveProduct", prorated: true,
                 service_period_start: "2016-05-01", service_period_end: "2016-06-30", external_id: "ii04"}
            ]},
            {external_id: "I09", "__balance": 0, line_items: [
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
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
    });

    it("Canceling non-renewal doesn't affect regular invoices.", function() {
        cancellation = new Cancellation();
        cancellation.configure({unpaidToCancelMonths: 10000, noRenewalToCancelMonths: 1});

        var result = cancellation._cancelNonrenewedSubscriptions([
            {external_id: "I01", due_date: "2016-06-01", __balance: 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", external_id: "ii01"}
            ]},
            {external_id: "I02", due_date: "2016-07-01", __balance: 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30", external_id: "ii02"}
            ]}
        ], moment.utc("2016-07-29")); // just less than 1 month

        const EXPECTED = [
            {
                "external_id": "I01",
                "due_date": "2016-06-01",
                "__balance": 0,
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "external_id": "ii01"
                    }
                ]},
            {
                "external_id": "I02",
                "due_date": "2016-07-01",
                "__balance": 0,
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-06-01",
                        "service_period_end": "2016-06-30",
                        "external_id": "ii02"
                    }
                ]}
        ];
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
    });

    it("Non-renewal means cancel.", function() {
        cancellation = new Cancellation();
        cancellation.configure({unpaidToCancelMonths: 10000, noRenewalToCancelMonths: 1});

        var result = cancellation._cancelNonrenewedSubscriptions([
            {external_id: "I01", due_date: "2016-06-01", __balance: 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-05-01", service_period_end: "2016-05-30", external_id: "ii01"}
            ]},
            {external_id: "I02", due_date: "2016-07-01", __balance: 0, line_items: [
                {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                 service_period_start: "2016-06-01", service_period_end: "2016-06-30", external_id: "ii02"}
            ]}
        ], moment.utc("2016-07-30")); // just less than 1 month

        const EXPECTED = [
            {
                "external_id": "I01",
                "due_date": "2016-06-01",
                "__balance": 0,
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "external_id": "ii01"
                    }
                ]},
            {
                "external_id": "I02",
                "due_date": "2016-07-01",
                "__balance": 0,
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-06-01",
                        "service_period_end": "2016-06-30",
                        "external_id": "ii02",
                        "cancelled_at": new Date("2016-06-30T00:00:01.000Z")
                    }
                ]}
        ];
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
    });

    it("Prorated + new term invoice not canceled as non-renewal.", function() {
        cancellation = new Cancellation();
        cancellation.configure({unpaidToCancelMonths: 10000, noRenewalToCancelMonths: 1});

        var result = cancellation._cancelNonrenewedSubscriptions([
            {
                "external_id": "I01",
                "date": "2016-05-20T09:46:37+00:00",
                "currency": "USD",
                "due_date": "2016-05-20T00:00:00+00:00",
                "line_items": [
                    {
                        "type": "subscription",
                        "subscription_external_id": "S01",
                        "plan_uuid": "P01",
                        "service_period_start": "2015-10-15T00:00:00+00:00",
                        "service_period_end": "2016-05-19T23:59:59+00:00",
                        "amount_in_cents": 321640,
                        "prorated": true,
                        "quantity": 30,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "0123"
                    },
                    {
                        "type": "subscription",
                        "subscription_external_id": "S01",
                        "plan_uuid": "P01",
                        "service_period_start": "2016-05-20T00:00:01.000Z",
                        "service_period_end": "2017-05-19T23:59:59+00:00",
                        "amount_in_cents": 4644000,
                        "prorated": false,
                        "quantity": 258,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "0124"
                    }
                ]
            }
        ], moment.utc("2016-07-30")); // too long for proration, but before the next term

        const EXPECTED = [
            {
                "external_id": "I01",
                "date": "2016-05-20T09:46:37+00:00",
                "currency": "USD",
                "due_date": "2016-05-20T00:00:00+00:00",
                "line_items": [
                    {
                        "type": "subscription",
                        "subscription_external_id": "S01",
                        "plan_uuid": "P01",
                        "service_period_start": "2015-10-15T00:00:00+00:00",
                        "service_period_end": "2016-05-19T23:59:59+00:00",
                        "amount_in_cents": 321640,
                        "prorated": true,
                        "quantity": 30,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "0123"
                    },
                    {
                        "type": "subscription",
                        "subscription_external_id": "S01",
                        "plan_uuid": "P01",
                        "service_period_start": "2016-05-20T00:00:01.000Z",
                        "service_period_end": "2017-05-19T23:59:59+00:00",
                        "amount_in_cents": 4644000,
                        "prorated": false,
                        "quantity": 258,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "0124"
                    }
                ]
            }
        ];
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
    });

    it("Prorated + new term invoice not canceled as non-renewal.", function() {
        cancellation = new Cancellation();
        cancellation.configure({unpaidToCancelMonths: 10000, noRenewalToCancelMonths: 1});

        var result = cancellation._downgradeAsCancel(    [

            {
                "external_id": "I01",
                "date": "2015-09-27T09:52:47+00:00",
                "currency": "USD",
                "due_date": "2015-09-27T00:00:00+00:00",
                "line_items": [
                    {
                        "type": "subscription",
                        "subscription_external_id": "A-1",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2015-09-27T00:00:00+00:00",
                        "service_period_end": "2015-10-26T23:59:59+00:00",
                        "amount_in_cents": 15000,
                        "prorated": false,
                        "quantity": 15,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "012",
                        "__amendmentType": "UpdateProduct"
                    }
                ],
                "transactions": [
                    {
                        "date": "2015-10-16T18:51:05+00:00",
                        "type": "payment",
                        "result": "successful",
                        "external_id": "P-01"
                    }
                ],
                "__balance": 0
            },
            {
                "external_id": "I02",
                "date": "2015-10-27T10:08:58+00:00",
                "currency": "USD",
                "due_date": "2015-10-27T00:00:00+00:00",
                "line_items": [
                    {
                        "type": "subscription",
                        "subscription_external_id": "A-1",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2015-10-27T00:00:00+00:00",
                        "service_period_end": "2015-11-26T23:59:59+00:00",
                        "amount_in_cents": 0,
                        "prorated": false,
                        "quantity": 15,
                        "discount_amount_in_cents": 15000,
                        "tax_amount_in_cents": 0,
                        "external_id": "0123",
                        "__amendmentType": "UpdateProduct"
                    }
                ],
                "transactions": [],
                "__balance": 0
            },
            {
                "external_id": "I03",
                "date": "2015-11-27T11:12:43+00:00",
                "currency": "USD",
                "due_date": "2015-11-27T00:00:00+00:00",
                "line_items": [
                    {
                        "type": "subscription",
                        "subscription_external_id": "A-1",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2015-11-27T00:00:00+00:00",
                        "service_period_end": "2015-12-26T23:59:59+00:00",
                        "amount_in_cents": 0,
                        "prorated": false,
                        "quantity": 15,
                        "discount_amount_in_cents": 15000,
                        "tax_amount_in_cents": 0,
                        "external_id": "212",
                        "__amendmentType": "UpdateProduct"
                    }
                ],
                "transactions": [],
                "__balance": 0
            },
            {
                "external_id": "I66",
                "date": "2016-05-02T22:12:45+00:00",
                "currency": "USD",
                "due_date": "2016-05-02T00:00:00+00:00",
                "line_items": [
                    {
                        "type": "subscription",
                        "subscription_external_id": "A-1",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2015-10-23T00:00:00+00:00",
                        "service_period_end": "2015-10-26T23:59:59+00:00",
                        "amount_in_cents": 0,
                        "prorated": true,
                        "quantity": -15,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "1-a",
                        "__amendmentType": "RemoveProduct"
                    },
                    {
                        "type": "subscription",
                        "subscription_external_id": "A-1",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2015-11-27T00:00:00+00:00",
                        "service_period_end": "2015-12-26T23:59:59+00:00",
                        "amount_in_cents": 0,
                        "prorated": true,
                        "quantity": -15,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "2-a",
                        "__amendmentType": "RemoveProduct"
                    },
                    {
                        "type": "subscription",
                        "subscription_external_id": "A-1",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2015-10-27T00:00:00+00:00",
                        "service_period_end": "2015-11-26T23:59:59+00:00",
                        "amount_in_cents": 0,
                        "prorated": true,
                        "quantity": -15,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "3-a",
                        "__amendmentType": "RemoveProduct"
                    }
                ],
                "transactions": [],
                "__balance": 0
            }
        ]);

        const EXPECTED = [{
            "external_id": "I01",
            "date": "2015-09-27T09:52:47+00:00",
            "currency": "USD",
            "due_date": "2015-09-27T00:00:00+00:00",
            "line_items": [
                {
                    "type": "subscription",
                    "subscription_external_id": "A-1",
                    "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                    "service_period_start": "2015-09-27T00:00:00+00:00",
                    "service_period_end": "2015-10-26T23:59:59+00:00",
                    "amount_in_cents": 15000,
                    "prorated": false,
                    "quantity": 15,
                    "discount_amount_in_cents": 0,
                    "tax_amount_in_cents": 0,
                    "external_id": "012",
                    "__amendmentType": "UpdateProduct",
                    "cancelled_at": "2015-10-23T00:00:00+00:00"
                }
            ],
            "transactions": [
                {
                    "date": "2015-10-16T18:51:05+00:00",
                    "type": "payment",
                    "result": "successful",
                    "external_id": "P-01"
                }
            ],
            "__balance": 0
        }];
        expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
    });

    describe("Past due invoices", function() {
        it("Long overdue invoices are canceled", function() {
            cancellation = new Cancellation();
            cancellation.configure({unpaidToCancelMonths: 1, noRenewalToCancelMonths: 10000});

            var result = cancellation._cancelLongDueInvoices([
                {external_id: "I01", due_date: "2016-06-01", __balance: 1000, line_items: [
                    {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                     service_period_start: "2016-05-01", service_period_end: "2016-05-30", external_id: "ii01"},
                    {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                     service_period_start: "2016-06-01", service_period_end: "2016-06-30", external_id: "ii02"}
                ]}
            ], moment.utc("2016-07-07"));

            const EXPECTED = [{
                "external_id": "I01",
                "due_date": "2016-06-01",
                "__balance": 1000,
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "external_id": "ii01",
                        "cancelled_at": "2016-05-01"
                    }
                ]
            }];
            expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
        });

        it("Shortly overdue invoices are NOT canceled", function() {
            cancellation = new Cancellation();
            cancellation.configure({unpaidToCancelMonths: 2, noRenewalToCancelMonths: 10000});

            var result = cancellation._cancelLongDueInvoices([
                {external_id: "I01", due_date: "2016-06-01", __balance: 1000, line_items: [
                    {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                     service_period_start: "2016-05-01", service_period_end: "2016-05-30", external_id: "ii01"},
                    {subscription_external_id: "S01", amount_in_cents: 500, discount_amount_in_cents:0, quantity: 5,
                     service_period_start: "2016-06-01", service_period_end: "2016-06-30", external_id: "ii02"}
                ]}
            ], moment.utc("2016-07-30"));

            const EXPECTED = [{
                "external_id": "I01",
                "due_date": "2016-06-01",
                "__balance": 1000,
                "line_items": [
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-05-01",
                        "service_period_end": "2016-05-30",
                        "external_id": "ii01"
                    },
                    {
                        "subscription_external_id": "S01",
                        "amount_in_cents": 500,
                        "discount_amount_in_cents": 0,
                        "quantity": 5,
                        "service_period_start": "2016-06-01",
                        "service_period_end": "2016-06-30",
                        "external_id": "ii02"
                    }
                ]
            }];
            expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
        });

        it("Multiple invoices - cancel first unpaid, omit the rest", function(){
            cancellation = new Cancellation();
            cancellation.configure({unpaidToCancelMonths: 2, noRenewalToCancelMonths: 10000});
            var result = cancellation._cancelLongDueInvoices([
                {
                    "external_id": "inv01",
                    "date": "2016-05-15T17:47:11+00:00",
                    "currency": "USD",
                    "due_date": "2016-05-15T00:00:00+00:00",
                    "line_items": [{
                        "type": "subscription",
                        "subscription_external_id": "subs01",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2016-05-15T00:00:00+00:00",
                        "service_period_end": "2016-06-14T23:59:59+00:00",
                        "amount_in_cents": 1333,
                        "prorated": false,
                        "quantity": 10,
                        "discount_amount_in_cents": 8667,
                        "tax_amount_in_cents": 0,
                        "external_id": "extid001",
                        "__amendmentType": "NewProduct"
                    }],
                    "transactions": [{
                        "date": "2016-05-15T17:47:11+00:00",
                        "type": "payment",
                        "result": "successful",
                        "external_id": "payment-110-inv01"
                    }],
                    "__balance": 0
                }, {
                    "external_id": "inv02",
                    "date": "2016-06-15T09:36:09+00:00",
                    "currency": "USD",
                    "due_date": "2016-06-15T00:00:00+00:00",
                    "line_items": [{
                        "type": "subscription",
                        "subscription_external_id": "subs01",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2016-06-15T00:00:00+00:00",
                        "service_period_end": "2016-07-14T23:59:59+00:00",
                        "amount_in_cents": 10000,
                        "prorated": false,
                        "quantity": 10,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "extid002",
                        "__amendmentType": "NewProduct"
                    }],
                    "transactions": [{
                        "date": "2016-06-15T12:00:05+00:00",
                        "type": "payment",
                        "result": "failed",
                        "external_id": "payment-125-inv02"
                    }, {
                        "date": "2016-06-16T12:00:06+00:00",
                        "type": "payment",
                        "result": "failed",
                        "external_id": "payment-121-inv02"
                    }, {
                        "date": "2016-06-17T12:00:07+00:00",
                        "type": "payment",
                        "result": "failed",
                        "external_id": "payment-123-inv02"
                    }],
                    "__balance": 100
                }, {
                    "external_id": "inv1234",
                    "date": "2016-07-15T09:33:11+00:00",
                    "currency": "USD",
                    "due_date": "2016-07-15T00:00:00+00:00",
                    "line_items": [{
                        "type": "subscription",
                        "subscription_external_id": "subs01",
                        "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                        "service_period_start": "2016-07-15T00:00:00+00:00",
                        "service_period_end": "2016-08-14T23:59:59+00:00",
                        "amount_in_cents": 10000,
                        "cancelled_at": "2016-08-04T00:00:00+00:00",
                        "prorated": false,
                        "quantity": 10,
                        "discount_amount_in_cents": 0,
                        "tax_amount_in_cents": 0,
                        "external_id": "extid25",
                        "__amendmentType": "NewProduct"
                    }],
                    "transactions": [],
                    "__balance": 64.52
                }], moment.utc("2016-08-30"));

            const EXPECTED = [
                {
                    "external_id": "inv01",
                    "date": "2016-05-15T17:47:11+00:00",
                    "currency": "USD",
                    "due_date": "2016-05-15T00:00:00+00:00",
                    "line_items": [
                        {
                            "type": "subscription",
                            "subscription_external_id": "subs01",
                            "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                            "service_period_start": "2016-05-15T00:00:00+00:00",
                            "service_period_end": "2016-06-14T23:59:59+00:00",
                            "amount_in_cents": 1333,
                            "prorated": false,
                            "quantity": 10,
                            "discount_amount_in_cents": 8667,
                            "tax_amount_in_cents": 0,
                            "external_id": "extid001",
                            "__amendmentType": "NewProduct"
                        }
                    ],
                    "transactions": [
                        {
                            "date": "2016-05-15T17:47:11+00:00",
                            "type": "payment",
                            "result": "successful",
                            "external_id": "payment-110-inv01"
                        }
                    ],
                    "__balance": 0
                },
                {
                    "external_id": "inv02",
                    "date": "2016-06-15T09:36:09+00:00",
                    "currency": "USD",
                    "due_date": "2016-06-15T00:00:00+00:00",
                    "line_items": [
                        {
                            "type": "subscription",
                            "subscription_external_id": "subs01",
                            "plan_uuid": "fake_plan_uuid_Pro: Monthly",
                            "cancelled_at": "2016-06-15T00:00:00+00:00",
                            "service_period_start": "2016-06-15T00:00:00+00:00",
                            "service_period_end": "2016-07-14T23:59:59+00:00",
                            "amount_in_cents": 10000,
                            "prorated": false,
                            "quantity": 10,
                            "discount_amount_in_cents": 0,
                            "tax_amount_in_cents": 0,
                            "external_id": "extid002",
                            "__amendmentType": "NewProduct"
                        }
                    ],
                    "transactions": [
                        {
                            "date": "2016-06-15T12:00:05+00:00",
                            "type": "payment",
                            "result": "failed",
                            "external_id": "payment-125-inv02"
                        },
                        {
                            "date": "2016-06-16T12:00:06+00:00",
                            "type": "payment",
                            "result": "failed",
                            "external_id": "payment-121-inv02"
                        },
                        {
                            "date": "2016-06-17T12:00:07+00:00",
                            "type": "payment",
                            "result": "failed",
                            "external_id": "payment-123-inv02"
                        }
                    ],
                    "__balance": 100
                }
            ];

            expect(JSON.stringify(diff(EXPECTED, result), null, 2)).toEqual();
        });
    });

    describe("Secondary", function(){
        it("Configure sets defaults if not given in json", function(){
            var tested = new Cancellation();
            tested.configure();
            expect(tested.unpaidToCancelMonths).toEqual(CancellationModule.DEFAULT_UNPAID_TO_CANCEL_MONTHS);
            expect(tested.noRenewalToCancelMonths).toEqual(CancellationModule.DEFAULT_NO_RENEWAL_TO_CANCEL_MONTHS);

            tested = new Cancellation();
            tested.configure({unpaidToCancelMonths: 15213});
            expect(tested.unpaidToCancelMonths).toEqual(15213);
            expect(tested.noRenewalToCancelMonths).toEqual(CancellationModule.DEFAULT_NO_RENEWAL_TO_CANCEL_MONTHS);

            tested = new Cancellation();
            tested.configure({unpaidToCancelMonths: 15213, noRenewalToCancelMonths: 1111});
            expect(tested.unpaidToCancelMonths).toEqual(15213);
            expect(tested.noRenewalToCancelMonths).toEqual(1111);
        });

    });



});
