import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

const MOCK_PAYLOAD = {
    success: true,
    mock: true,
    tiers: {
        hot:     { percent: 62, gb: 12500, cost: 230 },
        cool:    { percent: 25, gb: 5000,  cost: 50 },
        cold:    { percent: 8,  gb: 1600,  cost: 5.76 },
        archive: { percent: 5,  gb: 1000,  cost: 0.99 },
    },
    totalGb: 20100,
    totalCost: 286.75,
    costPerGb: 0.01426,
    recommendation: {
        movableGb: 3500,
        potentialSavings: 65.40,
        fromTier: "hot",
        toTier: "cool",
    },
};

// Tier rates $/GB
const TIER_RATES: Record<string, number> = {
    hot:     0.0184,
    cool:    0.01,
    cold:    0.0036,
    archive: 0.00099,
};

function detectTier(...fields: Array<string | null | undefined>): string {
    for (const f of fields) {
        if (!f) continue;
        const m = String(f).toLowerCase();
        if (m.includes("archive")) return "archive";
        if (m.includes("cold"))    return "cold";
        if (m.includes("cool"))    return "cool";
        if (m.includes("hot"))     return "hot";
    }
    return "hot";
}

async function runQuery(tenantId: string, days: number) {
    // Ensure optional FOCUS columns exist (idempotent)
    for (const col of [
        "ADD COLUMN MeterName VARCHAR(255)",
        "ADD COLUMN MeterSubCategory VARCHAR(255)",
        "ADD COLUMN MeterCategory VARCHAR(255)",
        "ADD COLUMN Quantity DECIMAL(18,6)",
        "ADD COLUMN UnitOfMeasure VARCHAR(64)"
    ]) {
        try { await pool.query(`ALTER TABLE CostSnapshots ${col}`); } catch { /* exists */ }
    }
    const [rows]: any = await pool.query(
        `SELECT
            MeterName,
            MeterSubCategory,
            MeterCategory,
            ServiceFamily,
            service_name,
            COALESCE(Quantity, 0) AS quantity,
            UnitOfMeasure,
            COALESCE(BilledCost, cost_usd, 0) AS billedCost
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND (
                LOWER(COALESCE(ServiceFamily,'')) = 'storage'
             OR LOWER(COALESCE(MeterCategory,'')) IN ('storage','azure storage','disks','disk storage')
             OR service_name LIKE '%Storage%'
             OR service_name LIKE '%Blob%'
             OR service_name LIKE '%File%'
             OR service_name LIKE '%Disk%'
           )
           AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
        [tenantId, days]
    );
    return rows as any[];
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const days = Math.max(1, Math.min(365, parseInt(searchParams.get("days") || "30", 10)));

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(MOCK_PAYLOAD);
        }

        try {
            // Try requested window first; if empty, widen to 90 days, then 365
            let rows = await runQuery(tenantId, days);
            let effectiveDays = days;
            let widened = false;
            if (rows.length === 0 && days < 90) {
                rows = await runQuery(tenantId, 90);
                effectiveDays = 90;
                widened = rows.length > 0;
            }
            if (rows.length === 0) {
                rows = await runQuery(tenantId, 365);
                effectiveDays = 365;
                widened = rows.length > 0;
            }

            const tierMap: Record<string, { gb: number; cost: number }> = {
                hot: { gb: 0, cost: 0 },
                cool: { gb: 0, cost: 0 },
                cold: { gb: 0, cost: 0 },
                archive: { gb: 0, cost: 0 },
            };

            for (const row of rows) {
                const tier = detectTier(row.MeterSubCategory, row.MeterName, row.MeterCategory, row.service_name);
                const cost = parseFloat(row.billedCost) || 0;
                // Prefer reported Quantity (in GB-month) if available; else infer from cost / rate
                const uom = String(row.UnitOfMeasure || "").toLowerCase();
                const reportedQty = parseFloat(row.quantity) || 0;
                const inferredGb = TIER_RATES[tier] > 0 ? cost / TIER_RATES[tier] : 0;
                const gb = (reportedQty > 0 && (uom.includes("gb") || uom.includes("byte"))) ? reportedQty : inferredGb;
                tierMap[tier].cost += cost;
                tierMap[tier].gb += gb;
            }

            const totalCost = Object.values(tierMap).reduce((s, t) => s + t.cost, 0);
            const totalGb   = Object.values(tierMap).reduce((s, t) => s + t.gb, 0);
            const costPerGb = totalGb > 0 ? totalCost / totalGb : 0;

            const tiersWithPercent = Object.fromEntries(
                Object.entries(tierMap).map(([k, v]) => [
                    k,
                    { gb: parseFloat(v.gb.toFixed(2)), cost: parseFloat(v.cost.toFixed(2)), percent: totalGb > 0 ? Math.round((v.gb / totalGb) * 100) : 0 },
                ])
            );

            const hotGb = tierMap.hot.gb;
            const movableGb = Math.round(hotGb * 0.28);
            const potentialSavings = parseFloat(
                ((TIER_RATES.hot - TIER_RATES.cool) * movableGb).toFixed(2)
            );

            if (rows.length === 0) {
                return NextResponse.json({
                    success: true,
                    mock: false,
                    empty: true,
                    message: "No se encontraron registros de costo de Storage en los últimos 365 días. Verificá que la sincronización de FinOps haya corrido al menos una vez.",
                    tiers: tiersWithPercent,
                    totalGb: 0,
                    totalCost: 0,
                    costPerGb: 0,
                    diagnostics: { rowsFound: 0, requestedDays: days, effectiveDays: 365, widened: false }
                });
            }

            return NextResponse.json({
                success: true,
                mock: false,
                tiers: tiersWithPercent,
                totalGb: parseFloat(totalGb.toFixed(2)),
                totalCost: parseFloat(totalCost.toFixed(2)),
                costPerGb: parseFloat(costPerGb.toFixed(5)),
                recommendation: {
                    movableGb,
                    potentialSavings,
                    fromTier: "hot",
                    toTier: "cool",
                },
                diagnostics: { rowsFound: rows.length, requestedDays: days, effectiveDays, widened }
            });
        } catch (dbErr: any) {
            console.error("[storage-efficiency] DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({
                success: false, mock: false,
                topAccounts: [], byTier: [], summary: {
                    totalAccounts: 0, totalGb: 0, totalCost: 0,
                    movableGb: 0, potentialSavings: 0,
                    fromTier: "hot", toTier: "cool",
                },
                error: `Sin datos disponibles: ${dbErr?.message || "error"}`,
            });
        }
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Error interno" }, { status: 500 });
    }
}
