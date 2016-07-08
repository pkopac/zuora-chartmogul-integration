"use strict";
/* eslint-env node, jasmine */

// var Importer = require("../importer.js").Importer;
var InvoiceBuilder = require("../invoiceBuilder.js").InvoiceBuilder;
// var diff = require("deep-diff").diff;

describe("InvoiceBuilder", function(){
    it("makes discount map", function(){
        const ACCOUNT1 = "1";
        var result = InvoiceBuilder.processDiscounts([
            {InvoiceItem: {AccountingCode: "NON_FREE", ChargeName: "Initial Discount: 1 Month", AppliedToInvoiceItemId: "foreignID", ChargeAmount: -5},
                Account: {AccountNumber: ACCOUNT1}},
            {InvoiceItem: {AccountingCode: "NON_FREE", ChargeName: "something", AppliedToInvoiceItemId: "foreignID", ChargeAmount: -5},
                Account: {AccountNumber: ACCOUNT1}}
        ]);
        expect(result).toEqual({foreignID: -5});
    });
});
