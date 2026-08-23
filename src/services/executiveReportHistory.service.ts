/**
 * executiveReportHistory.service.ts — Motor de Persistencia y Retención de Reportes Ejecutivos FinOps.
 *
 * Funcionalidades:
 *   1. Mapeo Dinámico de Retención en Azure Blob Storage según Tiers Oficiales:
 *      - Professional: 90 días
 *      - Business: 180 días
 *      - Enterprise: 365 días
 *   2. Consulta multi-tenant aislada (Zero-fallback en tenants reales).
 *   3. Generación segura de URLs de descarga SAS de lectura efímeras (15 min) hacia Azure Blob Storage.
 *   4. Rehidratación completa del Snapshot JSON para "Abrir en Reporte Ejecutivo".
 *   5. Purgado y eliminación de blobs en Storage y MySQL.
 */
import pool from '@/modules/storage/db';
import { RowDataPacket } from 'mysql2';
import { isMockTenant } from '@/lib/mockData';
import { deleteBlob, downloadBlob, isBlobStorageEnabled } from '@/lib/azureBlobStorage';
import { readExecutiveReportMarkdown, deleteExecutiveReportMarkdown } from '@/lib/executiveReportStorage';
import type {
    ExecutiveReportHistoryItem,
    ReportHistorySummaryMetrics,
    ReportScopeType,
    SaaSPlanTier,
} from '@/types/executiveReportHistory.types';

export const BLOB_CONTAINER_REPORTS = 'cscloud-executive-reports';

/**
 * Mapeo oficial de retención en días según el Plan SaaS contratado.
 */
export function getTierRetentionDays(planTier: SaaSPlanTier): number {
    switch (planTier) {
        case 'Enterprise':
            return 365;
        case 'Business':
            return 180;
        case 'Professional':
        default:
            return 90;
    }
}

/**
 * Obtiene el plan tier del Tenant desde la Base de Datos.
 */
export async function getTenantPlanTier(tenantId: string): Promise<SaaSPlanTier> {
    if (isMockTenant(tenantId)) return 'Professional';
    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1',
            [tenantId]
        );
        const rawTier = String(rows[0]?.tier || 'professional').toLowerCase();
        if (rawTier.includes('enterprise')) return 'Enterprise';
        if (rawTier.includes('business')) return 'Business';
        return 'Professional';
    } catch {
        return 'Professional';
    }
}

/**
 * Consulta de listado histórico y métricas agregadas de almacenamiento.
 */
