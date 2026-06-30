/**
 * FOCUS 1.1 — FinOps Open Cost and Usage Specification, version 1.1
 * https://focus.finops.org/
 */

export const FOCUS_VERSION = "1.1";

export type FocusServiceCategory =
    | "AI and Machine Learning"
    | "Analytics"
    | "Compute"
    | "Databases"
    | "Developer Tools"
    | "Multicloud"
    | "Identity"
    | "Integration"
    | "Internet of Things"
    | "Management and Governance"
    | "Media"
    | "Migration"
    | "Mobile"
    | "Networking"
    | "Security"
    | "Storage"
    | "Web"
    | "Business Applications"
    | "Other"
    | "";

/**
 * Canonical FOCUS 1.1 columns in spec order.
 */
export const FOCUS_COLUMNS = [
    "AvailabilityZone",
    "BilledCost",
    "BillingAccountId",
    "BillingAccountName",
    "BillingCurrency",
    "BillingPeriodEnd",
    "BillingPeriodStart",
    "ChargeCategory",
    "ChargeClass",
    "ChargeDescription",
    "ChargeFrequency",
    "ChargePeriodEnd",
    "ChargePeriodStart",
    "CommitmentDiscountCategory",
    "CommitmentDiscountId",
    "CommitmentDiscountName",
    "CommitmentDiscountQuantity",
    "CommitmentDiscountStatus",
    "CommitmentDiscountType",
    "CommitmentDiscountUnit",
    "ConsumedQuantity",
    "ConsumedUnit",
    "ContractedCost",
    "ContractedUnitPrice",
    "EffectiveCost",
    "InvoiceIssuerName",
    "ListCost",
    "ListUnitPrice",
    "PricingCategory",
    "PricingQuantity",
    "PricingUnit",
    "ProviderName",
    "PublisherName",
    "RegionId",
    "RegionName",
    "ResourceId",
    "ResourceName",
    "ResourceType",
    "ServiceCategory",
    "ServiceName",
    "ServiceSubcategory",
    "SkuId",
    "SkuMeter",
    "SkuPriceDetails",
    "SkuPriceId",
    "SubAccountId",
    "SubAccountName",
    "Tags",
] as const;

export type FocusColumn = (typeof FOCUS_COLUMNS)[number];

export type FocusRecord = {
    [K in FocusColumn]: string | number;
};

export function emptyFocusRecord(): FocusRecord {
    const r = {} as FocusRecord;
    for (const c of FOCUS_COLUMNS) {
        r[c] = "";
    }
    return r;
}
