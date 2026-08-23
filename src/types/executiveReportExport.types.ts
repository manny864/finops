/**
 * executiveReportExport.types.ts — Tipos y contratos para la exportación y despacho
 * de Reportes Ejecutivos FinOps en HTML y PDF A4.
 */

export interface CompiledReportOutput {
    reportId: string;
    tenantId: string;
    htmlFormattedContent: string;
    pdfBlobUrl: string;
    pdfSizeBytes: number;
    generationDateIso: string;
    kpiSnapshot: Record<string, any>;
}

export interface SendReportEmailPayload {
    tenantId: string;
    reportId: string;
    recipientEmails: string[];
    subject?: string;
    introMessage?: string;
    includePdfAttachment?: boolean;
}

export interface EmailKpiItem {
    label: string;
    value: string;
    subtext?: string;
    color?: string;
}