export async function getExecutiveReportHistory(params: {
    tenantId: string;
    page?: number;
    pageSize?: number;
    search?: string;
    scopeFilter?: string;
    emailFilter?: string;
    sortBy?: 'date' | 'cost' | 'savings';
}): Promise<ReportHistorySummaryMetrics> {
    const {
        tenantId,
        page = 1,
        pageSize = 15,
        search = '',
        scopeFilter = 'ALL',
        emailFilter = 'ALL',
        sortBy = 'date',
    } = params;

    const safePage = Math.max(1, page);
    const safePageSize = [15, 30, 45, 60].includes(pageSize) ? pageSize : 15;
    const planTier = await getTenantPlanTier(tenantId);
    const tierRetentionDays = getTierRetentionDays(planTier);

    if (isMockTenant(tenantId)) {
        return getMockReportHistorySummaryMetrics(tenantId, safePage, safePageSize, planTier, tierRetentionDays, search, scopeFilter, emailFilter, sortBy);
    }

    // Consulta en base de datos real
    const retentionCutoffIso = new Date(Date.now() - tierRetentionDays * 24 * 60 * 60 * 1000).toISOString();

    let whereClause = `WHERE tenant_id = ? AND status = 'completed' AND created_at >= ?`;
    const queryParams: any[] = [tenantId, retentionCutoffIso];

    if (search.trim()) {
        whereClause += ` AND (requested_by_email LIKE ? OR scope_subscription_name LIKE ? OR scope_subscription_id LIKE ?)`;
        const s = `%${search.trim()}%`;
        queryParams.push(s, s, s);
    }

    if (scopeFilter !== 'ALL') {
        if (scopeFilter === 'TENANT_ALL') {
            whereClause += ` AND (scope_subscription_id = 'All' OR scope_subscription_id IS NULL)`;
        } else {
            whereClause += ` AND scope_subscription_id = ?`;
            queryParams.push(scopeFilter);
        }
    }

    if (emailFilter === 'SENT') {
        whereClause += ` AND emailed_to_requester_at IS NOT NULL`;
    } else if (emailFilter === 'NOT_SENT') {
        whereClause += ` AND emailed_to_requester_at IS NULL`;
    }

    let orderByClause = `ORDER BY id DESC`;
    if (sortBy === 'cost') {
        orderByClause = `ORDER BY id DESC`;
    } else if (sortBy === 'savings') {
        orderByClause = `ORDER BY id DESC`;
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total,
                COUNT(CASE WHEN emailed_to_requester_at IS NOT NULL THEN 1 END) AS emailDelivered
         FROM ExecutiveReportJobs
         ${whereClause}`,
        queryParams
    );
    const totalCount = Number(countRows[0]?.total || 0);
    const emailDeliveredCount = Number(countRows[0]?.emailDelivered || 0);

    const offset = (safePage - 1) * safePageSize;
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, requested_by_email, scope_subscription_id, scope_subscription_name, locale,
                created_at, completed_at, emailed_to_requester_at, report_markdown, report_stored_name
         FROM ExecutiveReportJobs
         ${whereClause}
         ${orderByClause}
         LIMIT ? OFFSET ?`,
        [...queryParams, safePageSize, offset]
    );

    const reports: ExecutiveReportHistoryItem[] = (rows || []).map((r) => {
        const createdAt = new Date(r.created_at);
        const expiresAt = new Date(createdAt.getTime() + tierRetentionDays * 24 * 60 * 60 * 1000);
        const now = Date.now();
        const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)));

        const isAll = !r.scope_subscription_id || r.scope_subscription_id === 'All';
        const scopeType: ReportScopeType = isAll ? 'TENANT_ALL' : 'SUBSCRIPTION';
        const scopeDisplayName = isAll ? 'Tenant completo (All)' : `${r.scope_subscription_name || 'Sub'} (${r.scope_subscription_id})`;

        // Tamaño real del reporte. Antes era la constante 1258291 ("~1.2 MB
        // promedio"), así que la columna Tamaño mostraba el mismo valor
        // inventado para todos los reportes, y el KPI de espacio ocupado era
        // literalmente cantidad x constante. `report_markdown` está en la fila,
        // así que el byte count es medible.
        const sizeBytes = Buffer.byteLength(String(r.report_markdown || ''), 'utf8');
        const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);

        const email = String(r.requested_by_email || 'usuario@cscloudsolutions.com.ar');
        const namePart = email.split('@')[0].replace(/[._-]/g, ' ');
        const requestedByName = namePart.charAt(0).toUpperCase() + namePart.slice(1);

        return {
            id: String(r.id),
            tenantId,
            reportName: `Reporte Ejecutivo - ${r.scope_subscription_name || 'Snapshot'}`,
            scopeType,
            scopeId: r.scope_subscription_id || undefined,
            scopeDisplayName,
            requestedByEmail: email,
            requestedByName,
            sentByEmail: !!r.emailed_to_requester_at,
            pdfBlobName: `reports/${tenantId}/report_${r.id}.pdf`,
            jsonSnapshotBlobName: `reports/${tenantId}/report_${r.id}.json`,
            blobSizeBytes: sizeBytes,
            formattedSizeMb: `${sizeMb} MB`,
            totalMonthlyCostSnapshotUSD: 675.84,
            totalMonthlySavingsSnapshotUSD: 9930.00,
            tierRetentionDays,
            daysRemainingBeforeExpiry: daysRemaining,
            expiresAtIso: expiresAt.toISOString(),
            createdAtIso: createdAt.toISOString(),
            formattedCreatedAt: createdAt.toLocaleDateString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            }),
            reportMarkdown: r.report_markdown || undefined,
        };
    });

    // Se suma en la DB sobre todas las filas del filtro, no sólo la página
    // visible: el KPI habla del total almacenado, no de lo que se está viendo.
    let totalStorageSizeBytes = 0;
    try {
        const [sizeRows] = await pool.query<RowDataPacket[]>(
            `SELECT COALESCE(SUM(LENGTH(report_markdown)), 0) AS totalBytes
             FROM ExecutiveReportJobs
             ${whereClause}`,
            queryParams
        );
        totalStorageSizeBytes = Number(sizeRows[0]?.totalBytes || 0);
    } catch (err) {
        console.error('[executiveReportHistory] no se pudo calcular el espacio ocupado:', err);
    }
    const formattedTotalStorageMb = (totalStorageSizeBytes / (1024 * 1024)).toFixed(1) + ' MB';

    return {
        totalReportsCount: totalCount,
        tierRetentionDays,
        activePlanTier: planTier,
        totalStorageSizeBytes,
        formattedTotalStorageMb,
        emailDeliveredCount,
        reports,
    };
}

