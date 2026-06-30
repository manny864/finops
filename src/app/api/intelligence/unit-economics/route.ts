import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";

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
                return [];
            }

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 29); // Last 30 days including today

            const dailyCosts = new Map<string, number>();

            // 1. Obtener Costos Diarios iterando por cada subscripción válida
            for (const subId of subs) {
                const scope = `subscriptions/${subId}`;
                try {
                    const costRes = await costClient.query.usage(scope, {
                        type: "ActualCost",
                        timeframe: "Custom",
                        timePeriod: {
                            from: startDate,
                            to: endDate
                        },
                        dataset: {
                            granularity: "Daily",
                            aggregation: {
                                totalCost: { name: "PreTaxCost", function: "Sum" }
                            }
                        }
                    });

                    if (costRes.rows) {
                        costRes.rows.forEach(row => {
                            const cost = parseFloat(row[0] as string);
                            const usageDate = String(row[1]); // formato YYYYMMDD o YYYY-MM-DDT...
                            let formattedDate = usageDate;
                            if (usageDate.length === 8) {
                                formattedDate = `${usageDate.substring(0,4)}-${usageDate.substring(4,6)}-${usageDate.substring(6,8)}`;
                            } else if (usageDate.includes('T')) {
                                formattedDate = usageDate.split('T')[0];
                            }
                            dailyCosts.set(formattedDate, (dailyCosts.get(formattedDate) || 0) + cost);
                        });
                    }
                } catch (subErr) {
                    console.error(`Error al consultar Cost Management para ${scope}:`, subErr);
                }
            }

            // 2. DAU real desde tabla BusinessMetrics (cada tenant inyecta su métrica vía API externa).
            //    Si no hay fuente registrada, NO inventamos datos: devolvemos dau=null para tenants reales.
            let dauByDate = new Map<string, number>();
            try {
                const pool = (await import('@/modules/storage/db')).default;
                const [rows] = await pool.query(
                    `SELECT metric_date, dau FROM BusinessMetrics
                     WHERE tenant_id = ? AND metric_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
                    [tenantId]
                );
                if (Array.isArray(rows)) {
                    (rows as any[]).forEach(r => {
                        const d = r.metric_date instanceof Date
                            ? r.metric_date.toISOString().split('T')[0]
                            : String(r.metric_date).split('T')[0];
                        if (r.dau != null) dauByDate.set(d, Number(r.dau));
                    });
                }
            } catch {
                // Tabla puede no existir aún; degradamos a dau=null en lugar de fabricar.
                dauByDate = new Map();
            }

            const finalData = [];
            for (let i = 29; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split('T')[0];

                const cost = dailyCosts.get(dateStr) || 0;
                const dau = dauByDate.has(dateStr) ? dauByDate.get(dateStr)! : null;

                finalData.push({
                    date: dateStr,
                    cost: cost,
                    dau: dau,
                    costPerUser: (dau && dau > 0 && cost > 0) ? (cost / dau) : null
                });
            }

            return finalData;

        }, 43200); // 12 hours TTL

        return NextResponse.json({ success: true, data });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Unit Economics Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
