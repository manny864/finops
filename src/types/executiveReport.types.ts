/**
 * Contratos de datos para el Motor de Reportes Ejecutivos FinOps.
 */

export type ExecutiveReportScope = 'TENANT_ALL' | 'SUBSCRIPTION' | 'RESOURCE_GROUP';

export interface HistoricalMonthCost {
    /**
     * "YYYY-MM". El rotulo del mes se arma en el cliente: antes venia listo
     * desde el servicio con `toLocaleDateString('es-ES')` fijo, asi que el
     * reporte mostraba los meses en castellano en los tres idiomas.
     */
    monthKey: string;
    costUSD: number;
    comparisonVsPreviousMonthPercent?: number | null;
    trend: 'BULLISH' | 'BEARISH' | 'STABLE';
}

export interface InefficiencyCategoryBreakdown {
    categoryName: string;
    affectedResourcesCount: number;
    monthlyWasteUSD: number;
    percentageOfTotalWaste: number;
}

export interface ExecutiveAiAnalysisSections {
    situationSummary: string;
    costDeviationDiagnosis: string;
    operationalRiskEvaluation: string;
    tacticalActionPlanMarkdown: string;
    totalEstimatedRoiUSD: number;
}

/**
 * Gasto de una familia de recursos en el periodo del reporte.
 *
 * `null` y `[]` son respuestas legitimas: significan "este tenant no tiene
 * datos de esta familia", que NO es lo mismo que cero. El prompt distingue los
 * dos casos y declara "Dato no disponible" cuando corresponde.
 */
export interface ResourceFamilySpend {
    category: string;
    monthlyCostUSD: number;
    percentageOfTotal: number;
    momVariationPercent: number;
    projectedMonthEndUSD: number;
    topServices: Array<{ name: string; costUSD: number; resourceCount: number }>;
}

/**
 * Barrido por familias de recursos. Cada campo es `null` cuando el colector no
 * pudo resolverse (fallo de la fuente) o el tenant no tiene gasto en esa
 * familia — nunca un numero inventado.
 */
export interface ResourceFamilyBreakdown {
    compute: ResourceFamilySpend | null;
    databases: ResourceFamilySpend | null;
    aiAndMachineLearning: ResourceFamilySpend | null;
    networking: ResourceFamilySpend | null;
    storage: ResourceFamilySpend | null;
    /** Las familias restantes, sin desglosar una por una. */
    others: ResourceFamilySpend[];
}

/**
 * Que colectores respondieron y cuales no.
 *
 * El reporte lo necesita para no confundir "cero desperdicio" con "no pude
 * leer el desperdicio": al LLM se le pasa esta lista para que declare el dato
 * como no disponible en vez de afirmar que el tenant esta optimizado.
 */
export interface TelemetryCollectorStatus {
    collector: string;
    ok: boolean;
    error?: string;
}

export interface ExecutiveReportFullData {
    reportId: string;
    generatedAtIso: string;
    tenantId: string;
    organizationName: string;
    scope: ExecutiveReportScope;
    scopeDisplayName: string;
    kpiMetrics: {
        mtdSpendUSD: number;
        momVariationPercent: number;
        projectedMonthEndUSD: number;
        monthlySavingsIdentifiedUSD: number;
        annualizedSavingsUSD: number;
        criticalHighHaRisksCount: number;
        co2ImpactKg: number;
        taggingCoveragePercent: number;
        commitmentsCoveragePercent: number;
        rightsizingCandidatesCount: number;
        rightsizingSavingsUSD: number;
        activeAnomaliesCount: number;
        budgetBurnPercent: number;
    };
    historicalTrends: HistoricalMonthCost[];
    aiAnalysis?: ExecutiveAiAnalysisSections;
    aiMarkdown?: string;
    inefficiencyDistribution: InefficiencyCategoryBreakdown[];
    haRisks: Array<{
        resourceName: string;
        resourceType: string;
        severity: string;
        issueType: string;
        estimatedRisk: string;
    }>;
    anomalies: Array<{
        date: string;
        resource: string;
        impactUSD: number;
        severity: string;
    }>;
    rightsizingRecommendations: Array<{
        resourceName: string;
        currentSku: string;
        recommendedSku: string;
        monthlySavingsUSD: number;
    }>;
    budgetsExecution: Array<{
        name: string;
        amountUSD: number;
        currentSpendUSD: number;
        burnPercent: number;
        isExceeded: boolean;
    }>;
    resourceFamilies: ResourceFamilyBreakdown;
    collectorStatus: TelemetryCollectorStatus[];
}

export type ExecutiveReportData = ExecutiveReportFullData;



export interface GenerateReportPayload {
    tenantId: string;
    scope: ExecutiveReportScope;
    scopeId?: string;
    triggerAiAnalysis: boolean;
    sendEmailNotification?: boolean;
}

export interface ExportPdfPayload {
    reportId: string;
    paperSize: 'A4';
    orientation: 'portrait';
}
