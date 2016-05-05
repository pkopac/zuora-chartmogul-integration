"use strict";

var logger = require("log4js").getLogger(),
    VError = require("verror"),
    // _ = require("lodash"),
    moment = require("moment"),
    importerModule = require("./importer.js"),
    Invoice = importerModule.Invoice,
    PLANS = importerModule.Importer.PLANS;

var InvoiceBuilder = function() {

};

/* These constants are definitely company-specific and maybe should be refactored
 * out into config file. */

InvoiceBuilder.MONTHS_UNPAID_TO_CANCEL = 2;

InvoiceBuilder.PERSONAL = "Personal Plus";

InvoiceBuilder.RATE_TO_PLANS = {
    ANNUALFEE: PLANS.PRO_ANNUALLY,
    MONTHLYFEE: PLANS.PRO_MONTHLY,
    QUARTERLYFEE: PLANS.PRO_QUARTERLY
};

InvoiceBuilder.PRORATED_STORAGE = {
    "Additional Storage: 10GB -- Proration Credit": 1,
    "Extra storage: 500 GB -- Proration Credit": 1,
    "Additional Storage: 500GB -- Proration Credit": 1
};

InvoiceBuilder.CURRENCY = {
    "US Dollar": "USD",
    "Euro": "EUR"
};

InvoiceBuilder.USERS_ITEMS = {
    "Users": 1,
    "Users -- Proration": 1
};

InvoiceBuilder.USER_PRORATION_CREDIT = {
    "Users -- Proration Credit": 1,
    "Personal Plus -- Proration Credit": 1
};

InvoiceBuilder.STORAGE_ITEMS = {
    "Extra storage: 500 GB": 1,
    "Additional Storage: 500GB": 1,
    "Additional Storage: 10GB": 1,
    "Initial 250 GB of storage": 1
};

InvoiceBuilder.DISCOUNTS = {
    "Initial Discount: 1 Year": 1,
    "Initial Discount: 1 Month": 1,
    "Initial Fixed Discount : 1 Month": 1,
    "Initial Fixed Discount : 1 Year": 1
};

InvoiceBuilder.getCurrency = function(zuoraCurrency) {
    var result = InvoiceBuilder.CURRENCY[zuoraCurrency];
    if (!result) {
        throw new VError("Unknown currency from Zuora: " + zuoraCurrency);
    }
    return result;
};

InvoiceBuilder.buildInvoice = function(invoiceNumber, invoiceItems, postedDate,
    dueDate, currency, itemAdjs, invoiceAdjs, creditAdjs, payments, refunds,
    plansById) {
    try {
        if (!postedDate) {
            throw new VError("postedDate " + postedDate);
        }
        if (!dueDate) {
            throw new VError("dueDate " + dueDate);
        }
        // TODO: Currency per account! If currency changes, this might be wrong.
        var invoice = new Invoice(
            invoiceNumber,
            moment.utc(postedDate),
            InvoiceBuilder.getCurrency(currency),
            moment.utc(dueDate)
        );

        InvoiceBuilder.addInvoiceItems(
            invoiceItems,
            invoice,
            itemAdjs,
            invoiceAdjs,
            creditAdjs,
            plansById
        );

        InvoiceBuilder.addPayments(payments,
            invoice,
            "Payment");

        InvoiceBuilder.addPayments(refunds,
            invoice,
            "Refund");
        logger.trace("Invoice built", invoice);
        return invoice;
    } catch (error) {
        throw new VError(error, "Couldn't build invoice " + invoiceNumber);
    }
};

InvoiceBuilder.addPayments = function(array, invoice, type) {
    if (!array || !array.length) {
        return 0;
    }
    var total = 0;

    array.forEach(function (payment) {
        var p = payment[type];
        var transaction = {
            date: moment.utc(p.CreatedDate || p.RefundDate),
            type: type.toLowerCase(),
            result: p.Status === "Processed" ? "successful" : "failed",
            // because one payment number can be assigned to multiple invoices
            external_id: (type === "Payment" ? p.PaymentNumber : p.RefundNumber) + "-" + p.Invoice.InvoiceNumber
        };

        total += p.Amount; //for debug
        invoice.addTransaction(transaction);
    });

    //TODO: test
    var invoiceTotal = invoice.line_items
            .reduce((prev, item) => prev + item.amount_in_cents, 0);
    if (total !== invoiceTotal) {
        throw new VError("Payments/Refunds (" + total + ") don't equal invoice total: " + invoiceTotal + "!");
    }

    return total;
};

