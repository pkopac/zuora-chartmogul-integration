"use strict";
/* eslint-env node, jasmine */

var ItemsBuilder = require("../itemsBuilder.js").ItemsBuilder;
var diff = require("deep-diff").diff;
// TODO: remove logger
var logger = require("log4js").getLogger("test");
var VError = require("verror");
var moment = require("moment");

describe("ItemBuilder", function() {
    describe("checkItemSanity", function() {
        it("missing start date", function() {
            var item = {InvoiceItem: {}};
            expect(function(){ ItemsBuilder.checkItemSanity(item); }).toThrowError(VError, "ServiceStartDate undefined");
        });

        it("missing end date", function() {
            var item = {
                InvoiceItem: {
                    ServiceStartDate: "2016-05-01"
                }
            };
            expect(function(){ ItemsBuilder.checkItemSanity(item); }).toThrowError(VError, "ServiceEndDate undefined");
        });

        it("has both start and end date", function() {
            var item = {
                InvoiceItem: {
                    ServiceStartDate: "2016-05-01",
                    ServiceEndDate: "2016-06-01"
                }
            };
            expect(function(){ ItemsBuilder.checkItemSanity(item); }).not.toThrow();
        });
    });

    describe("rangeIntersection", function() {
        var aStart = moment.utc("2016-05-01"),
            aEnd = moment.utc("2016-05-03"),
            bEnd = moment.utc("2016-05-04");

        it("intersection exists", function() {
            var bStart = moment.utc("2016-05-02"),
                intersection = ItemsBuilder.rangeIntersection(aStart, aEnd, bStart, bEnd);

            expect(intersection).toEqual(24 * 60 * 60);
        });

        it("intersection does not exist", function() {
            var bStart = moment.utc("2016-05-03"),
                intersection = ItemsBuilder.rangeIntersection(aStart, aEnd, bStart, bEnd);

            expect(intersection).toEqual(0);
        });
    });

    describe("getSubscriptionCanceledDate", function() {
        it("has cancellation date", function() {
            var CancelledDate = "2016-05-01",
                item = {
                    Subscription: {CancelledDate}
                };

            var date = ItemsBuilder.getSubscriptionCanceledDate(item);
            expect(date).toEqual(moment.utc(CancelledDate));
        });

        it("has not cancellation date", function() {
            var ServiceEndDate = "2016-05-01",
                item = {
                    Subscription: {},
                    InvoiceItem: {ServiceEndDate}
                };

            var date = ItemsBuilder.getSubscriptionCanceledDate(item);
            expect(date).toEqual(moment.utc(ServiceEndDate));
        });
    });

    describe("getPlan", function() {
        var plans = {
            uuid: "plan",
            "Generic Quarterly": "generic plan"
        };

        it("has UUID in plans map", function() {
            var item = {
                ProductRatePlan: {
                    Id: "uuid"
                }
            };

            var plan = ItemsBuilder.getPlan(item, plans);
            expect(plan).toEqual("plan");

        });

        it("UUID missing, use generic plan", function() {
            var item = {
                Invoice: {
                    InvoiceNumber: "InvoiceNumber"
                },
                InvoiceItem: {
                    AccountingCode: "QUARTERLYFEE"
                }
            };

            var plan = ItemsBuilder.getPlan(item, plans);
            expect(plan).toEqual("generic plan");
        });

        it("UUID missing, no generic plan", function() {
            var item = {
                Invoice: {
                    InvoiceNumber: "InvoiceNumber"
                },
                InvoiceItem: {
                    AccountingCode: "UNKNOWN"
                }
            };

            expect(function(){ ItemsBuilder.getPlan(item, plans); }).toThrowError(VError);
        });
    });

    describe("mergeSimilar", function() {
        var itemsBase = [
            {
                "external_id": "id",
                "subscription_external_id": "id",
                "plan_uuid": "plan",
                "type": "type",
                "service_period_start": "2013-01-23T00:00:00+00:00",
                "service_period_end": "2013-02-22T23:59:59+00:00",
                "prorated": false,
                "quantity": 1,
                "amount_in_cents": 1000,
                "discount_amount_in_cents": 0,
                "tax_amount_in_cents": 0
            },
            {
                "external_id": "id",
                "subscription_external_id": "id",
                "plan_uuid": "plan",
                "type": "type",
                "service_period_start": "2013-01-23T00:00:00+00:00",
                "service_period_end": "2013-02-22T23:59:59+00:00",
                "prorated": true,
                "quantity": 1,
                "amount_in_cents": 1000,
                "discount_amount_in_cents": 1000,
                "tax_amount_in_cents": 1000
            }
        ];

        var expectedBase = [
            {
                "external_id": "id",
                "subscription_external_id": "id",
                "plan_uuid": "plan",
                "type": "type",
                "service_period_start": "2013-01-23T00:00:00+00:00",
                "service_period_end": "2013-02-22T23:59:59+00:00",
                "prorated": true,
                "quantity": 2,
                "amount_in_cents": 2000,
                "discount_amount_in_cents": 1000,
                "tax_amount_in_cents": 1000
            }
        ];

        it("merges similar", function () {
            var items = JSON.parse(JSON.stringify(itemsBase));
            var merged = ItemsBuilder.mergeSimilar(items);
            expect(diff(merged, expectedBase)).toEqual();
        });

        it("does not merge different", function() {
            var item = {
                "external_id": "id",
                "subscription_external_id": "id",
                "plan_uuid": "plan",
                "type": "type",
                "service_period_start": "2013-01-23T00:00:00+00:00",
                "service_period_end": "2013-02-22T23:00:00+00:00",
                "prorated": true,
                "quantity": 1,
                "amount_in_cents": 1000,
                "discount_amount_in_cents": 1000,
                "tax_amount_in_cents": 1000
            };

            var items = JSON.parse(JSON.stringify(itemsBase)),
                expected = JSON.parse(JSON.stringify(expectedBase));

            items.push(item);
            expected.push(item);

            var merged = ItemsBuilder.mergeSimilar(items);
            expect(diff(merged, expected)).toEqual();
        });

        it("does not merge with same but negative quantity", function() {
            var item = {
                "external_id": "id",
                "subscription_external_id": "id",
                "plan_uuid": "plan",
                "type": "type",
                "service_period_start": "2013-01-23T00:00:00+00:00",
                "service_period_end": "2013-02-22T23:59:59+00:00",
                "prorated": true,
                "quantity": -2,
                "amount_in_cents": 0,
                "discount_amount_in_cents": 0,
                "tax_amount_in_cents": 0
            };

            var items = JSON.parse(JSON.stringify(itemsBase)),
                expected = JSON.parse(JSON.stringify(expectedBase));

            items.push(item);
            expected.push(item);

            var merged = ItemsBuilder.mergeSimilar(items);
            expect(diff(merged, expected)).toEqual();
        });
    });

    describe("resolveInvoiceAdjustments", function() {
        let amount = 10,
            discount = 0;

        it("negative invoice adjustment - discount", function() {
            var invoiceAdjustmentAmount = -5,
                adjustments = ItemsBuilder.resolveInvoiceAdjustments(invoiceAdjustmentAmount, discount, amount);

            expect(adjustments.discount).toEqual(-5);
        });

        it("negative invoice adjustment - clear amount", function() {
            var invoiceAdjustmentAmount = -10,
                adjustments = ItemsBuilder.resolveInvoiceAdjustments(invoiceAdjustmentAmount, discount, amount);

            var expected = {
                invoiceAdjustmentAmount: 0,
                discount: -10,
                amount: 0
            };
            expect(diff(adjustments, expected)).toEqual();
        });

        it("positive invoice adjustment - clear amount", function() {
            let amount = -10;
            var invoiceAdjustmentAmount = 10,
                adjustments = ItemsBuilder.resolveInvoiceAdjustments(invoiceAdjustmentAmount, discount, amount);

            var expected = {
                invoiceAdjustmentAmount: 0,
                discount: 0,
                amount: 0
            };
            expect(diff(adjustments, expected)).toEqual();
        });

        it("signs does not match", function() {
            let amount = 10;
            var invoiceAdjustmentAmount = -100,
                adjustments = ItemsBuilder.resolveInvoiceAdjustments(invoiceAdjustmentAmount, discount, amount);

            var expected = {
                invoiceAdjustmentAmount: -90,
                discount: -100,
                amount: 0
            };
            expect(diff(adjustments, expected)).toEqual();

            amount = 100;
            invoiceAdjustmentAmount = -10;
            adjustments = ItemsBuilder.resolveInvoiceAdjustments(invoiceAdjustmentAmount, discount, amount);

            expected = {
                invoiceAdjustmentAmount: 0,
                discount: -10,
                amount: 90
            };
            expect(diff(adjustments, expected)).toEqual();

            amount = -10;
            invoiceAdjustmentAmount = 100;
            adjustments = ItemsBuilder.resolveInvoiceAdjustments(invoiceAdjustmentAmount, discount, amount);

            expected = {
                invoiceAdjustmentAmount: 90,
                discount: 0,
                amount: 0
            };
            expect(diff(adjustments, expected)).toEqual();

            amount = -100;
            invoiceAdjustmentAmount = 10;
            adjustments = ItemsBuilder.resolveInvoiceAdjustments(invoiceAdjustmentAmount, discount, amount);

            expected = {
                invoiceAdjustmentAmount: 0,
                discount: 0,
                amount: -90
            };
            expect(diff(adjustments, expected)).toEqual();
        });

        it("signs match", function() {
            var invoiceAdjustmentAmount = 10,
                adjustments = ItemsBuilder.resolveInvoiceAdjustments(invoiceAdjustmentAmount, discount, amount);

            var expected = {
                invoiceAdjustmentAmount: 10,
                discount: 0,
                amount: 10
            };
            expect(diff(adjustments, expected)).toEqual();
        });
    });

    describe("useProrationCredits", function () {
        var amount = 5,
            item = {
                InvoiceItem: {
                    Quantity: 5,
                    ChargeName: "Users",
                    AccountingCode: "ANNUALFEE",
                    ServiceStartDate: "2016-05-01",
                    ServiceEndDate: "2016-05-03"
                },
                Subscription: {
                    Name: "name1"
                }
            };

        it("no credits", function () {
            var proratedUsersCredit = [],
                prorationCredits = ItemsBuilder.useProrationCredits(item, amount, proratedUsersCredit, [], {}, {});

            var expected = {
                amount,
                prorated: false,
                quantity: 5
            };
            expect(diff(prorationCredits, expected)).toEqual();
        });

        it("different subscriptions, non-intersecting, different plans", function() {
            var expected = {
                amount,
                prorated: false,
                quantity: 5
            };

            // different subscriptions
            var proratedUsersCredit = [
                {
                    InvoiceItem: {
                        Quantity: 5,
                        ChargeName: "Users",
                        ChargeAmount: -10,
                        AccountingCode: "ANNUALFEE"
                    },
                    Subscription: {
                        Name: "name2"
                    }
                }
            ];

            var prorationCredits = ItemsBuilder.useProrationCredits(item, amount, proratedUsersCredit, [], {}, {});
            expect(diff(prorationCredits, expected)).toEqual();

            // non-intersecting
            proratedUsersCredit = [
                {
                    InvoiceItem: {
                        Quantity: 5,
                        ChargeName: "Users",
                        ChargeAmount: -10,
                        AccountingCode: "ANNUALFEE",
                        ServiceStartDate: "2016-05-03",
                        ServiceEndDate: "2016-05-05"
                    },
                    Subscription: {
                        Name: "name1"
                    }
                }
            ];

            prorationCredits = ItemsBuilder.useProrationCredits(item, amount, proratedUsersCredit, [], {}, {});
            expect(diff(prorationCredits, expected)).toEqual();

            // different plans
            proratedUsersCredit = [
                {
                    InvoiceItem: {
                        Quantity: 5,
                        ChargeName: "Users",
                        ChargeAmount: -10,
                        AccountingCode: "QUARTERLYFEE",
                        ServiceStartDate: "2016-05-02",
                        ServiceEndDate: "2016-05-04"
                    },
                    Subscription: {
                        Name: "name1"
                    }
                }
            ];

            prorationCredits = ItemsBuilder.useProrationCredits(item, amount, proratedUsersCredit, [], {}, {});
            expect(diff(prorationCredits, expected)).toEqual();
        });

        it("hack same quantities", function() {
            var proratedUsersCredit = [
                {
                    InvoiceItem: {
                        Quantity: item.InvoiceItem.Quantity,
                        ChargeName: "Users",
                        ChargeAmount: -10,
                        AccountingCode: "ANNUALFEE",
                        ServiceStartDate: "2016-05-02",
                        ServiceEndDate: "2016-05-04"
                    },
                    Subscription: {
                        Name: "name1"
                    }
                }
            ];

            var expected = {
                amount: amount + proratedUsersCredit[0].InvoiceItem.ChargeAmount,
                prorated: true,
                quantity: 1
            };

            var prorationCredits = ItemsBuilder.useProrationCredits(item, amount, proratedUsersCredit, [], {}, {});
            expect(diff(prorationCredits, expected)).toEqual();
        });

        it("multiple credits, use discount and adjustment", function() {
            var proratedUsersCredit = [
                {
                    InvoiceItem: {
                        Id: "id1",
                        Quantity: 10,
                        ChargeName: "Users",
                        ChargeAmount: 10,
                        AccountingCode: "ANNUALFEE",
                        ServiceStartDate: "2016-05-02",
                        ServiceEndDate: "2016-05-04"
                    },
                    Subscription: {
                        Name: "name1"
                    }
                },
                {
                    InvoiceItem: {
                        Id: "id2",
                        Quantity: 5,
                        ChargeName: "Users",
                        ChargeAmount: -10,
                        AccountingCode: "ANNUALFEE",
                        ServiceStartDate: "2016-05-02",
                        ServiceEndDate: "2016-05-04"
                    },
                    Subscription: {
                        Name: "name1"
                    }
                }
            ];

            var discountMap = { "id1": -5, "id2": 10 },
                adjustmentMap = { "id1": -5, "id2": 10 },
                prorationCredits = ItemsBuilder.useProrationCredits(item, amount, proratedUsersCredit, [], discountMap, adjustmentMap);


            var expected = {
                amount: amount + 10,
                prorated: true,
                quantity: 10
            };
            expect(diff(prorationCredits, expected)).toEqual();
        });
    });

    // TODO: write end to end test
});
