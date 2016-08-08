"use strict";

var logger = require("log4js")
                .getLogger("itemsBuilder"),
    VError = require("verror"),
    moment = require("moment"),
    PLANS = require("./importer.js").Importer.PLANS;

require("moment-range");


var ItemsBuilder = function() {};

ItemsBuilder.RATE_TO_PLANS = {
    ANNUALFEE: PLANS.GENERIC_ANNUALLY,
    MONTHLYFEE: PLANS.GENERIC_MONTHLY,
    QUARTERLYFEE: PLANS.GENERIC_QUARTERLY
};

//TODO: move into separate file or configuration

ItemsBuilder.PERSONAL = {"Personal Plus": 1};

ItemsBuilder.STORAGE_PRORATION_CREDIT = {
    "Additional Storage: 10GB -- Proration Credit": 1,
    "Extra storage: 500 GB -- Proration Credit": 1,
    "Additional Storage: 500GB -- Proration Credit": 1
};

ItemsBuilder.STORAGE_PRORATION = {
    "Additional Storage: 10GB -- Proration": 1,
    "Extra storage: 500 GB -- Proration": 1,
    "Additional Storage: 500GB -- Proration": 1
};

ItemsBuilder.USERS_ITEMS = {
    "Users": 1
};

ItemsBuilder.USERS_PRORATION = {
    "Users -- Proration": 1
};

ItemsBuilder.USER_PRORATION_CREDIT = {
    "Users -- Proration Credit": 1,
    "Personal Plus -- Proration Credit": 1
};

ItemsBuilder.STORAGE_ITEMS = {
    "Extra storage: 500 GB": 1,
    "Additional Storage: 500GB": 1,
    "Additional Storage: 10GB": 1,
    "Initial 250 GB of storage": 1
};

ItemsBuilder.DISCOUNTS = {
    "Initial Discount: 1 Year": 1,
    "Initial Discount: 1 Month": 1,
    "Initial Fixed Discount : 1 Month": 1,
    "Initial Fixed Discount : 1 Year": 1
};

ItemsBuilder.BLACKLIST = {
    "Business Pro": 1,
    "Pro": 1
};


ItemsBuilder.processItems = function(
    items, proratedUsersCredit, proratedStorageCredit, context) {

    var discountMap = context.discountMap,
        adjustmentMap = context.adjustmentMap,
        plans = context.plans;

    logger.trace(items.map(i=>i.InvoiceItem.ChargeName));

    var result = items
        // Cannot - because of downgrades to free
        //.filter(item => item.InvoiceItem.Quantity !== 0 && item.InvoiceItem.UOM !== 0)
        .map(item => {
            logger.trace("InvoiceItem.Id %s - %s...", item.InvoiceItem.Id, item.InvoiceItem.ChargeName);
            ItemsBuilder.checkItemSanity(item);

            /* Use discounts, adjustments and invoice adjustments */
            var discount = (discountMap[item.InvoiceItem.Id] || 0) + (adjustmentMap[item.InvoiceItem.Id] || 0),
                amount = item.InvoiceItem.ChargeAmount + discount;

            logger.trace("discount %d, adjustment %d, invoiceAdjustmentAmount %d",
                discountMap[item.InvoiceItem.Id] || 0, adjustmentMap[item.InvoiceItem.Id] || 0, context.invoiceAdjustmentAmount || 0);

            // the storage is for free usually...
            //TODO: how to include storage? it's different kind of quantity, so it would screw the stats
            //TODO: one time charges
            var start = moment.utc(item.InvoiceItem.ServiceStartDate),
                end = moment.utc(item.InvoiceItem.ServiceEndDate);

            var prorationCredits = ItemsBuilder.useProrationCredits(
                item, amount, proratedUsersCredit, proratedStorageCredit, discountMap, adjustmentMap);

            amount = prorationCredits.amount;
            var prorated = prorationCredits.prorated,
                quantity = prorationCredits.quantity;

            if (!prorated &&
                (item.InvoiceItem.ChargeName in ItemsBuilder.USERS_PRORATION ||
                item.InvoiceItem.ChargeName in ItemsBuilder.STORAGE_PRORATION)) {
                logger.warn("Couldn't find credit, but item is prorated! Invoice: %s", item.Invoice.InvoiceNumber);
            }

            /* Deal with invoice adjustments */
            if (context.invoiceAdjustmentAmount) {
                var adjustments = ItemsBuilder.resolveInvoiceAdjustments(context.invoiceAdjustmentAmount, discount, amount);
                discount = adjustments.discount;
                amount = adjustments.amount;
                context.invoiceAdjustmentAmount = adjustments.invoiceAdjustmentAmount;
            }

            /* chartmogul number format = in cents, discount positive number */
            amount = Math.round(amount * 100);
            discount = Math.round(discount * -100);

            if (item.InvoiceItem.ChargeName in ItemsBuilder.STORAGE_ITEMS &&
                amount === 0 && discount === 0) {
                return; //useless
            }

            var plan = ItemsBuilder.getPlan(item, plans);

            // compile line item for chartmogul
            return {
                type: "subscription",
                // for deleted subscriptions we can't get the right number
                subscription_external_id: item.Subscription.Name || item.Subscription.Id,
                plan_uuid: plan,
                service_period_start: start,
                service_period_end: end,
                amount_in_cents: amount, // in cents
                cancelled_at: ItemsBuilder.getSubscriptionCanceledDate(item),
                prorated: prorated,
                quantity,
                //discount_code: undefined,
                discount_amount_in_cents: discount,
                tax_amount_in_cents: item.InvoiceItem.TaxAmount,
                external_id: item.InvoiceItem.Id,
                __amendmentType: item.Amendment.Type
            };

        })
        .filter(Boolean);

    result = result.concat(ItemsBuilder.handleUnmatchedCredits(
                            proratedUsersCredit, proratedStorageCredit, context)
                        );

    result = ItemsBuilder.mergeSimilar(result);

    return result;
};

