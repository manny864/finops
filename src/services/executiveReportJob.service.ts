/**
 * executiveReportJob.service.ts — Orquestador de Tareas Asíncronas en Segundo Plano
 * para la Compilación y Generación de Reportes Ejecutivos FinOps.
 *
 * Cumple con:
 *   - Ejecución 100% no bloqueante con polling desacoplado.
 *   - Granularidad de pasos: QUEUED -> COLLECTING_METRICS -> AI_SYNTHESIZING -> COMPILING_PDF -> COMPLETED.
 *   - Simulación progresiva fluida para tenants mock/demo.
 *   - Doble sistema de notificación: In-App Notifications (tabla Notifications) y Web Notification API.
 *   - Tolerancia cero a mock fallbacks en tenants vivos.
 */
import pool, { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import {
    aggregateExecutiveReportData,
    generateExecutiveAssessment,
    dispatchExecutiveReportEmail,
} from '@/services/executiveReportGenerator.service';
import { saveExecutiveReportMarkdown } from '@/lib/executiveReportStorage';
import { createNotification } from '@/lib/notify';
import { notifyTenant } from '@/lib/notifications';
import { jsPDF } from 'jspdf';
import type {
    ExecutiveReportJobState,
    JobStatusResponse,
    ReportJobStep,
    StartReportJobPayload,
    StartReportJobResponse,
} from '@/types/executiveReportJob.types';
import type { ExecutiveReportData, ExecutiveReportScope } from '@/types/executiveReport.types';


// Cache en memoria para jobs activos / en progreso
const activeJobsCache = new Map<string, ExecutiveReportJobState>();

// Cache de reportes completados recientes por tenant
const tenantRecentReportsCache = new Map<string, { reportId: string; reportMarkdown: string; data: ExecutiveReportData; completedAt: string }>();

function getStepProgress(step: ReportJobStep): { progress: number; label: string } {
    switch (step) {
        case 'QUEUED':
            return { progress: 5, label: 'En cola de procesamiento...' };
        case 'COLLECTING_METRICS':
            return { progress: 30, label: 'Recolectando telemetría de Azure Resource Graph y Cost Management...' };
        case 'AI_SYNTHESIZING':
            return { progress: 65, label: 'Generando síntesis estratégica C-Level con IA...' };
        case 'COMPILING_PDF':
            return { progress: 88, label: 'Compilando snapshot y preparando documento PDF A4...' };
        case 'COMPLETED':
            return { progress: 100, label: 'Reporte ejecutivo generado con éxito.' };
        case 'FAILED':
            return { progress: 100, label: 'Fallo durante la generación del reporte.' };
        default:
            return { progress: 0, label: 'Iniciando...' };
    }
}

/**
 * Inicia un job asíncrono para generar el reporte ejecutivo.
 */
export async function startExecutiveReportJob(
    payload: StartReportJobPayload
): Promise<StartReportJobResponse> {
    const {
        tenantId,
        scope,
        scopeId = 'All',
        scopeName = 'Tenant completo (todas las suscripciones)',
        locale = 'es',
        triggerAiAnalysis = true,
        sendEmailNotification = false,
        requestedByEmail = 'user@cscloudsolutions.com',
    } = payload;

    const isMock = isMockTenant(tenantId);

    if (isMock) {
        const jobId = `mock-job-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const state: ExecutiveReportJobState = {
            jobId,
            tenantId,
            status: 'QUEUED',
            progressPercent: 5,
            currentStepLabel: 'En cola de procesamiento...',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            scopeSubscriptionId: scopeId,
            scopeSubscriptionName: scopeName,
            requestedByEmail,
        };
        activeJobsCache.set(jobId, state);

        // Disparar procesamiento en segundo plano simulado
        void runMockJobProcess(jobId, tenantId, scopeId, triggerAiAnalysis, sendEmailNotification, requestedByEmail);

        return {
            success: true,
            jobId,
            status: 'QUEUED',
            progressPercent: 5,
            currentStepLabel: 'En cola de procesamiento...',
            message: 'Tarea iniciada en segundo plano.',
        };
    }

    // Tenant Real: Persistencia en MySQL y ejecución en segundo plano
    await initializeDatabase();

    const [insertResult] = await pool.query(
        `INSERT INTO ExecutiveReportJobs (
            tenant_id, requested_by_email, scope_subscription_id, scope_subscription_name, locale, status
        ) VALUES (?, ?, ?, ?, ?, 'queued')`,
        [tenantId, requestedByEmail, scopeId, scopeName, locale]
    );
    const numericJobId = Number((insertResult as { insertId?: number }).insertId || 0);
    const jobId = String(numericJobId);

    const state: ExecutiveReportJobState = {
        jobId,
        tenantId,
        status: 'QUEUED',
        progressPercent: 5,
        currentStepLabel: 'En cola de procesamiento...',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scopeSubscriptionId: scopeId,
        scopeSubscriptionName: scopeName,
        requestedByEmail,
    };
    activeJobsCache.set(jobId, state);

    // Disparar worker no bloqueante
    void runRealJobProcess(jobId, tenantId, scopeId, scopeName, locale, triggerAiAnalysis, sendEmailNotification, requestedByEmail);

    return {
        success: true,
        jobId,
        status: 'QUEUED',
        progressPercent: 5,
        currentStepLabel: 'En cola de procesamiento...',
        message: 'Tarea iniciada en segundo plano.',
    };
}

/**
 * Worker simulado para tenants Mock/Demo con progresión temporal realista.
 */
async function runMockJobProcess(
    jobId: string,
    tenantId: string,
    scopeSubscriptionId: string,
    triggerAi: boolean,
    sendEmail: boolean,
    email: string
) {
    const update = (step: ReportJobStep) => {
        const item = activeJobsCache.get(jobId);
        if (!item) return;
        const { progress, label } = getStepProgress(step);
        item.status = step;
        item.progressPercent = progress;
        item.currentStepLabel = label;
        item.updatedAt = new Date().toISOString();
        activeJobsCache.set(jobId, item);
    };

    try {
        // Paso 1: QUEUED (500ms)
        await new Promise((r) => setTimeout(r, 600));
        update('COLLECTING_METRICS');

        // Paso 2: COLLECTING_METRICS (1000ms)
        await new Promise((r) => setTimeout(r, 1200));
        const scope = (scopeSubscriptionId === 'All' ? 'TENANT_ALL' : 'SUBSCRIPTION') as ExecutiveReportScope;
        const aggregatedData = await aggregateExecutiveReportData(tenantId, scope, scopeSubscriptionId);
        update('AI_SYNTHESIZING');

        // Paso 3: AI_SYNTHESIZING (1200ms)
        await new Promise((r) => setTimeout(r, 1500));
        let markdown = aggregatedData.aiMarkdown || '';
        if (triggerAi) {
            markdown = await generateExecutiveAssessment(aggregatedData);
            aggregatedData.aiMarkdown = markdown;
        }
        update('COMPILING_PDF');

        // Paso 4: COMPILING_PDF (800ms)
        await new Promise((r) => setTimeout(r, 900));

        // Paso 5: COMPLETED
        const item = activeJobsCache.get(jobId);
        if (item) {
            item.status = 'COMPLETED';
            item.progressPercent = 100;
            item.currentStepLabel = 'Reporte ejecutivo generado con éxito.';
            item.reportId = jobId;
            item.reportMarkdown = markdown;
            item.reportData = aggregatedData;
            item.completedAt = new Date().toISOString();
            item.updatedAt = new Date().toISOString();
            activeJobsCache.set(jobId, item);

            tenantRecentReportsCache.set(tenantId, {
                reportId: jobId,
                reportMarkdown: markdown,
                data: aggregatedData,
                completedAt: item.completedAt,
            });
        }
    } catch (err: unknown) {
        const item = activeJobsCache.get(jobId);
        if (item) {
            item.status = 'FAILED';
            item.progressPercent = 100;
            item.currentStepLabel = 'Fallo durante la generación del reporte.';
            item.errorMessage = err instanceof Error ? err.message : 'Error desconocido';
            activeJobsCache.set(jobId, item);
        }
    }
}

/**
 * Worker para Tenants Vivos / Reales en Azure.
 */
async function runRealJobProcess(
    jobId: string,
    tenantId: string,
    scopeSubscriptionId: string,
    scopeSubscriptionName: string,
    locale: string,
    triggerAi: boolean,
    sendEmail: boolean,
    requestedByEmail: string
) {
    const update = async (step: ReportJobStep) => {
        const item = activeJobsCache.get(jobId);
        if (!item) return;
        const { progress, label } = getStepProgress(step);
        item.status = step;
        item.progressPercent = progress;
        item.currentStepLabel = label;
        item.updatedAt = new Date().toISOString();
        activeJobsCache.set(jobId, item);

        try {
            await pool.query(
                `UPDATE ExecutiveReportJobs
                 SET status = ?, started_at = COALESCE(started_at, UTC_TIMESTAMP()), updated_at = UTC_TIMESTAMP()
                 WHERE id = ? AND tenant_id = ?`,
                [step === 'COMPLETED' ? 'completed' : step === 'FAILED' ? 'failed' : 'processing', Number(jobId), tenantId]
            );
        } catch {
            // best-effort
        }
    };

    try {
        await update('COLLECTING_METRICS');
        const scope = (scopeSubscriptionId === 'All' ? 'TENANT_ALL' : 'SUBSCRIPTION') as ExecutiveReportScope;
        const aggregatedData = await aggregateExecutiveReportData(tenantId, scope, scopeSubscriptionId);

        await update('AI_SYNTHESIZING');
        let reportMarkdown = aggregatedData.aiMarkdown || '';
        if (triggerAi) {
            reportMarkdown = await generateExecutiveAssessment(aggregatedData);
            aggregatedData.aiMarkdown = reportMarkdown;
        }

        await update('COMPILING_PDF');
        let storedName: string | null = null;
        try {
            storedName = await saveExecutiveReportMarkdown(reportMarkdown);
        } catch (storageError) {
            console.warn('[runRealJobProcess] Blob storage save failed:', storageError);
        }

        // Finalizar registro en MySQL. Se sella el costo y el ahorro del
        // momento: son un snapshot, no un dato a recalcular al listar.
        // Recalcularlos contra CostSnapshots devolvería el gasto de hoy y no el
        // que este reporte informó.
        const snapshotCost = aggregatedData.kpiMetrics?.mtdSpendUSD ?? null;
        const snapshotSavings = aggregatedData.kpiMetrics?.monthlySavingsIdentifiedUSD ?? null;

        try {
            await pool.query(
                `UPDATE ExecutiveReportJobs
                 SET status = 'completed', report_markdown = ?, report_stored_name = ?,
                     total_cost_usd = ?, total_savings_usd = ?,
                     completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                 WHERE id = ? AND tenant_id = ?`,
                [reportMarkdown, storedName, snapshotCost, snapshotSavings, Number(jobId), tenantId]
            );
        } catch (err: any) {
            // 20260822-011 puede no haber corrido en esta réplica. El reporte ya
            // está generado: no se pierde por no poder guardar dos métricas.
            if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
            console.warn('[executiveReportJob] 20260822-011 pendiente; se completa sin snapshot de costo/ahorro.');
            await pool.query(
                `UPDATE ExecutiveReportJobs
                 SET status = 'completed', report_markdown = ?, report_stored_name = ?, completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                 WHERE id = ? AND tenant_id = ?`,
                [reportMarkdown, storedName, Number(jobId), tenantId]
            );
        }

        // Despacho de In-App Notifications
        const reportHref = `/${locale}/admin/reports?tab=executive&reportJob=${jobId}`;
        const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
        const reportAbsoluteHref = appBaseUrl ? `${appBaseUrl}${reportHref}` : reportHref;

        await createNotification({
            tenantId,
            title: 'Reporte Ejecutivo FinOps Compilado',
            message: `El análisis estratégico con IA y el documento PDF A4 del tenant se generaron correctamente.`,
            href: reportHref,
            severity: 'info',
            source: 'executive-report',
        });

        await notifyTenant(tenantId, {
            title: 'Reporte Ejecutivo FinOps Compilado',
            message: `El reporte para ${scopeSubscriptionName} ya está disponible.`,
            severity: 'info',
            link: reportAbsoluteHref,
        });

        // Enviar por correo si fue solicitado
        if (sendEmail && requestedByEmail) {
            try {
                const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                doc.setFont('helvetica', 'bold');
                doc.text('CSCloudSolutions - Reporte Ejecutivo FinOps', 20, 20);
                const pdfBufferBase64 = Buffer.from(doc.output('arraybuffer')).toString('base64');

                await dispatchExecutiveReportEmail({
                    tenantName: scopeSubscriptionName,
                    recipientEmail: requestedByEmail,
                    reportMarkdown,
                    pdfBufferBase64,
                    fileBaseName: `Reporte_FinOps_${tenantId}_${jobId}`,
                });
                await pool.query(
                    `UPDATE ExecutiveReportJobs
                     SET emailed_to_requester_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                     WHERE id = ? AND tenant_id = ?`,
                    [Number(jobId), tenantId]
                );
            } catch (mailErr) {
                console.error('[runRealJobProcess] Email dispatch error:', mailErr);
            }
        }


        // Actualizar cache en memoria
        const item = activeJobsCache.get(jobId);
        if (item) {
            item.status = 'COMPLETED';
            item.progressPercent = 100;
            item.currentStepLabel = 'Reporte ejecutivo generado con éxito.';
            item.reportId = jobId;
            item.reportMarkdown = reportMarkdown;
            item.reportData = aggregatedData;
            item.completedAt = new Date().toISOString();
            item.updatedAt = new Date().toISOString();
            activeJobsCache.set(jobId, item);

            tenantRecentReportsCache.set(tenantId, {
                reportId: jobId,
                reportMarkdown,
                data: aggregatedData,
                completedAt: item.completedAt,
            });
        }
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Error desconocido al compilar reporte';
        console.error('[runRealJobProcess] Job failed:', err);

        try {
            await pool.query(
                `UPDATE ExecutiveReportJobs
                 SET status = 'failed', error_message = ?, completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                 WHERE id = ? AND tenant_id = ?`,
                [errorMsg.slice(0, 2000), Number(jobId), tenantId]
            );
        } catch {
            // best-effort
        }

        const item = activeJobsCache.get(jobId);
        if (item) {
            item.status = 'FAILED';
            item.progressPercent = 100;
            item.currentStepLabel = 'Fallo durante la generación del reporte.';
            item.errorMessage = errorMsg;
            activeJobsCache.set(jobId, item);
        }
    }
}

/**
 * Consulta el estado actual de un job asíncrono.
 */
export async function getExecutiveReportJobStatus(
    jobId: string,
    tenantId: string
): Promise<JobStatusResponse> {
    const isMock = isMockTenant(tenantId);

    // 1. Primero chequear memoria viva
    const cached = activeJobsCache.get(jobId);
    if (cached) {
        return {
            success: true,
            jobId: cached.jobId,
            status: cached.status,
            progressPercent: cached.progressPercent,
            currentStepLabel: cached.currentStepLabel,
            reportId: cached.reportId,
            isCompleted: cached.status === 'COMPLETED',
            isFailed: cached.status === 'FAILED',
            error: cached.errorMessage,
            reportMarkdown: cached.reportMarkdown,
            reportData: cached.reportData,
            createdAt: cached.createdAt,
            completedAt: cached.completedAt,
            scopeSubscriptionId: cached.scopeSubscriptionId,
            scopeSubscriptionName: cached.scopeSubscriptionName,
        };
    }

    if (isMock) {
        return {
            success: true,
            jobId,
            status: 'COMPLETED',
            progressPercent: 100,
            currentStepLabel: 'Reporte ejecutivo generado con éxito.',
            reportId: jobId,
            isCompleted: true,
            isFailed: false,
        };
    }

    // 2. Si no está en cache, consultar base de datos
    await initializeDatabase();
    const [rows] = await pool.query(
        `SELECT id, status, report_markdown, error_message, scope_subscription_id, scope_subscription_name, created_at, completed_at
         FROM ExecutiveReportJobs
         WHERE id = ? AND tenant_id = ?
         LIMIT 1`,
        [Number(jobId), tenantId]
    );

    const row = (rows as any[])[0];
    if (!row) {
        return {
            success: false,
            jobId,
            status: 'FAILED',
            progressPercent: 100,
            currentStepLabel: 'Job no encontrado.',
            isCompleted: false,
            isFailed: true,
            error: 'Trabajo no encontrado.',
        };
    }

    const isCompleted = row.status === 'completed';
    const isFailed = row.status === 'failed';
    const step: ReportJobStep = isCompleted ? 'COMPLETED' : isFailed ? 'FAILED' : 'AI_SYNTHESIZING';
    const { progress, label } = getStepProgress(step);

    return {
        success: true,
        jobId: String(row.id),
        status: step,
        progressPercent: progress,
        currentStepLabel: isFailed ? (row.error_message || label) : label,
        reportId: isCompleted ? String(row.id) : undefined,
        isCompleted,
        isFailed,
        error: row.error_message || undefined,
        reportMarkdown: row.report_markdown || undefined,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        scopeSubscriptionId: row.scope_subscription_id,
        scopeSubscriptionName: row.scope_subscription_name,
    };
}

/**
 * Obtiene el job activo más reciente para un tenant (para reanudar seguimiento).
 */
export async function getActiveExecutiveReportJob(
    tenantId: string
): Promise<ExecutiveReportJobState | null> {
    // Buscar en memoria activa
    for (const job of activeJobsCache.values()) {
        if (job.tenantId === tenantId && job.status !== 'COMPLETED' && job.status !== 'FAILED') {
            return job;
        }
    }

    if (isMockTenant(tenantId)) {
        return null;
    }

    await initializeDatabase();
    const [rows] = await pool.query(
        `SELECT id, status, scope_subscription_id, scope_subscription_name, created_at, updated_at
         FROM ExecutiveReportJobs
         WHERE tenant_id = ? AND status IN ('queued', 'processing')
         ORDER BY id DESC
         LIMIT 1`,
        [tenantId]
    );

    const row = (rows as any[])[0];
    if (!row) return null;

    const step: ReportJobStep = row.status === 'queued' ? 'QUEUED' : 'COLLECTING_METRICS';
    const { progress, label } = getStepProgress(step);

    return {
        jobId: String(row.id),
        tenantId,
        status: step,
        progressPercent: progress,
        currentStepLabel: label,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        scopeSubscriptionId: row.scope_subscription_id,
        scopeSubscriptionName: row.scope_subscription_name,
    };
}

/**
 * Obtiene el reporte completado más reciente (para Idle / Landing State sin llamadas innecesarias).
 */
export async function getLatestCompletedReport(tenantId: string) {
    if (tenantRecentReportsCache.has(tenantId)) {
        return tenantRecentReportsCache.get(tenantId)!;
    }

    if (isMockTenant(tenantId)) {
        const aggregated = await aggregateExecutiveReportData(tenantId, 'TENANT_ALL', 'All');
        return {
            reportId: 'mock-report-cached',
            reportMarkdown: aggregated.aiMarkdown || '',
            data: aggregated,
            completedAt: new Date(Date.now() - 3600000).toISOString(),
        };
    }

    await initializeDatabase();
    const [rows] = await pool.query(
        `SELECT id, report_markdown, scope_subscription_id, scope_subscription_name, completed_at
         FROM ExecutiveReportJobs
         WHERE tenant_id = ? AND status = 'completed' AND report_markdown IS NOT NULL
         ORDER BY id DESC
         LIMIT 1`,
        [tenantId]
    );

    const row = (rows as any[])[0];
    if (!row) return null;

    const data = await aggregateExecutiveReportData(tenantId, 'SUBSCRIPTION', row.scope_subscription_id || 'All');
    data.aiMarkdown = row.report_markdown;

    return {
        reportId: String(row.id),
        reportMarkdown: row.report_markdown,
        data,
        completedAt: row.completed_at,
    };
}

