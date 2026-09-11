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

/**
 * Paso -> clave de catalogo (namespace AdminReport).
 *
 * El badge de la UI pintaba el enum crudo ("Paso: AI_SYNTHESIZING") y el
 * renglon de abajo la prosa que arma el servidor, en castellano. El
 * discriminador ya viaja, asi que la pantalla resuelve las dos cosas desde
 * aca; `currentStepLabel` queda de fallback para FAILED, donde el servidor
 * manda el error real y no un rotulo de paso.
 */
export const JOB_STEP_KEYS: Record<ReportJobStep, { badge: string; label: string }> = {
    QUEUED: { badge: 'step_QUEUED', label: 'jobQueued' },
    COLLECTING_METRICS: { badge: 'step_COLLECTING_METRICS', label: 'jobCollecting' },
    AI_SYNTHESIZING: { badge: 'step_AI_SYNTHESIZING', label: 'jobSynthesizing' },
    COMPILING_PDF: { badge: 'step_COMPILING_PDF', label: 'jobCompiling' },
    COMPLETED: { badge: 'step_COMPLETED', label: 'jobDone' },
    FAILED: { badge: 'step_FAILED', label: 'jobFailed' },
};


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