/**
 * Sometimes there are things listed separately for no reason.
 */
ItemsBuilder.mergeSimilar = function(items) {
    for (var i = 0; i < items.length - 1; i++) {
        var item = items[i],
            itemStart = moment.utc(item.service_period_start),
            itemEnd = moment.utc(item.service_period_end);

        for (var k = i + 1; k < items.length; k++) {
            var another = items[k],
                anotherStart = moment.utc(another.service_period_start),
                anotherEnd = moment.utc(another.service_period_end);

            /* Items are practically the same... */
            if (+itemStart === +anotherStart &&
                +itemEnd === +anotherEnd &&
                item.subscription_external_id === another.subscription_external_id &&
                item.plan_uuid === another.plan_uuid &&
                item.type === another.type &&
                (item.quantity + another.quantity) !== 0
            ) {
                logger.debug("Merging item " + item.external_id + " with " + another.external_id);
                item.prorated = item.prorated || another.prorated;
                item.quantity += another.quantity;
                item.discount_amount_in_cents += another.discount_amount_in_cents;
                item.tax_amount_in_cents += another.tax_amount_in_cents;
                item.amount_in_cents += another.amount_in_cents;
                items.splice(k, 1);
                k--; // process the same index again, because it is now a different item
            }
        }

    }
    return items.filter(i => i.quantity);
};

/**
 * Adjustments always adjust the values towards zero (else in second condition).
 */
ItemsBuilder.resolveInvoiceAdjustments = function(invoiceAdjustmentAmount, discount, amount) {
    // subtracting is basically discount
    if (invoiceAdjustmentAmount < 0) {
        discount += invoiceAdjustmentAmount;
    }
    // adding charge by invoice adjustment is pretty crazy, so who knows what that should be...

    // perfect match of amount and adjustment?
    if (amount + invoiceAdjustmentAmount === 0) {
        invoiceAdjustmentAmount = 0;
        amount = 0;
    // partial match?
    } else if (Math.sign(amount) !== Math.sign(invoiceAdjustmentAmount)) {
        if (Math.abs(amount) > Math.abs(invoiceAdjustmentAmount)) {
            amount += invoiceAdjustmentAmount;
            invoiceAdjustmentAmount = 0;
        } else {
            invoiceAdjustmentAmount += amount;
            amount = 0;
        }
    }
    // else if signs match, skip this item, it probably should go to another one
    return {invoiceAdjustmentAmount, discount, amount};
};

ItemsBuilder.useProrationCredits = function(item, amount, proratedUsersCredit, proratedStorageCredit, discountMap, adjustmentMap) {
    var prorated = false,
        quantity = item.InvoiceItem.Quantity,
        credits = (item.InvoiceItem.ChargeName in ItemsBuilder.USERS_PRORATION ||
                   item.InvoiceItem.ChargeName in ItemsBuilder.USERS_ITEMS) ?
                    proratedUsersCredit : proratedStorageCredit;

    logger.error(item);
    var index = credits.length - 1;
    while (index >= 0) {
        let credit = credits[index];
        if (credit.Subscription.Name !== item.Subscription.Name || // different subscription
            // credit.InvoiceItem.Quantity === item.InvoiceItem.Quantity || // would result in 0 change
            !ItemsBuilder.serviceIntersection(credit, item) || // non-intersecting
            credit.InvoiceItem.AccountingCode !== item.InvoiceItem.AccountingCode) { // change of plan
            index--;
            continue;
        }
        prorated = true; // amount & quantity = change/differential
        if (credit.InvoiceItem.Quantity === item.InvoiceItem.Quantity) {
            quantity++; // HACK HACK HACK! CM doesn't accept 0 quantity;
        }
        // yes, really! See INV00003933, INV00004009
        let discountOnProration = (discountMap[credit.InvoiceItem.Id] || 0) + (adjustmentMap[credit.InvoiceItem.Id] || 0);
        //we are subtracting from amount (credit is negative)
        logger.debug("Applying credit %d with discount %d and quantity %d",
            credit.InvoiceItem.ChargeAmount, discountOnProration, item.InvoiceItem.Quantity);

        amount += (credit.InvoiceItem.ChargeAmount + discountOnProration);
        // this can result in negative quantity => prorated downgrade
        if (credit.InvoiceItem.ChargeAmount > 0) {
            // for some wicked reason, there are charged credits, see INV00005475
            quantity += credit.InvoiceItem.Quantity;
        } else {
            quantity -= credit.InvoiceItem.Quantity;
        }

        credits.splice(index, 1);
        index--;
    }

    return {amount, prorated, quantity};
};

