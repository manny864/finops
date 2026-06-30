/**
 * Maps internal billing rows (CostSnapshots) into FOCUS 1.1 records.
 */

import { toMoneyNumber } from "@/lib/money";
import {
    FOCUS_COLUMNS,
    type FocusRecord,
    type FocusServiceCategory,
    emptyFocusRecord,
} from "./columns";

export interface CostSnapshotRow {
    tenant_id?: string;
    subscription_id?: string | null;
    date?: string | Date | null;
    resource_group?: string | null;
    service_name?: string | null;
    cost_usd?: string | number | null;
    currency?: string | null;
    ChargePeriodStart?: string | Date | null;
    ChargePeriodEnd?: string | Date | null;
    ProviderName?: string | null;
    PublisherName?: string | null;
    SubAccountId?: string | null;
    BilledCost?: string | number | null;
    EffectiveCost?: string | number | null;
    CommitmentDiscountId?: string | null;
    MeterId?: string | null;
    MeterName?: string | null;
    MeterCategory?: string | null;
    MeterSubCategory?: string | null;
    Quantity?: string | number | null;
    UnitOfMeasure?: string | null;
    ResourceId?: string | null;
    ServiceFamily?: string | null;
    Tags?: string | Record<string, unknown> | null;
}

function toIsoDate(d: string | Date | null | undefined): string {
    if (!d) return "";
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
}

function nonEmpty(v: unknown, fallback = ""): string {
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return s.length > 0 ? s : fallback;
}

function numeric(v: unknown, fallback = 0): number {
    if (v === null || v === undefined || v === "") return fallback;
    return toMoneyNumber(v as string | number);
}

const AZURE_FAMILY_TO_CATEGORY: Record<string, FocusServiceCategory> = {
    "Compute": "Compute",
    "Storage": "Storage",
    "Networking": "Networking",
    "Databases": "Databases",
    "Web": "Web",
    "AI + Machine Learning": "AI and Machine Learning",
    "AI + Cognitive Services": "AI and Machine Learning",
    "Analytics": "Analytics",
    "Security": "Security",
    "Identity": "Identity",
    "Integration": "Integration",
    "Internet of Things": "Internet of Things",
    "Management and Governance": "Management and Governance",
    "Media": "Media",
    "Migration": "Migration",
    "Mobile": "Mobile",
    "Containers": "Compute",
    "Developer Tools": "Developer Tools",
    "Other": "Other",
};

function inferServiceCategory(family: string | null | undefined, service: string | null | undefined): FocusServiceCategory {
    if (family && AZURE_FAMILY_TO_CATEGORY[family]) return AZURE_FAMILY_TO_CATEGORY[family];
    if (!service) return "Other";
    const s = service.toLowerCase();
    if (s.includes("storage") || s.includes("blob") || s.includes("disk") || /\bs3\b/.test(s)) return "Storage";
    if (s.includes("sql") || s.includes("cosmos") || s.includes("postgres") || s.includes("mysql") || s.includes("redis") || s.includes("dynamodb") || s.includes("rds")) return "Databases";
    if (s.includes("vm") || s.includes("virtual machine") || s.includes("compute") || s.includes("vmss") || s.includes("aks") || s.includes("kubernetes") || s.includes("container") || s.includes("ec2") || s.includes("lambda")) return "Compute";
    if (s.includes("network") || s.includes("bandwidth") || s.includes("vpn") || s.includes("expressroute") || s.includes("load balancer") || s.includes("application gateway")) return "Networking";
    if (s.includes("app service") || s.includes("function") || s.includes("web app")) return "Web";
    if (s.includes("cognitive") || s.includes("openai") || s.includes("machine learning")) return "AI and Machine Learning";
    if (s.includes("monitor") || s.includes("log analytics") || s.includes("policy")) return "Management and Governance";
    if (s.includes("event") || s.includes("service bus") || s.includes("api management") || s.includes("logic app")) return "Integration";
    if (s.includes("key vault") || s.includes("defender") || s.includes("sentinel") || s.includes("security")) return "Security";
    return "Other";
}

