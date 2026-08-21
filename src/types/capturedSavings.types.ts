/**
 * Strict TypeScript types for Captured Savings & Remediation ROI.
 */

export interface CapturedSavingsPoint {
    date: string;
    potentialSavingsUSD: number;
    detectedWasteUSD: number;
    realizedSavingsUSD: number;
}

export interface RemediationAuditItem {
    id: string;
    timestamp: string;
    executedBy: string;
    resourceName: string;
    resourceType: string;
    actionCategory: string;
    monthlySavingsUSD: number;
    status: "SUCCESS" | "FAILED";
    details?: string;
}

export interface CapturedSavingsSummary {
    currentPotentialSavingsUSD: number;
    currentDetectedWasteUSD: number;
    totalHistoricalSnapshots: number;
    changePercentageVsLast: number;
    lastScanDate?: string;
    trend: CapturedSavingsPoint[];
    auditLog: RemediationAuditItem[];
}

export interface CapturedSavingsApiResponse {
    success: boolean;
    data?: CapturedSavingsSummary;
    error?: string;
    // Backward compatibility fields
    history?: Array<{
        date: string;
        totalWasted: number;
        potentialSavings: number;
        realizedSavings?: number;
    }>;
    current?: {
        potentialSavings: number;
        totalWasted: number;
        date: string;
    } | null;
    changePct?: number;
    topResources?: Array<{
        resourceId: string;
        category: string;
        estimatedSavings: number;
    }>;
}
