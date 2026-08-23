/**
 * executiveReportJob.types.ts — Tipos y contratos para el procesamiento asíncrono
 * de Reportes Ejecutivos FinOps en segundo plano.
 */
import type { ExecutiveReportData } from '@/types/executiveReport.types';

export type ReportJobStep =
    | 'QUEUED'
    | 'COLLECTING_METRICS'
    | 'AI_SYNTHESIZING'
    | 'COMPILING_PDF'
    | 'COMPLETED'
    | 'FAILED';

export interface ExecutiveReportJobState {
    jobId: string;
    tenantId: string;
    status: ReportJobStep;
    progressPercent: number;
    currentStepLabel: string;
    reportId?: string;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    completedAt?: string;
    reportMarkdown?: string;
    reportData?: ExecutiveReportData;
    scopeSubscriptionId?: string;
    scopeSubscriptionName?: string;
    requestedByEmail?: string;
    emailedToRequesterAt?: string;
}

export interface StartReportJobPayload {
    tenantId: string;
    scope: 'TENANT_ALL' | 'SUBSCRIPTION' | 'RESOURCE_GROUP';
    scopeId?: string;
    scopeName?: string;
    locale?: string;
    triggerAiAnalysis?: boolean;
    sendEmailNotification?: boolean;
    requestedByEmail?: string;
}

export interface StartReportJobResponse {
    success: boolean;
    jobId: string;
    status: ReportJobStep;
    message: string;
    progressPercent: number;
    currentStepLabel: string;
}

export interface JobStatusResponse {
    success: boolean;
    jobId: string;
    status: ReportJobStep;
    progressPercent: number;
    currentStepLabel: string;
    reportId?: string;
    isCompleted: boolean;
    isFailed: boolean;
    error?: string;
    reportMarkdown?: string;
    reportData?: ExecutiveReportData;
    createdAt?: string;
    completedAt?: string;
    scopeSubscriptionId?: string;
    scopeSubscriptionName?: string;
}