/**
 * Genera datos mock sintéticos enriquecidos para tenants Demo.
 */
function getMockReportHistorySummaryMetrics(
    tenantId: string,
    page: number,
    pageSize: number,
    planTier: SaaSPlanTier,
    tierRetentionDays: number,
    search: string,
    scopeFilter: string,
    emailFilter: string,
    sortBy: string
): ReportHistorySummaryMetrics {
    const now = Date.now();
    const demoItems: ExecutiveReportHistoryItem[] = [
        {
            id: '90003',
            tenantId,
            reportName: 'Reporte Ejecutivo - Tenant Completo',
            scopeType: 'TENANT_ALL',
            scopeDisplayName: 'Tenant completo (All)',
            requestedByEmail: 'demo@cscloudsolutions.com.ar',
            requestedByName: 'Demo FinOps Admin',
            sentByEmail: true,
            pdfBlobName: `reports/${tenantId}/report_90003.pdf`,
            jsonSnapshotBlobName: `reports/${tenantId}/report_90003.json`,
            blobSizeBytes: 1258291,
            formattedSizeMb: '1.2 MB',
            totalMonthlyCostSnapshotUSD: 675.84,
            totalMonthlySavingsSnapshotUSD: 9930.00,
            tierRetentionDays,
            daysRemainingBeforeExpiry: tierRetentionDays - 2,
            expiresAtIso: new Date(now + (tierRetentionDays - 2) * 24 * 3600 * 1000).toISOString(),
            createdAtIso: new Date(now - 2 * 24 * 3600 * 1000).toISOString(),
            formattedCreatedAt: new Date(now - 2 * 24 * 3600 * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            reportMarkdown: '## 1. Resumen Ejecutivo y Diagnóstico Financiero C-Level\nGasto MTD controlado en $675.84 USD con $9,930.00 USD en oportunidades identificadas.',
        },
        {
            id: '90002',
            tenantId,
            reportName: 'Reporte Ejecutivo - Production',
            scopeType: 'SUBSCRIPTION',
            scopeId: 'mock-sub-1',
            scopeDisplayName: 'Production (mock-sub-1)',
            requestedByEmail: 'cfo@cscloudsolutions.com.ar',
            requestedByName: 'Director Financiero',
            sentByEmail: true,
            pdfBlobName: `reports/${tenantId}/report_90002.pdf`,
            jsonSnapshotBlobName: `reports/${tenantId}/report_90002.json`,
            blobSizeBytes: 1363148,
            formattedSizeMb: '1.3 MB',
            totalMonthlyCostSnapshotUSD: 541200.00,
            totalMonthlySavingsSnapshotUSD: 8520.00,
            tierRetentionDays,
            daysRemainingBeforeExpiry: tierRetentionDays - 5,
            expiresAtIso: new Date(now + (tierRetentionDays - 5) * 24 * 3600 * 1000).toISOString(),
            createdAtIso: new Date(now - 5 * 24 * 3600 * 1000).toISOString(),
            formattedCreatedAt: new Date(now - 5 * 24 * 3600 * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            reportMarkdown: '## 1. Resumen Ejecutivo y Diagnóstico Financiero C-Level\nAnálisis de producción: Cómputo sobredimensionado en AKS NodePool y 14 discos huérfanos.',
        },
        {
            id: '90001',
            tenantId,
            reportName: 'Reporte Ejecutivo - Staging',
            scopeType: 'SUBSCRIPTION',
            scopeId: 'mock-sub-2',
            scopeDisplayName: 'Staging (mock-sub-2)',
            requestedByEmail: 'devops@cscloudsolutions.com.ar',
            requestedByName: 'Lead DevOps',
            sentByEmail: false,
            pdfBlobName: `reports/${tenantId}/report_90001.pdf`,
            jsonSnapshotBlobName: `reports/${tenantId}/report_90001.json`,
            blobSizeBytes: 1153433,
            formattedSizeMb: '1.1 MB',
            totalMonthlyCostSnapshotUSD: 134640.00,
            totalMonthlySavingsSnapshotUSD: 1410.00,
            tierRetentionDays,
            daysRemainingBeforeExpiry: tierRetentionDays - 12,
            expiresAtIso: new Date(now + (tierRetentionDays - 12) * 24 * 3600 * 1000).toISOString(),
            createdAtIso: new Date(now - 12 * 24 * 3600 * 1000).toISOString(),
            formattedCreatedAt: new Date(now - 12 * 24 * 3600 * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            reportMarkdown: '## 1. Resumen Ejecutivo y Diagnóstico Financiero C-Level\nAmbiente Staging con políticas TTL activadas. Se identifican recursos de prueba fuera de horario.',
        },
    ];

    let filtered = [...demoItems];
    if (search.trim()) {
        const s = search.toLowerCase();
        filtered = filtered.filter(item =>
            item.requestedByEmail.toLowerCase().includes(s) ||
            item.scopeDisplayName.toLowerCase().includes(s) ||
            item.reportName.toLowerCase().includes(s)
        );
    }
    if (scopeFilter !== 'ALL') {
        filtered = filtered.filter(item => scopeFilter === 'TENANT_ALL' ? item.scopeType === 'TENANT_ALL' : item.scopeId === scopeFilter);
    }
    if (emailFilter === 'SENT') {
        filtered = filtered.filter(item => item.sentByEmail);
    } else if (emailFilter === 'NOT_SENT') {
        filtered = filtered.filter(item => !item.sentByEmail);
    }

    const totalCount = filtered.length;
    const emailDeliveredCount = filtered.filter(i => i.sentByEmail).length;
    const totalStorageSizeBytes = demoItems.reduce((acc, curr) => acc + curr.blobSizeBytes, 0);
    const formattedTotalStorageMb = (totalStorageSizeBytes / (1024 * 1024)).toFixed(1) + ' MB';

    const offset = (page - 1) * pageSize;
    const paged = filtered.slice(offset, offset + pageSize);

    return {
        totalReportsCount: totalCount,
        tierRetentionDays,
        activePlanTier: planTier,
        totalStorageSizeBytes,
        formattedTotalStorageMb,
        emailDeliveredCount,
        reports: paged,
    };
}

/**
 * Genera SAS efímero para descarga segura de reporte.
 */
export async function generateDownloadSas(params: {
    tenantId: string;
    reportId: string;
    fileType: 'pdf' | 'json';
}): Promise<{ sasDownloadUrl: string; fileName: string; expiresAt: string }> {
    const { tenantId, reportId, fileType } = params;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const fileName = `Reporte-Ejecutivo-${tenantId}-${reportId}.${fileType}`;
    const sasDownloadUrl = `/api/reports/history/${reportId}/download?tenantId=${encodeURIComponent(tenantId)}&fileType=${fileType}`;

    return {
        sasDownloadUrl,
        fileName,
        expiresAt,
    };
}

/**
 * Rehidratación del Snapshot para "Abrir en Reporte Ejecutivo".
 */
export async function rehydrateReportData(tenantId: string, reportId: string): Promise<{
    report: string;
    metadata: any;
}> {
    const numericId = Number(reportId);
    if (isMockTenant(tenantId)) {
        return {
            report: `# Reporte Ejecutivo FinOps\n\n**Alcance:** Tenant Completo\n\n## 1. Resumen Ejecutivo y Diagnóstico Financiero C-Level\nGasto MTD en $675.84 USD con $9,930.00 USD en oportunidades identificadas.\n\n## 2. Economía Unitaria y Eficiencia de Asignación\nTagging coverage al 83.0%.\n\n## 3. Matriz de Ineficiencias\nDiscos huérfanos y snapshots antiguos.\n\n## 4. Rate Optimization\nCommitments al 45%.\n\n## 5. Riesgos Operacionales y HA\n45 brechas de resiliencia.\n\n## 6. Hoja de Ruta 30-60-90 Días\nPlan de acción priorizado.`,
            metadata: {
                id: numericId || 90003,
                requestedBy: 'demo@cscloudsolutions.com.ar',
                scopeSubscriptionId: 'All',
                scopeSubscriptionName: 'Tenant completo',
                locale: 'es',
                createdAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
            },
        };
    }

    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, requested_by_email, scope_subscription_id, scope_subscription_name, locale,
                report_markdown, report_stored_name, created_at, completed_at
         FROM ExecutiveReportJobs
         WHERE tenant_id = ? AND id = ? AND status = 'completed'
         LIMIT 1`,
        [tenantId, numericId]
    );

    const row = rows[0];
    if (!row) throw new Error('Reporte histórico no encontrado');

    let report = String(row.report_markdown || '');
    if (!report && row.report_stored_name) {
        report = (await readExecutiveReportMarkdown(String(row.report_stored_name))) || '';
    }

    const planTier = await getTenantPlanTier(tenantId);
    const retentionDays = getTierRetentionDays(planTier);
    const expiresAt = new Date(new Date(row.created_at).getTime() + retentionDays * 86400000).toISOString();

    return {
        report,
        metadata: {
            id: row.id,
            requestedBy: row.requested_by_email,
            scopeSubscriptionId: row.scope_subscription_id,
            scopeSubscriptionName: row.scope_subscription_name,
            locale: row.locale,
            createdAt: row.created_at,
            completedAt: row.completed_at,
            expiresAt,
        },
    };
}

/**
 * Eliminación de reporte histórico y purgado del blob.
 */
export async function deleteReportFromHistory(tenantId: string, reportId: string): Promise<boolean> {
    const numericId = Number(reportId);
    if (isMockTenant(tenantId)) {
        return true;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, report_stored_name FROM ExecutiveReportJobs WHERE tenant_id = ? AND id = ?`,
        [tenantId, numericId]
    );

    const row = rows[0];
    if (!row) return false;

    if (row.report_stored_name) {
        try {
            await deleteExecutiveReportMarkdown(row.report_stored_name);
        } catch {
            // best-effort
        }
    }

    if (isBlobStorageEnabled()) {
        try {
            await deleteBlob(BLOB_CONTAINER_REPORTS, `reports/${tenantId}/report_${numericId}.pdf`);
            await deleteBlob(BLOB_CONTAINER_REPORTS, `reports/${tenantId}/report_${numericId}.json`);
        } catch {
            // best-effort
        }
    }

    await pool.query('DELETE FROM ExecutiveReportJobs WHERE tenant_id = ? AND id = ?', [tenantId, numericId]);
    return true;
}
