/**
 * executiveReportHistory.types.ts — Tipos para el Historial de Reportes Ejecutivos FinOps.
 */

export type SaaSPlanTier = 'Professional' | 'Business' | 'Enterprise';

export type ReportScopeType = 'TENANT_ALL' | 'SUBSCRIPTION' | 'RESOURCE_GROUP';

export interface ExecutiveReportHistoryItem {
    id: string;
    tenantId: string;
    reportName: string;
    scopeType: ReportScopeType;
    scopeId?: string;
    scopeDisplayName: string;
    requestedByEmail: string;
    requestedByName: string;
    sentByEmail: boolean;
    pdfBlobName: string;
    jsonSnapshotBlobName: string;
    blobSizeBytes: number;
    formattedSizeMb: string;
    /** null = job anterior a 20260822-011, sin snapshot. Distinto de 0 real. */
    totalMonthlyCostSnapshotUSD: number | null;
    totalMonthlySavingsSnapshotUSD: number | null;
    tierRetentionDays: number;
    daysRemainingBeforeExpiry: number;
    expiresAtIso: string;
    createdAtIso: string;
    formattedCreatedAt: string;
    reportMarkdown?: string;
}

export interface ReportHistorySummaryMetrics {
    totalReportsCount: number;
    tierRetentionDays: number;
    activePlanTier: SaaSPlanTier;
    totalStorageSizeBytes: number;
    formattedTotalStorageMb: string;
    emailDeliveredCount: number;
    reports: ExecutiveReportHistoryItem[];
}

export interface GetDownloadSasPayload {
    reportId: string;
    fileType: 'pdf' | 'json';
}

export interface GetDownloadSasResponse {
    sasDownloadUrl: string;
    fileName: string;
    expiresAt: string;
}
