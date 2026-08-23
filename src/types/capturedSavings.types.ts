/**
 * Strict TypeScript types for Captured Savings & Remediation ROI.
 */

export interface CapturedSavingsPoint {
    date: string;
    potentialSavingsUSD: number;
    detectedWasteUSD: number;
    realizedSavingsUSD: number;
}

/**
 * Origen del evento de ahorro:
 *  - `platform`: ejecutado desde esta plataforma (tabla ActionLogs).
 *  - `azure`: detectado en Azure — el recurso dejó de facturar sin que la acción
 *    pasara por la plataforma (portal, CLI, IaC, otro equipo).
 */
export type RemediationOrigin = "platform" | "azure";

export interface RemediationAuditItem {
    id: string;
    timestamp: string;
    executedBy: string;
    resourceName: string;
    resourceGroup?: string;
    resourceType: string;
    actionCategory: string;
    monthlySavingsUSD: number;
    status: "SUCCESS" | "FAILED";
    details?: string;
    origin?: RemediationOrigin;
    /** true si el ahorro se midió contra costo real y no se estimó. */
    savingsMeasured?: boolean;
}

export interface CapturedSavingsSummary {
    currentPotentialSavingsUSD: number;
    currentDetectedWasteUSD: number;
    /** Ahorro efectivamente capturado en el mes en curso (eventos verificados). */
    currentRealizedSavingsUSD?: number;
    totalHistoricalSnapshots: number;
    changePercentageVsLast: number;
    lastScanDate?: string;
    /**
     * true cuando el último snapshot del histórico vino sin datos y los KPI se
     * resolvieron con el último escaneo con datos (la fecha es la de ese punto).
     */
    latestScanEmpty?: boolean;
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
