import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { vmSizeToCores } from "@/modules/collectors/azure/aksCostService";

const MOCK_PAYLOAD = {
    success: true,
    mock: true,
    totalCores: 240,
    totalCost: 12480,
    effectiveCost: 9744,
    costPerCore: 40.6,
    costPerCoreNoCommitments: 52.0,
    savingsFromCommitments: 22,
    byRegion: [
        { region: "eastus",       cores: 120, costPerCore: 38 },
        { region: "westeurope",   cores: 80,  costPerCore: 42 },
        { region: "brazilsouth",  cores: 40,  costPerCore: 45 },
    ],
    bySku: [
        { sku: "Standard_D4s_v5", cores: 80,  cost: 3200, costPerCore: 40 },
        { sku: "Standard_E8s_v5", cores: 120, cost: 6240, costPerCore: 52 },
        { sku: "Standard_B2s",    cores: 40,  cost: 1304, costPerCore: 32.6 },
    ],
    trend: [
        { month: "2026-01", costPerCore: 48 },
        { month: "2026-02", costPerCore: 45 },
        { month: "2026-03", costPerCore: 43 },
        { month: "2026-04", costPerCore: 41.5 },
        { month: "2026-05", costPerCore: 40.8 },
        { month: "2026-06", costPerCore: 40.6 },
    ],
    benchmark: 42.50,
};

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
            const [rows]: any = await pool.query(
                `SELECT
                    ResourceId,
                    COALESCE(EffectiveCost, BilledCost, cost_usd, 0) AS effectiveCost,
                    DATE_FORMAT(date, '%Y-%m') AS month
                 FROM CostSnapshots
                 WHERE tenant_id = ?
                   AND (service_name LIKE '%Virtual Machine%' OR ServiceFamily = 'Compute')
                   AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
                [tenantId, days]
            );

            let totalEffectiveCost = 0;
            let totalCoreMonths = 0;

            const byMonthMap: Record<string, { cost: number; cores: number }> = {};

            for (const row of rows as any[]) {
                const cost = parseFloat(row.effectiveCost) || 0;
                const resourceId: string = row.ResourceId || "";
                // Extract VM size from resourceId (last segment often carries the name)
                const parts = resourceId.split("/");
                const vmName = parts[parts.length - 1] || "";
                const cores = vmSizeToCores(vmName);

                totalEffectiveCost += cost;
                totalCoreMonths += cores;

                const month: string = row.month || "";
                if (month) {
                    if (!byMonthMap[month]) byMonthMap[month] = { cost: 0, cores: 0 };
                    byMonthMap[month].cost += cost;
                    byMonthMap[month].cores += cores;
                }
            }

            const costPerCore = totalCoreMonths > 0
                ? parseFloat((totalEffectiveCost / totalCoreMonths).toFixed(2))
                : 0;

            const trend = Object.entries(byMonthMap)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([month, v]) => ({
                    month,
                    costPerCore: v.cores > 0 ? parseFloat((v.cost / v.cores).toFixed(2)) : 0,
                }));

            return NextResponse.json({
                success: true,
                mock: false,
                totalCores: totalCoreMonths,
                totalCost: parseFloat(totalEffectiveCost.toFixed(2)),
                effectiveCost: parseFloat(totalEffectiveCost.toFixed(2)),
                costPerCore,
                costPerCoreNoCommitments: parseFloat((costPerCore * 1.28).toFixed(2)),
                savingsFromCommitments: 22,
                byRegion: [],
                bySku: [],
                trend,
                benchmark: 42.50,
            });
        } catch {
            return NextResponse.json(MOCK_PAYLOAD);
        }
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Error interno" }, { status: 500 });
    }
}
