import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { redis } from "@/lib/redis";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('unit_economics', tenantId));
        }

        const cacheKey = `unit_economics:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            const credential = await getAzureCredential(tenantId);
            const costClient = new CostManagementClient(credential);
            
            const subs = await getSubscriptionsForTenant(tenantId, credential);
            if (!subs || subs.length === 0) {
                return { rows: [], estimatedDau: 0 };
            }

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 29);

            const dailyCosts = new Map<string, number>();

            for (const subId of subs) {
                const scope = `subscriptions/${subId}`;
                try {
                    const costRes = await costClient.query.usage(scope, {
                        type: "ActualCost",
                        timeframe: "Custom",
                        timePeriod: { from: startDate, to: endDate },
                        dataset: {
                            granularity: "Daily",
                            aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } }
                        }
                    });

                    if (costRes.rows) {
                        costRes.rows.forEach(row => {
                            const cost = parseFloat(row[0] as string);
                            const usageDate = String(row[1]);
                            let fmt = usageDate;
                            if (usageDate.length === 8) fmt = `${usageDate.substring(0,4)}-${usageDate.substring(4,6)}-${usageDate.substring(6,8)}`;
                            else if (usageDate.includes('T')) fmt = usageDate.split('T')[0];
                            dailyCosts.set(fmt, (dailyCosts.get(fmt) || 0) + cost);
                        });
                    }
                } catch (subErr) {
                    console.error(`[UnitEconomics] Error sub ${subId}:`, subErr);
                }
            }

            const pool = (await import('@/modules/storage/db')).default;

            // DAU per-day from BusinessMetrics
            let dauByDate = new Map<string, number>();
            try {
                const [rows] = await pool.query(
                    `SELECT metric_date, dau FROM BusinessMetrics
                     WHERE tenant_id = ? AND metric_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                     AND dau IS NOT NULL`,
                    [tenantId]
                );
                if (Array.isArray(rows)) {
                    (rows as any[]).forEach(r => {
                        const d = r.metric_date instanceof Date
                            ? r.metric_date.toISOString().split('T')[0]
                            : String(r.metric_date).split('T')[0];
                        dauByDate.set(d, Number(r.dau));
                    });
                }
            } catch { dauByDate = new Map(); }

            // Global estimated DAU fallback from BusinessMetricsConfig
            let estimatedDau = 0;
            try {
                const [cfgRows] = await pool.query(
                    `SELECT estimated_dau FROM BusinessMetricsConfig WHERE tenant_id = ? LIMIT 1`,
                    [tenantId]
                );
                if (Array.isArray(cfgRows) && (cfgRows as any[]).length > 0) {
                    estimatedDau = Number((cfgRows as any[])[0].estimated_dau) || 0;
                }
            } catch { /* tabla puede no existir aún */ }

            const finalData = [];
            for (let i = 29; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split('T')[0];
                const cost = dailyCosts.get(dateStr) || 0;
                const dau = dauByDate.has(dateStr) ? dauByDate.get(dateStr)! : (estimatedDau > 0 ? estimatedDau : null);
                finalData.push({
                    date: dateStr,
                    cost,
                    dau,
                    costPerUser: (dau && dau > 0 && cost > 0) ? cost / dau : null
                });
            }

            return { rows: finalData, estimatedDau };
        }, 43200);

        return NextResponse.json({ success: true, data });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Unit Economics Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// POST: guarda la configuración de DAU estimado para el tenant
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, estimatedDau } = body;
        if (!tenantId || estimatedDau == null) {
            return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
        }
        await requireTenantAccess(request, tenantId);

        const pool = (await import('@/modules/storage/db')).default;
        await pool.query(
            `INSERT INTO BusinessMetricsConfig (tenant_id, estimated_dau)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE estimated_dau = VALUES(estimated_dau), updated_at = NOW()`,
            [tenantId, Number(estimatedDau)]
        );

        // Invalida la caché para que el próximo GET recalcule
        await redis.del(`unit_economics:${tenantId}`);

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Unit Economics POST Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

