/**
 * GET /api/intelligence/compute-cost-per-core — costo unitario por vCore.
 *
 * RBAC app: requireTenantAccess (tenant-scoped).
 * Roles Azure requeridos: NINGUNO en el request (sirve datos persistidos en
 * CostMeterSnapshots/CostSnapshots por /api/cron/sync, que requiere
 * 'Cost Management Reader' — tier Essential del onboarding, verificado por
 * /api/admin/check-sp-roles).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { vmSizeToCores } from "@/modules/collectors/azure/aksCostService";

/**
 * Parses an Azure billing MeterName (e.g. "D4s v5", "E8s v5 Spot", "B2s")
 * into a vCore count using vmSizeToCores.
 */
function meterNameToCores(meterName: string | null | undefined): number {
    if (!meterName) return 0;
    // Strip usage modifiers that don't affect size
    const clean = meterName.replace(/\s+(Spot|On-Demand|Promo|Low Priority|Preemptible)$/i, '').trim();
    // "D4s v5" → "Standard_D4s_v5", "E8s v5" → "Standard_E8s_v5", "B2s" → "Standard_B2s"
    const sku = 'Standard_' + clean.replace(/\s+v(\d+)$/, '_v$1').replace(/\s+/g, '_');
    return vmSizeToCores(sku);
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const days = Math.max(1, Math.min(365, parseInt(searchParams.get("days") || "30", 10)));

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('compute-efficiency', tenantId));
        }

        try {
            // Fuente primaria: filas a nivel de meter (CostMeterSnapshots) — traen
            // MeterName/MeterSubCategory reales para derivar SKU y cores. Fallback
            // a CostSnapshots (chargeback) para datos anteriores a esa tabla.
            let [rows]: any = await pool.query(
                `SELECT
                    MeterSubCategory,
                    MeterName,
                    resource_location AS region,
                    cost_usd AS effectiveCost,
                    cost_usd AS billedCost,
                    DATE_FORMAT(date, '%Y-%m') AS month
                 FROM CostMeterSnapshots
                 WHERE tenant_id = ?
                   AND (
                        service_name LIKE '%Virtual Machine%'
                     OR service_name LIKE '%Compute%'
                     OR MeterCategory LIKE '%Compute%'
                     OR MeterSubCategory LIKE '%Series%'
                   )
                   AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
                [tenantId, days]
            );
            if (!Array.isArray(rows) || rows.length === 0) {
                // Fallback legacy: CostSnapshots no tiene región; resource_group NO
                // es una región, así que no lo usamos como tal (quedaría 'unknown').
                [rows] = await pool.query(
                    `SELECT
                        MeterSubCategory,
                        MeterName,
                        '' AS region,
                        COALESCE(EffectiveCost, BilledCost, cost_usd, 0) AS effectiveCost,
                        COALESCE(BilledCost, cost_usd, 0)                AS billedCost,
                        DATE_FORMAT(date, '%Y-%m')                       AS month
                     FROM CostSnapshots
                     WHERE tenant_id = ?
                       AND (
                            service_name LIKE '%Virtual Machine%'
                         OR service_name LIKE '%Compute%'
                         OR MeterCategory LIKE '%Compute%'
                         OR MeterSubCategory LIKE '%Series%'
                       )
                       AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
                    [tenantId, days]
                );
            }

            let totalEffectiveCost = 0;
            let totalBilledCost    = 0;
            let totalCoreMonths    = 0;

            const bySkuMap:    Record<string, { cores: number; cost: number }> = {};
            const byRegionMap: Record<string, { cores: number; cost: number }> = {};
            const byMonthMap:  Record<string, { cost: number; cores: number }> = {};

            for (const row of rows as any[]) {
                const effectiveCost = parseFloat(row.effectiveCost) || 0;
                const billedCost    = parseFloat(row.billedCost)    || 0;
                const cores         = meterNameToCores(row.MeterName);
                const sku           = (row.MeterSubCategory || row.MeterName || 'Unknown').trim();
                const region        = (row.region || 'unknown').trim();
                const month: string = row.month             || '';

                totalEffectiveCost += effectiveCost;
                totalBilledCost    += billedCost;
                totalCoreMonths    += cores;

                if (sku) {
                    if (!bySkuMap[sku]) bySkuMap[sku] = { cores: 0, cost: 0 };
                    bySkuMap[sku].cores += cores;
                    bySkuMap[sku].cost  += effectiveCost;
                }
                if (region) {
                    if (!byRegionMap[region]) byRegionMap[region] = { cores: 0, cost: 0 };
                    byRegionMap[region].cores += cores;
                    byRegionMap[region].cost  += effectiveCost;
                }
                if (month) {
                    if (!byMonthMap[month]) byMonthMap[month] = { cost: 0, cores: 0 };
                    byMonthMap[month].cost  += effectiveCost;
                    byMonthMap[month].cores += cores;
                }
            }

            const costPerCore = totalCoreMonths > 0
                ? parseFloat((totalEffectiveCost / totalCoreMonths).toFixed(2))
                : 0;

            // savingsFromCommitments: % reduction from billed → effective (via RIs/SPs)
            const savingsFromCommitments = totalBilledCost > 0
                ? Math.max(0, Math.round(((totalBilledCost - totalEffectiveCost) / totalBilledCost) * 100))
                : 0;

            const bySku = Object.entries(bySkuMap)
                .sort(([, a], [, b]) => b.cost - a.cost)
                .slice(0, 10)
                .map(([sku, v]) => ({
                    sku,
                    cores: v.cores,
                    cost: parseFloat(v.cost.toFixed(2)),
                    costPerCore: v.cores > 0 ? parseFloat((v.cost / v.cores).toFixed(2)) : 0,
                }));

            const byRegion = Object.entries(byRegionMap)
                .sort(([, a], [, b]) => b.cost - a.cost)
                .slice(0, 8)
                .map(([region, v]) => ({
                    region,
                    cores: v.cores,
                    costPerCore: v.cores > 0 ? parseFloat((v.cost / v.cores).toFixed(2)) : 0,
                }));

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
                costPerCoreNoCommitments: parseFloat((totalBilledCost > 0 ? totalBilledCost / Math.max(totalCoreMonths, 1) : costPerCore * 1.28).toFixed(2)),
                savingsFromCommitments,
                byRegion,
                bySku,
                trend,
                benchmark: 42.50,
            });
        } catch (dbErr: any) {
            console.error("[compute-cost-per-core] DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({
                success: false, mock: false,
                totalCores: 0, totalCost: 0, effectiveCost: 0,
                costPerCore: 0, costPerCoreNoCommitments: 0, savingsFromCommitments: 0,
                byRegion: [], bySku: [], trend: [], benchmark: 42.50,
                error: `Sin datos disponibles: ${dbErr?.message || "error"}`,
            });
        }
    } catch (err: unknown) {
        console.error("[compute-cost-per-core] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

