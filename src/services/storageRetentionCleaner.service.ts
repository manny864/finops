/**
 * Servicio del Motor de Purga y Mantenimiento de Retención de Almacenamiento.
 *
 * Aplica políticas automáticas de retención por Tier:
 *   - Professional: Purga reportes con antigüedad > 90 días
 *   - Business:     Purga reportes con antigüedad > 180 días
 *   - Enterprise:   Purga reportes con antigüedad > 365 días
 *
 * Flujo:
 *   1. Identificación de reportes expirados según el Tier del Tenant.
 *   2. Eliminación segura de Blobs (.pdf y .json) en Azure Blob Storage (contenedor `cscloud-executive-reports`).
 *   3. Marcado atómico `deleted_at = NOW()` en MySQL.
 *   4. Registro en `AuditTrailLogs` y actualización de estado en `SaaSCronJobs`.
 */

import pool, { initializeDatabase } from "@/modules/storage/db";
import { deleteBlob, isBlobStorageEnabled } from "@/lib/azureBlobStorage";
import type {
  StorageCleanupResult,
  PurgedReportDetail,
} from "@/types/storageRetentionCleaner.types";

export const BLOB_CONTAINER_REPORTS = "cscloud-executive-reports";

export const TIER_RETENTION_DAYS: Record<string, number> = {
  professional: 90,
  business: 180,
  enterprise: 365,
};

export function getRetentionDaysForTier(tier: string | null | undefined): number {
  const normalized = String(tier || "professional").toLowerCase().trim();
  if (normalized.includes("enterprise")) return TIER_RETENTION_DAYS.enterprise;
  if (normalized.includes("business")) return TIER_RETENTION_DAYS.business;
  return TIER_RETENTION_DAYS.professional;
}

/**
 * Ejecuta el barrido desatendido de retención y purga de reportes ejecutivos.
 */