InvoiceBuilder.addInvoiceItems = function(invoiceItems, invoice, adjustments, invoiceAdjustments, creditAdjustments, planUuids) {

    // logger.trace("adjustments", adjustments);
    // logger.trace("invoiceAdjustments", invoiceAdjustments);
    // logger.trace("creditAdjustments", creditAdjustments);

    var processedAdjustments = InvoiceBuilder.processAdjustments(adjustments),
        adjustmentMap = processedAdjustments[0],
        itemAdjustmentAmountTotal = processedAdjustments[1],
        invoiceAdjustmentAmount = InvoiceBuilder.processInvoiceAdjustments(invoiceAdjustments) +
            InvoiceBuilder.processCreditAdjustments(creditAdjustments),
        discountMap = InvoiceBuilder.processDiscounts(invoiceItems);

    var items = InvoiceBuilder.itemsForInvoice(invoiceItems,
        invoiceItems.some(item => item.ChargeName in InvoiceBuilder.USER_PRORATION_CREDIT),
        invoiceItems.some(item => item.ChargeName in InvoiceBuilder.PRORATED_STORAGE),
        invoiceAdjustmentAmount,
        discountMap,
        adjustmentMap,
        planUuids);

    var positive = InvoiceBuilder.processNegativeItems(items, invoice);

    InvoiceBuilder.testTotalOfInvoiceEqualsTotalOfLineItems( // runtime sanity check
        invoiceItems[0], positive, itemAdjustmentAmountTotal, invoiceAdjustmentAmount);

    InvoiceBuilder.cancelLongDueInvoices(invoiceItems[0], positive);

    positive.forEach(invoice.addLineItem.bind(invoice));

    return invoice;
};

InvoiceBuilder.processNegativeItems = function(items, invoice) {
    var positive = items.filter(function (lineItem) {
        return lineItem.amount_in_cents >= 0;
    });
    items.filter(function (lineItem) {
        return lineItem.amount_in_cents < 0;
    }).forEach(function (negativeItem) {
        var found = positive.find(item => negativeItem.subscription_external_id === item.subscription_external_id);
        if (!found) {
            logger.warn("Invoice %s has unmatched negative items!", invoice.external_id, negativeItem);
            positive.push(negativeItem); // so this unmatched item gets in the result
            return;
        }
        found.amount_in_cents += negativeItem.amount_in_cents;
        found.quantity -= negativeItem.quantity;
    });
    return positive;
};

InvoiceBuilder.testTotalOfInvoiceEqualsTotalOfLineItems = function (firstItem, positiveItems, itemAdjustmentAmountTotal, invoiceAdjustmentAmount) {
    var shouldBeTotal = Math.round((firstItem.Invoice.Amount + itemAdjustmentAmountTotal + invoiceAdjustmentAmount) * 100),
        total = positiveItems.reduce(function (prev, cur) {
            return prev + cur.amount_in_cents;
        }, 0);
    if (total !== shouldBeTotal) {
        logger.error("total: %d, shouldBeTotal: %d = (%d + %d + %d) * 100",
            total, shouldBeTotal, firstItem.Invoice.Amount, itemAdjustmentAmountTotal, invoiceAdjustmentAmount);

        throw new VError("Total of line items not the total of invoice!");
    }
};

/**
 * HACK: unpaid invoice more than X months -> cancel subscriptions.
 * Under normal circumstances such accounts should be dealt with by sales
 * retention process.
 */
InvoiceBuilder.cancelLongDueInvoices = function (firstItem, positiveItems) {
    if (firstItem.Invoice.Amount > 0 &&
            firstItem.Invoice.Balance > 0 &&
            moment().diff(moment.utc(firstItem.Invoice.DueDate), "month") >= InvoiceBuilder.MONTHS_UNPAID_TO_CANCEL &&
            !positiveItems[0].cancelled_at) {

        positiveItems.forEach(function (item) {
            item.cancelled_at = positiveItems
                .filter(i => i.amount_in_cents > 0)[0]
                .service_period_start;
        });
    }
};

