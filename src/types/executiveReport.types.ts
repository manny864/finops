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
