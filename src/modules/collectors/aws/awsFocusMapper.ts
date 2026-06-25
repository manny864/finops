/**
 * AWS CUR to FOCUS Schema Mapper
 * Standardizes AWS Cost and Usage Report (CUR) billing lines to the FinOps Open Cost & Usage Specification (FOCUS).
 */

export interface AwsCurLineItem {
    "lineItem/UsageAccountId": string;
    "lineItem/ProductCode": string;
    "lineItem/UsageStartDate": string;
    "lineItem/UsageEndDate": string;
    "lineItem/BlendedCost": string;
    "lineItem/UnblendedCost": string;
    "discount/TotalDiscount": string;
    "resourceTags/user:Project"?: string;
    "resourceTags/user:Environment"?: string;
}

export interface FocusLineItem {
    ProviderName: string;
    PublisherName: string;
    SubAccountId: string;
    ServiceName: string;
    ChargePeriodStart: Date;
    ChargePeriodEnd: Date;
    BilledCost: number;
    EffectiveCost: number;
    Tags: Record<string, string>;
}

export function mapAwsCurToFocus(curRow: AwsCurLineItem): FocusLineItem {
    // Basic extraction
    const BilledCost = parseFloat(curRow["lineItem/UnblendedCost"] || "0");
    const Discount = parseFloat(curRow["discount/TotalDiscount"] || "0");
    const EffectiveCost = BilledCost - Discount; // Simple Effective Cost calculation

    // Extracting Tags dynamically
    const Tags: Record<string, string> = {};
    for (const key of Object.keys(curRow)) {
        if (key.startsWith("resourceTags/user:")) {
            const tagKey = key.replace("resourceTags/user:", "");
            Tags[tagKey] = (curRow as any)[key];
        }
    }

    return {
        ProviderName: "AWS",
        PublisherName: "Amazon Web Services",
        SubAccountId: curRow["lineItem/UsageAccountId"],
        ServiceName: curRow["lineItem/ProductCode"],
        ChargePeriodStart: new Date(curRow["lineItem/UsageStartDate"]),
        ChargePeriodEnd: new Date(curRow["lineItem/UsageEndDate"]),
        BilledCost,
        EffectiveCost,
        Tags
    };
}