InvoiceBuilder.itemsForInvoice = function(invoiceItems, proratedUsers,
    proratedStorage, invoiceAdjustmentAmount, discountMap, adjustmentMap, planUuids) {

    return invoiceItems
        // Free items don't influence anything in any way
        .filter(item => item.AccountingCode !== "FREE")
        .map(function (item) {
            var process = false,
                prorated = false,
                itemName = item.ChargeName;


            if (itemName in InvoiceBuilder.USERS_ITEMS || itemName in InvoiceBuilder.USER_PRORATION_CREDIT) {
                process = InvoiceBuilder.USERS_ITEMS;
                prorated = proratedUsers || itemName === "Users -- Proration";
            } else if ((itemName in InvoiceBuilder.STORAGE_ITEMS || itemName in InvoiceBuilder.PRORATED_STORAGE) &&
                item.Quantity !== 0 && item.UOM !== 0) {
                process = InvoiceBuilder.STORAGE_ITEMS;
                prorated = proratedStorage;
            } else if (itemName === InvoiceBuilder.PERSONAL) {
                process = InvoiceBuilder.PERSONAL;
            }

            if (process) {
                logger.trace("Processing of invoice item %s...", itemName);
                if (!item.ServiceStartDate) {
                    throw new VError("ServiceStartDate " + item.ServiceStartDate);
                }
                if (!item.ServiceEndDate) {
                    throw new VError("ServiceEndDate " + item.ServiceEndDate);
                }
                var id = item.Id;
                var discount = discountMap[id] || 0;
                var adjustment = adjustmentMap[id] || 0;
                logger.trace("discount %d, adjustment %d, invoiceAdjustmentAmount %d", discount, adjustment, invoiceAdjustmentAmount);
                discount += adjustment + invoiceAdjustmentAmount;
                var amount = Math.round((item.ChargeAmount + discount) * 100);

                invoiceAdjustmentAmount = 0; // apply only once!

                // if (prorationCredit && hasServiceIntersection(prorationCredit, item) &&
                //     process === USERS_ITEMS) {
                //     var discountOnProration = discountMap[prorationCredit[INVOICE_ITEM.ID]] || 0; // yes, really! See INV00003933
                //
                //     amount += (prorationCredit[INVOICE_ITEM.CHARGE_AMOUNT] + discountOnProration) * 100;
                // }
                //
                // if ((item[IN.QUANTITY] === 0 || item[IN.UNIT_PRICE] === 0) && amount !== 0) {
                //     logger.error(item);
                //     logger.error("Charge should be 0!");
                // }

                discount = discount * -100;
                if (discount < 0) { // Negative discount shouldn't be discount, but adjustment!
                    // discount = 0;
                    throw new VError("Negative discount! Charge: " + item.ChargeName);
                }

                amount = Math.round(amount);
                if (!amount) {
                    return; // zero items are good for nothing
                }

                //HACK: Chartmogul doesn't allow start == end
                let start = moment.utc(item.ServiceStartDate),
                    end = moment.utc(item.ServiceEndDate);
                if (start === end) {
                    end = moment.utc(end).add(1, "day").toDate().getTime();
                }

                // compile line item for chartmogul
                return {
                    type: "subscription",
                    // for deleted subscriptions we can't get the number
                    subscription_external_id: item.Subscription.Name || item.Subscription.Id,
                    plan_uuid: planUuids[InvoiceBuilder.RATE_TO_PLANS[item.AccountingCode]],
                    service_period_start: start,
                    service_period_end: end,
                    amount_in_cents: amount, // in cents
                    cancelled_at: InvoiceBuilder.getSubscriptionCanceledDate(item),
                    prorated: prorated,
                    quantity: item.Quantity,
                    //discount_code: undefined,
                    discount_amount_in_cents: Math.round(discount),
                    tax_amount_in_cents: item.TaxAmount,
                    external_id: item.Id
                };
            }
        })
        .filter(Boolean);
};

InvoiceBuilder.processAdjustments = function(adjustments) {
    var adjustmentMap = {};
    var itemAdjustmentAmountTotal = 0;
    if (adjustments && adjustments.length) {
        adjustments.forEach(function (adjustment) {
            var amount = adjustment.Amount;
            if (adjustment.Type !== "Charge") {
                amount = -amount;
            }
            itemAdjustmentAmountTotal += amount;
            adjustmentMap[adjustment.Id] = amount;
        });
    }
    return [adjustmentMap, itemAdjustmentAmountTotal];
};

InvoiceBuilder.processInvoiceAdjustments = function(invoiceAdjustments) {
    var invoiceAdjustmentAmount = 0;
    if (invoiceAdjustments && invoiceAdjustments.length) {
        invoiceAdjustments.forEach(function (invoiceAdjustment) {
            var amount = invoiceAdjustment.Amount;
            if (invoiceAdjustment.Type !== "Charge") {
                amount = -amount;
            }
            invoiceAdjustmentAmount += amount;
        });
    }
    return invoiceAdjustmentAmount;
};

/**
 * Zuora contains discounts as invoice items. They have a special type and contain
 * ID to which other item they are related, so in the web GUI they look like a "subitem".
 * @returns a map of discounts by ID of their respective items.
 */
InvoiceBuilder.processDiscounts = function(invoiceItems) {
    var discountMap = {};
    var discounts = invoiceItems.filter(i => i.ChargeName in InvoiceBuilder.DISCOUNTS);
    if (discounts.length) {
        discounts.forEach(function (discount) {
            discountMap[discount.AppliedToInvoiceItemId] = discount.ChargeAmount;
        });
    }
    return discountMap;
};

InvoiceBuilder.processCreditAdjustments = function(creditAdjustments) {
    var adjustments = 0;
    if (creditAdjustments && creditAdjustments.length) {
        creditAdjustments.forEach(function (creditAdjustment) {
            var amount = creditAdjustment.Amount;
            if (creditAdjustment.Type !== "Increase") {
                amount = -amount;
            }
            adjustments += amount;
        });
    }
    return adjustments;
};

/**
 * Either returns the cancellation date or checks, whether it could be
 * a deleted subscription with leftover invoice (Zuora support says this
 * shouldn't happen). It's a freaky state and we must guess something, so
 * let's suppose the subscription was cancelled at the end.
 * @returns when cancelled or undefined
 */
InvoiceBuilder.getSubscriptionCanceledDate = function(item) {
    if (item.Subscription.CancelledDate) {
        return moment.utc(item.Subscription.CancelledDate);
    } else {
        if (!item.Subscription.Name) {
            return moment.utc(item.ServiceEndDate);
        }
    }
};

exports.InvoiceBuilder = InvoiceBuilder;
