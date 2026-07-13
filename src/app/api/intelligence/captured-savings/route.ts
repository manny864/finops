import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";

// Detalle de "Ahorro Capturado" (tarjeta `exec` del Dashboard General).
// SavingsHistory ya se puebla a diario (POST /api/intelligence/history, vía
// el scanner automatizado) pero hasta ahora ningún endpoint la leía — el
// dashboard solo mostraba el ahorro potencial del momento, sin tendencia real.
export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantRole(request, tenantId, ["Admin", "Owner", "Reader", "Colaborador"]);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("captured_savings", tenantId));
        }

        const [rows]: any = await pool.query(
            `SELECT scan_date, total_wasted_usd, potential_savings_usd
             FROM SavingsHistory
             WHERE tenant_id = ? AND scan_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
             ORDER BY scan_date ASC`,
            [tenantId]
        );

        const history = (rows as any[]).map(r => ({
            date: typeof r.scan_date === "string" ? r.scan_date : new Date(r.scan_date).toISOString().slice(0, 10),
            totalWasted: Number(r.total_wasted_usd) || 0,
            potentialSavings: Number(r.potential_savings_usd) || 0,
        }));

        const latest = history[history.length - 1] || null;
        const previous = history.length > 1 ? history[history.length - 2] : null;
        const changePct = previous && previous.potentialSavings > 0
            ? Number((((latest!.potentialSavings - previous.potentialSavings) / previous.potentialSavings) * 100).toFixed(1))
            : 0;

        return NextResponse.json({
            success: true,
            history,
            current: latest ? { potentialSavings: latest.potentialSavings, totalWasted: latest.totalWasted, date: latest.date } : null,
            changePct,
        });
    } catch (err: unknown) {
        if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
        console.error("[captured-savings] GET error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
