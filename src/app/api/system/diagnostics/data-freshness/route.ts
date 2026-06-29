import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool, { initializeDatabase } from "@/modules/storage/db";

/**
 * IT-13 — Data Ingestion Monitoring.
 *
 * Devuelve, para el tenant indicado:
 *   - lastIngestionAt: timestamp del último registro recibido (CostSnapshots o evento explícito)
 *   - p50DelayHours / p90DelayHours: delay entre ChargePeriodEnd e ingested_at (últimos 30 días)
 *   - recordCount30d: cantidad de filas ingeridas en los últimos 30 días
 *   - gapsCount30d: días sin ningún registro en los últimos 30 días
 *   - status: green (<24h y sin gaps) / amber (24-72h o gaps<3) / red (>72h o gaps>=3)
 *   - events: últimos 10 eventos del pipeline (tabla DataPipelineEvents)
 */
export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded || !decoded.tid) return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

        // 1) Última ingesta + cuenta + delays sobre CostSnapshots últimos 30d
        const [aggRows]: any = await pool.query(
            `SELECT
                MAX(ingested_at) AS lastIngestionAt,
                COUNT(*) AS recordCount30d,
                AVG(GREATEST(TIMESTAMPDIFF(HOUR, COALESCE(ChargePeriodEnd, CONCAT(date,' 00:00:00')), ingested_at), 0)) AS avgDelayHours
             FROM CostSnapshots
             WHERE tenant_id = ?
               AND ingested_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)`,
            [tenantId]
        );
        const lastIngestionAt: string | null = aggRows[0]?.lastIngestionAt || null;
        const recordCount30d: number = Number(aggRows[0]?.recordCount30d || 0);
        const avgDelayHours: number = Number(aggRows[0]?.avgDelayHours || 0);

        // 2) Aproximación de p50/p90 sin window functions (MySQL 5.7 compatible):
        //    seleccionamos delays ordenados y picamos por offset.
        let p50DelayHours: number | null = null;
        let p90DelayHours: number | null = null;
        if (recordCount30d > 0) {
            const p50Off = Math.floor(recordCount30d * 0.5);
            const p90Off = Math.floor(recordCount30d * 0.9);
            const [p50Row]: any = await pool.query(
                `SELECT GREATEST(TIMESTAMPDIFF(HOUR, COALESCE(ChargePeriodEnd, CONCAT(date,' 00:00:00')), ingested_at), 0) AS d
                 FROM CostSnapshots WHERE tenant_id = ? AND ingested_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)
                 ORDER BY d ASC LIMIT 1 OFFSET ?`,
                [tenantId, p50Off]
            );
            const [p90Row]: any = await pool.query(
                `SELECT GREATEST(TIMESTAMPDIFF(HOUR, COALESCE(ChargePeriodEnd, CONCAT(date,' 00:00:00')), ingested_at), 0) AS d
                 FROM CostSnapshots WHERE tenant_id = ? AND ingested_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)
                 ORDER BY d ASC LIMIT 1 OFFSET ?`,
                [tenantId, p90Off]
            );
            p50DelayHours = p50Row[0]?.d != null ? Number(p50Row[0].d) : null;
            p90DelayHours = p90Row[0]?.d != null ? Number(p90Row[0].d) : null;
        }

        // 3) Gaps: días sin ningún registro en los últimos 30 días.
        const [daysRows]: any = await pool.query(
            `SELECT DISTINCT date FROM CostSnapshots
             WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
            [tenantId]
        );
        const presentDays = new Set<string>((daysRows as any[]).map(r => (r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10))));
        let gapsCount30d = 0;
        for (let i = 0; i < 30; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const iso = d.toISOString().slice(0, 10);
            if (!presentDays.has(iso)) gapsCount30d++;
        }

        // 4) Status semáforo
        let status: "green" | "amber" | "red" = "green";
        const hoursSinceLast = lastIngestionAt ? (Date.now() - new Date(lastIngestionAt).getTime()) / 36e5 : Infinity;
        if (hoursSinceLast > 72 || gapsCount30d >= 3 || (p90DelayHours != null && p90DelayHours > 72)) status = "red";
        else if (hoursSinceLast > 24 || gapsCount30d >= 1 || (p90DelayHours != null && p90DelayHours > 24)) status = "amber";

        // 5) Últimos eventos del pipeline (si hay tracking explícito).
        const [eventRows]: any = await pool.query(
            `SELECT source, period_end, ingested_at, record_count, status, error_msg
             FROM DataPipelineEvents WHERE tenant_id = ?
             ORDER BY ingested_at DESC LIMIT 10`,
            [tenantId]
        );

        return NextResponse.json({
            success: true,
            tenantId,
            status,
            lastIngestionAt,
            hoursSinceLast: Number.isFinite(hoursSinceLast) ? Math.round(hoursSinceLast * 10) / 10 : null,
            p50DelayHours,
            p90DelayHours,
            avgDelayHours: Math.round(avgDelayHours * 10) / 10,
            recordCount30d,
            gapsCount30d,
            events: eventRows,
        });
    } catch (e: any) {
        console.error("[data-freshness] error:", e);
        return NextResponse.json({ error: "Error consultando frescura de datos", details: e.message }, { status: 500 });
    }
}