export async function executeStorageRetentionCleanup(options?: {
  dryRun?: boolean;
}): Promise<StorageCleanupResult> {
  const startTime = Date.now();
  const dryRun = Boolean(options?.dryRun);

  await initializeDatabase();

  const purgedReports: PurgedReportDetail[] = [];
  let totalCandidatesFound = 0;
  let totalFreedBytes = 0;
  let errorsCount = 0;

  try {
    // 1. Obtener lista de tenants y sus tiers contratados
    let tenants: Array<{ tenant_id: string; tier: string }> = [];
    try {
      const [tenantRows]: any = await pool.query(
        "SELECT tenant_id, tier FROM Tenants WHERE tenant_id IS NOT NULL"
      );
      tenants = Array.isArray(tenantRows) ? tenantRows : [];
    } catch {
      tenants = [];
    }

    const tenantTierMap = new Map<string, string>();
    for (const t of tenants) {
      tenantTierMap.set(t.tenant_id, t.tier || "Professional");
    }

    // 2. Consultar reportes completados no eliminados
    const [reportRows]: any = await pool.query(
      `SELECT id, tenant_id, scope_subscription_name, created_at, report_markdown, report_stored_name
       FROM ExecutiveReportJobs
       WHERE (deleted_at IS NULL)
       ORDER BY created_at ASC`
    );

    const now = Date.now();
    const candidateReports: any[] = [];

    for (const report of reportRows || []) {
      const tenantTier = tenantTierMap.get(report.tenant_id) || "Professional";
      const retentionDays = getRetentionDaysForTier(tenantTier);
      const createdAtMs = new Date(report.created_at).getTime();
      const ageInDays = Math.floor((now - createdAtMs) / (24 * 60 * 60 * 1000));

      if (ageInDays >= retentionDays) {
        candidateReports.push({
          ...report,
          tenantTier,
          retentionDays,
          ageInDays,
        });
      }
    }

    totalCandidatesFound = candidateReports.length;

    // 3. Ejecutar purga de blobs y actualización de BD
    for (const item of candidateReports) {
      const reportId = String(item.id);
      const tenantId = String(item.tenant_id);
      const pdfBlob = item.report_stored_name || `reports/${tenantId}/report_${reportId}.pdf`;
      const jsonBlob = `reports/${tenantId}/report_${reportId}.json`;

      // Calcular tamaño estimado liberado (report_markdown o base 1.2MB)
      const markdownBytes = Buffer.byteLength(String(item.report_markdown || ""), "utf8");
      const estimatedBytes = markdownBytes > 0 ? markdownBytes + 1024 * 500 : 1024 * 1024 * 1.2;

      if (!dryRun) {
        try {
          // Fase 2: Eliminación en Azure Blob Storage (tolerancia a 404)
          await Promise.allSettled([
            deleteBlob(BLOB_CONTAINER_REPORTS, pdfBlob),
            deleteBlob(BLOB_CONTAINER_REPORTS, jsonBlob),
          ]);

          // Fase 2: Marcar en base de datos
          await pool.query(
            "UPDATE ExecutiveReportJobs SET deleted_at = NOW(), report_markdown = NULL WHERE id = ?",
            [item.id]
          );

          totalFreedBytes += estimatedBytes;
          purgedReports.push({
            reportId,
            tenantId,
            planTier: item.tenantTier,
            ageInDays: item.ageInDays,
            pdfBlob,
            jsonBlob,
          });
        } catch (err) {
          console.error(`[storageRetentionCleaner] Error purgando reporte ${reportId}:`, err);
          errorsCount++;
        }
      } else {
        totalFreedBytes += estimatedBytes;
        purgedReports.push({
          reportId,
          tenantId,
          planTier: item.tenantTier,
          ageInDays: item.ageInDays,
          pdfBlob,
          jsonBlob,
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const freedMb = (totalFreedBytes / (1024 * 1024)).toFixed(1);
    const summaryText = `Purga completada: ${purgedReports.length} reportes eliminados (${freedMb} MB liberados en ${durationMs}ms).`;

    // 4. Registro en AuditTrailLogs y SaaSCronJobs
    if (!dryRun && purgedReports.length > 0) {
      try {
        await pool.query(
          `INSERT INTO AuditTrailLogs 
            (tenant_id, user_email, user_name, ip_address, user_agent, action_type, resource_target_id, resource_target_name, status, metadata_json, created_at)
           VALUES (?, 'system.cron@cscloudsolutions.com', 'Storage Retention Worker', '127.0.0.1', 'Azure Cron Runner', 'STORAGE_RETENTION_CLEANUP', 'AzureBlobStorage', ?, 'SUCCESS', ?, NOW())`,
          [
            "SYSTEM",
            BLOB_CONTAINER_REPORTS,
            JSON.stringify({
              purgedReportsCount: purgedReports.length,
              freedStorageMb: parseFloat(freedMb),
              totalFreedBytes,
              durationMs,
              errorsCount,
            }),
          ]
        );
      } catch (err) {
        console.warn("[storageRetentionCleaner] Error registrando audit log:", err);
      }
    }

    // Actualizar estado del cron job en SaaSCronJobs
    try {
      await pool.query(
        `INSERT INTO SaaSCronJobs (job_key, job_name, status, last_run_at, last_summary)
         VALUES ('storage-retention-cleanup', 'Purga Automática de Reportes por Tier', 'HEALTHY', NOW(), ?)
         ON DUPLICATE KEY UPDATE 
            status = 'HEALTHY',
            last_run_at = NOW(),
            last_summary = VALUES(last_summary)`,
        [summaryText]
      );
    } catch (err) {
      console.warn("[storageRetentionCleaner] Error actualizando SaaSCronJobs:", err);
    }

    return {
      success: true,
      totalCandidatesFound,
      totalPurgedCount: purgedReports.length,
      totalFreedBytes,
      formattedFreedMb: `${freedMb} MB`,
      durationMs,
      errorsCount,
      executedAtIso: new Date().toISOString(),
      purgedReports,
    };
  } catch (error: any) {
    console.error("[storageRetentionCleaner] Error general:", error);
    const durationMs = Date.now() - startTime;

    try {
      await pool.query(
        `INSERT INTO SaaSCronJobs (job_key, job_name, status, last_run_at, last_summary)
         VALUES ('storage-retention-cleanup', 'Purga Automática de Reportes por Tier', 'ERROR', NOW(), ?)
         ON DUPLICATE KEY UPDATE 
            status = 'ERROR',
            last_run_at = NOW(),
            last_summary = VALUES(last_summary)`,
        [`Error en purga: ${error?.message || "Fallo inesperado"}`]
      );
    } catch {}

    return {
      success: false,
      totalCandidatesFound,
      totalPurgedCount: purgedReports.length,
      totalFreedBytes,
      formattedFreedMb: "0.0 MB",
      durationMs,
      errorsCount: errorsCount + 1,
      executedAtIso: new Date().toISOString(),
      purgedReports,
    };
  }
}