ItemsBuilder.getPlan = function(item, plans) {
    var uuid = (item.ProductRatePlan || {}).Id;
    var plan = plans[uuid];

    if (!plan) {
        plan = plans[ItemsBuilder.RATE_TO_PLANS[item.InvoiceItem.AccountingCode]];
        logger.warn("There are items with deleted subscription on this invoice! %s", item.Invoice.InvoiceNumber);
    }
    if (!plan) {
        logger.error(item);
        throw new VError("Couldn't find UUID for plan");
    }
    else {
        return plan;
    }
};

/* Utilities */

ItemsBuilder.checkItemSanity = function(item) {
    if (!item.InvoiceItem.ServiceStartDate) {
        throw new VError("ServiceStartDate " + String(item.InvoiceItem.ServiceStartDate));
    }
    if (!item.InvoiceItem.ServiceEndDate) {
        throw new VError("ServiceEndDate " + String(item.InvoiceItem.ServiceEndDate));
    }
    // if ((item.InvoiceItem.Quantity === 0 || item.InvoiceItem.UnitPrice === 0) && item.InvoiceItem.ChargeAmount !== 0) {
    //     logger.error(item);
    //     throw new VError("Charge should be 0!");
    // }
};

ItemsBuilder.rangeIntersection = function(aStart, aEnd, bStart, bEnd) {
    var rangeA = moment.range(moment.utc(aStart), moment.utc(aEnd)),
        rangeB = moment.range(moment.utc(bStart), moment.utc(bEnd)),
        intersection = rangeA.intersect(rangeB);

    if (intersection) {
        return intersection.diff("seconds");
    } else {
        return 0;
    }
};

ItemsBuilder.serviceIntersection = function(a, b) {
    return ItemsBuilder.rangeIntersection(
        a.InvoiceItem.ServiceStartDate, a.InvoiceItem.ServiceEndDate,
        b.InvoiceItem.ServiceStartDate, b.InvoiceItem.ServiceEndDate
    );
};

/**
 * Either returns the cancellation date or checks, whether it could be
 * a deleted subscription with leftover invoice (Zuora support says this
 * shouldn't happen). It's a freaky state and we must guess something, so
 * let's suppose the subscription was cancelled at the end.
 * @returns when cancelled or undefined
 */
ItemsBuilder.getSubscriptionCanceledDate = function(item) {
    if (item.Subscription.CancelledDate) {
        return moment.utc(item.Subscription.CancelledDate);
    } else {
        if (!item.Subscription.Name) {
            return moment.utc(item.InvoiceItem.ServiceEndDate);
        }
    }
};

/**
 * Let's suppose missing "Users" means => 0.
 * Recursive!
 */
ItemsBuilder.handleUnmatchedCredits = function(proratedUsersCredit, proratedStorageCredit, context) {
    var result = [];
    if (proratedUsersCredit.length) {
        var items = proratedUsersCredit.map(function(credit) {
            var copy = JSON.parse(JSON.stringify(credit));
            copy.InvoiceItem.ChargeName = "Users -- Proration";
            // this basically means this subscription has been downgraded to zero
            copy.InvoiceItem.ChargeAmount = 0;
            copy.InvoiceItem.Quantity = 0;
            copy.InvoiceItem.Id += "-a"; // so it doesn't match against discounts

            return copy;
        });
        result = result.concat(ItemsBuilder.processItems(
            items, proratedUsersCredit, proratedStorageCredit, context)
        );
        //throw new VError("Unmatched user credit items: " + context.proratedUsersCredit.length);
    }
    if (proratedStorageCredit.length) {
        logger.debug(proratedStorageCredit);
        throw new VError("Unmatched storage credit items: " + proratedStorageCredit.length);
    }
    return result;
};

exports.ItemsBuilder = ItemsBuilder;
