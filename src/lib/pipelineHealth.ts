import pool from "@/modules/storage/db";
import { errorMessage } from '@/lib/apiErrors';

/**
 * IT-13 — Helper para que los collectors registren eventos de ingesta.
 * Llamar al final de cada fetch exitoso/fallido de costos/recursos/recomendaciones.
 */
export async function recordPipelineEvent(args: {
    tenantId: string;
    source: string; // 'costs' | 'resources' | 'advisor' | 'reservations' | ...
    periodEnd?: Date | string | null;
    recordCount?: number;
    status?: "ok" | "warning" | "error";
    errorMsg?: string | null;
}): Promise<void> {
    const { tenantId, source } = args;
    const periodEnd = args.periodEnd
        ? (args.periodEnd instanceof Date ? args.periodEnd : new Date(args.periodEnd))
        : null;
    try {
        await pool.query(
            `INSERT INTO DataPipelineEvents (tenant_id, source, period_end, ingested_at, record_count, status, error_msg)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`,
            [tenantId, source, periodEnd, args.recordCount ?? 0, args.status ?? "ok", args.errorMsg ?? null]
        );
    } catch (e) {
        // No queremos que un fallo de logging tumbe la ingesta. Solo lo dejamos en warn.
        console.warn("[pipelineHealth] no se pudo registrar evento:", errorMessage(e));
    }
}