function normaliseTags(tags: string | Record<string, unknown> | null | undefined): string {
    if (!tags) return "{}";
    if (typeof tags === "string") {
        const t = tags.trim();
        if (!t) return "{}";
        try {
            JSON.parse(t);
            return t;
        } catch {
            return JSON.stringify({ raw: t });
        }
    }
    try {
        return JSON.stringify(tags);
    } catch {
        return "{}";
    }
}

export function mapCostSnapshotToFocus(
    row: CostSnapshotRow,
    opts: { billingPeriodStart?: string; billingPeriodEnd?: string; invoiceIssuerName?: string } = {}
): FocusRecord {
    const rec = emptyFocusRecord();

    const provider = nonEmpty(row.ProviderName, "Azure");
    const publisher = nonEmpty(row.PublisherName, provider === "AWS" ? "Amazon Web Services" : "Microsoft");
    const subId = nonEmpty(row.SubAccountId ?? row.subscription_id, "Unknown");

    const usageDate = row.date ? toIsoDate(row.date) : "";
    const chargeStart = toIsoDate(row.ChargePeriodStart) || usageDate;
    const chargeEnd = toIsoDate(row.ChargePeriodEnd) || usageDate || chargeStart;
    const billingStart = opts.billingPeriodStart || chargeStart;
    const billingEnd = opts.billingPeriodEnd || chargeEnd;

    const billed = numeric(row.BilledCost ?? row.cost_usd);
    const effective = numeric(row.EffectiveCost ?? row.cost_usd ?? row.BilledCost);
    const quantity = numeric(row.Quantity, 0);

    const serviceName = nonEmpty(row.service_name, "Unallocated");
    const serviceCategory = inferServiceCategory(row.ServiceFamily, serviceName);

    rec.AvailabilityZone = "";
    rec.BilledCost = billed;
    rec.BillingAccountId = subId;
    rec.BillingAccountName = "";
    rec.BillingCurrency = nonEmpty(row.currency, "USD");
    rec.BillingPeriodStart = billingStart;
    rec.BillingPeriodEnd = billingEnd;
    rec.ChargeCategory = "Usage";
    rec.ChargeClass = "";
    rec.ChargeDescription = nonEmpty(row.MeterName) || serviceName;
    rec.ChargeFrequency = "Usage-Based";
    rec.ChargePeriodStart = chargeStart;
    rec.ChargePeriodEnd = chargeEnd;
    rec.CommitmentDiscountCategory = "";
    rec.CommitmentDiscountId = nonEmpty(row.CommitmentDiscountId);
    rec.CommitmentDiscountName = "";
    rec.CommitmentDiscountQuantity = "";
    rec.CommitmentDiscountStatus = "";
    rec.CommitmentDiscountType = "";
    rec.CommitmentDiscountUnit = "";
    rec.ConsumedQuantity = quantity;
    rec.ConsumedUnit = nonEmpty(row.UnitOfMeasure);
    rec.ContractedCost = effective;
    rec.ContractedUnitPrice = quantity > 0 ? Math.round((effective / quantity) * 1e6) / 1e6 : 0;
    rec.EffectiveCost = effective;
    rec.InvoiceIssuerName = opts.invoiceIssuerName || publisher;
    rec.ListCost = billed;
    rec.ListUnitPrice = quantity > 0 ? Math.round((billed / quantity) * 1e6) / 1e6 : 0;
    rec.PricingCategory = "Standard";
    rec.PricingQuantity = quantity;
    rec.PricingUnit = nonEmpty(row.UnitOfMeasure);
    rec.ProviderName = provider;
    rec.PublisherName = publisher;
    rec.RegionId = "";
    rec.RegionName = "";
    rec.ResourceId = nonEmpty(row.ResourceId);
    rec.ResourceName = nonEmpty(row.resource_group);
    rec.ResourceType = nonEmpty(row.MeterCategory);
    rec.ServiceCategory = serviceCategory;
    rec.ServiceName = serviceName;
    rec.ServiceSubcategory = nonEmpty(row.MeterSubCategory);
    rec.SkuId = nonEmpty(row.MeterId);
    rec.SkuMeter = nonEmpty(row.MeterName);
    rec.SkuPriceDetails = "";
    rec.SkuPriceId = "";
    rec.SubAccountId = subId;
    rec.SubAccountName = "";
    rec.Tags = normaliseTags(row.Tags);

    return rec;
}

export { FOCUS_COLUMNS };
