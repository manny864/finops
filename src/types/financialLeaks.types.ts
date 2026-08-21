export type LeakCategoryType =
    | "UNATTACHED_DISK"
    | "DEALLOCATED_VM"
    | "ORPHAN_IP"
    | "EMPTY_ASP"
    | "UNUSED_LB"
    | "UNUSED_GATEWAY"
    | "OLD_SNAPSHOT"
    | "EMPTY_RG"
    | "UNTAGGED";

export interface FinancialLeakResource {
    id: string;
    name: string;
    resourceType: string;
    armType: string;
    location: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    leakCategory: LeakCategoryType;
    issueDescription: string;
    estimatedMonthlySavingsUSD: number;
    isHygiene: boolean;
    isExempt: boolean;
    exemptionReason?: string | null;
    exemptionComment?: string | null;
    isLocked?: boolean;
    manualDelete?: boolean;
}

export interface LeakCategoryBreakdown {
    categoryName: string;
    categoryKey: LeakCategoryType;
    count: number;
    savingsUSD: number;
    color: string;
}

export interface FinancialLeaksSummary {
    totalMonthlyLeakUSD: number;
    totalAffectedResources: number;
    breakdownByCategory: LeakCategoryBreakdown[];
    resources: FinancialLeakResource[];
}

export interface LeakRemediationAction {
    resourceIds: string[];
    actionType: "DELETE" | "TAG" | "EXEMPT";
    commandPayload?: string;
}

export interface FinancialLeaksApiResponse {
    success: boolean;
    data: FinancialLeaksSummary;
    mock?: boolean;
    tenantId?: string;
    error?: string;
}
