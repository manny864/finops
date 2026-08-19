/**
 * licenseOptimization.types.ts
 * Strict TypeScript types for the "Optimización de Licencias" sub-tab.
 *
 * Covers: AHUB resource items, SKU optimization items, remediation actions,
 * and the full API response shape.
 */

// ─── AHUB Resource ──────────────────────────────────────────────────────────

export type AhubResourceType = "Virtual Machine" | "SQL Database" | "SQL Elastic Pool" | "SQL Managed Instance";

export interface AhubResourceItem {
    id: string;
    name: string;
    resourceType: AhubResourceType;
    subscriptionId: string;
    subscriptionName: string;
    resourceGroup: string;
    location: string;
    vCoresCount: number;
    currentLicenseType: string;
    estimatedMonthlySavingsUSD: number;
    remediationCommand: {
        cli: string;
        powershell: string;
        impactSummary: string;
    };
}

// ─── SKU Optimization ───────────────────────────────────────────────────────

export type SkuCategory = "M365" | "Security" | "Productivity" | "Analytics" | "System";

export interface SkuInactiveUser {
    userId: string;
    userPrincipalName: string;
    displayName: string;
    daysInactive: number;
}

export interface SkuOptimizationItem {
    skuId: string;
    skuPartNumber: string;
    commercialDisplayName: string;
    category: SkuCategory;
    unitPriceUSD: number;
    totalPurchased: number;
    totalConsumed: number;
    unassignedCount: number;
    inactiveAssignedCount: number;
    wastedMonthlySpendUSD: number;
    inactiveUsers: SkuInactiveUser[];
    isSystemSku: boolean;
}

// ─── Summary KPIs ───────────────────────────────────────────────────────────

export interface LicenseOptimizationSummary {
    totalPaidLicenses: number;
    totalAssigned: number;
    totalUnassigned: number;
    totalInactiveLicenses: number;
    totalAhubSavingsUSD: number;
    totalM365WastedUSD: number;
    ahubResourceCount: number;
    skuCount: number;
}

// ─── Remediation ────────────────────────────────────────────────────────────

export type RemediationTargetType = "AHUB_RESOURCE" | "M365_SKU_USER";

export interface LicenseRemediationAction {
    id: string;
    targetType: RemediationTargetType;
    resourceId?: string;
    skuPartNumber?: string;
    userId?: string;
    potentialSavingsUSD: number;
    actionType: string;
    commandPayload: {
        cli: string;
        powershell: string;
        impactSummary: string;
    };
}

// ─── API Response ───────────────────────────────────────────────────────────

export interface LicenseOptimizationResponse {
    success: boolean;
    mock: boolean;
    summary: LicenseOptimizationSummary;
    ahubResources: AhubResourceItem[];
    skuOptimizations: SkuOptimizationItem[];
    graphError?: string | null;
    needsConsent?: boolean;
}

// ─── SKU Category mapping ───────────────────────────────────────────────────

export function classifySkuCategory(skuPartNumber: string): SkuCategory {
    const upper = skuPartNumber.toUpperCase();
    if (upper.includes("DEFENDER") || upper.includes("ATP") || upper.includes("EMS") || upper.includes("AAD_PREMIUM") || upper.includes("INTUNE")) return "Security";
    if (upper.includes("POWER_BI") || upper.includes("POWERAPPS") || upper.includes("FLOW") || upper.includes("POWERAUTOMATE")) return "Analytics";
    if (upper.includes("PROJECT") || upper.includes("VISIO") || upper.includes("EXCHANGE") || upper.includes("SHAREPOINT") || upper.includes("TEAMS") || upper.includes("MCO")) return "Productivity";
    if (upper.includes("WINDOWS_STORE") || upper.includes("STREAM") || upper.includes("AAD_BASIC") || upper.includes("MEE_")) return "System";
    return "M365";
}