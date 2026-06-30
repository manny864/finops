import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool, { initializeDatabase } from "@/modules/storage/db";

/**
 * IT-09 — Commitment Eligibility Recommender.
 *
 * Cruza:
 *   - CostSnapshots del tenant (uso real, ServiceFamily='Compute' o equivalente, sin CommitmentDiscountId)
 *   - OpenDataCommitmentEligibility (whitelist de meters elegibles para RI/SP).
 *
 * Devuelve top N recursos elegibles ordenados por gasto.
 *
 * GET /api/intelligence/commitments/recommendations?tenantId=X&days=30&top=50&type=ri|sp|both
 */
export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        const days = Math.max(1, Math.min(180, Number(request.nextUrl.searchParams.get("days") || 30)));
        const top = Math.max(1, Math.min(500, Number(request.nextUrl.searchParams.get("top") || 50)));
        const type = (request.nextUrl.searchParams.get("type") || "both").toLowerCase();

        await requireTenantAccess(request, tenantId);

        // Verifica que el dataset de eligibility esté cargado.
        const [eligCount]: any = await pool.query("SELECT COUNT(*) AS c FROM OpenDataCommitmentEligibility");
        const eligibilityRows = Number(eligCount[0]?.c || 0);
        if (eligibilityRows === 0) {
            return NextResponse.json({
                success: true,
                eligibilityDataAvailable: false,
                message: "Dataset OpenDataCommitmentEligibility vacío. Ejecutar POST /api/open-data?dataset=commitmentEligibility como super-admin.",
                recommendations: [],
            });
        }

        const eligibilityFilter = type === "ri" ? "AND oce.ri_eligible=1"
                                : type === "sp" ? "AND oce.sp_eligible=1"
                                : "AND (oce.ri_eligible=1 OR oce.sp_eligible=1)";

        // Cruce: recursos sin CommitmentDiscountId cuyo MeterId está en la whitelist.
        const [rows]: any = await pool.query(
            `SELECT
                cs.ResourceId AS resourceId,
                cs.service_name AS serviceName,
                cs.subscription_id AS subscriptionId,
                cs.resource_group AS resourceGroup,
                oce.meter_name AS meterName,
                oce.service_family AS serviceFamily,
                oce.product_name AS productName,
                oce.sku_name AS skuName,
                oce.region,
                MAX(oce.ri_eligible) AS riEligible,
                MAX(oce.sp_eligible) AS spEligible,
                SUM(COALESCE(cs.BilledCost, cs.cost_usd)) AS totalCost,
                COUNT(DISTINCT cs.date) AS daysObserved
             FROM CostSnapshots cs
             INNER JOIN OpenDataCommitmentEligibility oce ON oce.meter_id = cs.MeterId
             WHERE cs.tenant_id = ?
               AND cs.date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
               AND (cs.CommitmentDiscountId IS NULL OR cs.CommitmentDiscountId = '')
               ${eligibilityFilter}
             GROUP BY cs.ResourceId, cs.service_name, cs.subscription_id, cs.resource_group,
                      oce.meter_name, oce.service_family, oce.product_name, oce.sku_name, oce.region
             ORDER BY totalCost DESC
             LIMIT ?`,
            [tenantId, days, top]
        );

        const recommendations = (rows as any[]).map(r => {
            const totalCost = Number(r.totalCost || 0);
            const dailyAvg = r.daysObserved ? totalCost / Number(r.daysObserved) : 0;
            const annualEstimate = dailyAvg * 365;
            // RI 3yr ahorro típico ~40%, 1yr ~25%, SP ~30% (FinOps Toolkit defaults conservadores).
            const estimatedSavings1yr = Math.round(annualEstimate * 0.25 * 100) / 100;
            const estimatedSavings3yr = Math.round(annualEstimate * 0.40 * 3 * 100) / 100;
            return {
                resourceId: r.resourceId,
                subscriptionId: r.subscriptionId,
                resourceGroup: r.resourceGroup,
                serviceName: r.serviceName,
                meterName: r.meterName,
                serviceFamily: r.serviceFamily,
                productName: r.productName,
                skuName: r.skuName,
                region: r.region,
                riEligible: !!Number(r.riEligible),
                spEligible: !!Number(r.spEligible),
                observedCost: Math.round(totalCost * 100) / 100,
                daysObserved: Number(r.daysObserved || 0),
                annualEstimate: Math.round(annualEstimate * 100) / 100,
                estimatedSavings1yr,
                estimatedSavings3yr,
            };
        });

        // Diagnóstico: si la query no devuelve nada, ¿es por falta de MeterId en CostSnapshots?
        let dataQualityHint: string | null = null;
        if (recommendations.length === 0) {
            const [meterRows]: any = await pool.query(
                `SELECT COUNT(*) AS withMeter FROM CostSnapshots
                 WHERE tenant_id=? AND MeterId IS NOT NULL AND MeterId <> ''
                   AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
                [tenantId, days]
            );
            if (Number(meterRows[0]?.withMeter || 0) === 0) {
                dataQualityHint = "CostSnapshots no contiene MeterId. El collector de costos debe ingerir esta columna FOCUS para habilitar el recomendador.";
            }
        }

        return NextResponse.json({
            success: true,
            eligibilityDataAvailable: true,
            eligibilityRows,
            windowDays: days,
            type,
            count: recommendations.length,
            totalEstimatedSavings1yr: recommendations.reduce((s, r) => s + r.estimatedSavings1yr, 0),
            totalEstimatedSavings3yr: recommendations.reduce((s, r) => s + r.estimatedSavings3yr, 0),
            recommendations,
            dataQualityHint,
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[commitments/recommendations] error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
