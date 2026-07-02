import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getActiveReservations } from "@/services/reservationService";
import { recordDailySnapshotAsync } from "@/services/snapshotService";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('commitments', tenantId));
        }

        // v3: incluye reservationDetails (blade Microsoft.Capacity/reservations)
        const cacheKey = `commitments:v3:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let credential;
            let costClient;
            try {
                credential = await getAzureCredential(tenantId);
                costClient = new CostManagementClient(credential);
            } catch (e: any) {
                console.warn(`[Commitments] Sin credenciales para ${tenantId}:`, e?.message);
                return { utilization: null, coverage: 0, hasReservations: false, activeReservations: [], reservationDetails: [], recommendations: [] };
            }
            const mgScope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;

            let utilization: number | null = null;
            let coverage = 0;
            let hasReservations = false;
            let activeReservations: any[] = [];
            let reservationDetails: any[] = [];
            let recommendations: any[] = [];

            // Helper: intenta la query a nivel MG, con fallback por suscripción.
            // Devuelve las rows combinadas o null si todo falla.
            const queryCost = async (queryBody: any): Promise<{ rows: any[] } | null> => {
                try {
                    const res = await costClient.query.usage(mgScope, queryBody);
                    return res?.rows ? { rows: res.rows as any[] } : null;
                } catch {
                    try {
                        const subs = await getSubscriptionsForTenant(tenantId, credential);
                        const settled = await Promise.allSettled(
                            subs.slice(0, 6).map(subId =>
                                costClient.query.usage(`/subscriptions/${subId}`, queryBody)
                            )
                        );
                        const combined: any[] = [];
                        for (const r of settled) {
                            if (r.status === 'fulfilled' && r.value?.rows) {
                                combined.push(...(r.value.rows as any[]));
                            }
                        }
                        return combined.length > 0 ? { rows: combined } : null;
                    } catch {
                        return null;
                    }
                }
            };

            // ─── 1. RESERVAS ACTIVAS ──────────────────────────────────────────────────
            // Query AmortizedCost filtrado a PricingModel = Reservation | SavingsPlan,
            // agrupado por ServiceName + ReservationName.
            // Esto detecta CUALQUIER servicio reservado: VMs, MySQL, PostgreSQL, Redis, etc.
            try {
                const res = await queryCost({
                    type: "AmortizedCost",
                    timeframe: "MonthToDate",
                    dataset: {
                        granularity: "None",
                        aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
                        filter: {
                            dimensions: {
                                name: "PricingModel",
                                operator: "In",
                                values: ["Reservation", "SavingsPlan"]
                            }
                        },
                        grouping: [
                            { type: "Dimension", name: "ServiceName" },
                            { type: "Dimension", name: "ReservationName" }
                        ]
                    }
                });

                if (res?.rows) {
                    // rows: [cost, serviceName, reservationName, currency?]
                    const resMap = new Map<string, { serviceName: string; reservationName: string; cost: number }>();
                    for (const row of res.rows) {
                        const cost = parseFloat(String(row[0])) || 0;
                        const serviceName = String(row[1] || 'Unknown Service');
                        const reservationName = String(row[2] || '—');
                        const key = `${serviceName}|${reservationName}`;
                        const ex = resMap.get(key);
                        if (ex) ex.cost += cost;
                        else resMap.set(key, { serviceName, reservationName, cost });
                    }
                    activeReservations = Array.from(resMap.values())
                        .filter(r => r.cost > 0)
                        .sort((a, b) => b.cost - a.cost);
                    hasReservations = activeReservations.length > 0;
                }
            } catch (e: any) {
                console.warn("[Commitments] activeReservations query failed:", e.message);
            }

            // ─── 1b. DETALLE DE RESERVAS (blade Microsoft.Capacity/reservations) ────────
            // Nombre, Status, Expiration, Scope, Type, Product name, Region, Renewal,
            // Cantidad, Utilización 1 día / 7 días. Best-effort: requiere Reservations Reader.
            try {
                reservationDetails = await getActiveReservations(credential);
                if (reservationDetails.length > 0) hasReservations = true;
            } catch (e: any) {
                console.warn("[Commitments] reservationDetails query failed:", e?.message);
            }

            // ─── 2. COBERTURA ─────────────────────────────────────────────────────────
            // % del gasto total cubierto por reservas/savings plans
            try {
                const res = await queryCost({
                    type: "AmortizedCost",
                    timeframe: "MonthToDate",
                    dataset: {
                        granularity: "None",
                        aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
                        grouping: [{ type: "Dimension", name: "PricingModel" }]
                    }
                });

                if (res?.rows) {
                    let onDemand = 0, reserved = 0;
                    for (const row of res.rows) {
                        const cost = parseFloat(String(row[0])) || 0;
                        const model = String(row[1]).toLowerCase();
                        if (model === 'reservation' || model === 'savingsplan') reserved += cost;
                        else onDemand += cost;
                    }
                    const total = onDemand + reserved;
                    if (total > 0) coverage = (reserved / total) * 100;
                }
            } catch (e: any) {
                console.warn("[Commitments] coverage query failed:", e.message);
            }

            // ─── 3. UTILIZACIÓN REAL ──────────────────────────────────────────────────
            // Solo si hay reservas activas. Requiere Billing Reader (EA/MCA). Silencia fallos.
            if (hasReservations) {
                try {
                    const { ConsumptionManagementClient } = await import("@azure/arm-consumption");
                    const consumption = new ConsumptionManagementClient(credential, tenantId);
                    let totalReserved = 0, totalUsed = 0;
                    const ordersSeen = new Set<string>();

                    try {
                        const recIter = consumption.reservationRecommendations.list(mgScope);
                        for await (const rec of recIter) {
                            const orderId = (rec as any)?.properties?.reservationOrderId;
                            if (orderId && !ordersSeen.has(orderId)) {
                                ordersSeen.add(orderId);
                                try {
                                    const summaryIter = consumption.reservationsSummaries.listByReservationOrder(orderId, "monthly");
                                    for await (const s of summaryIter) {
                                        totalReserved += Number(s.reservedHours || 0);
                                        totalUsed += Number(s.usedHours || 0);
                                    }
                                } catch { /* sin permisos sobre esta orden */ }
                            }
                        }
                    } catch { /* sin permisos para listar recomendaciones */ }

                    if (totalReserved > 0) utilization = (totalUsed / totalReserved) * 100;
                } catch (e: any) {
                    console.warn("[Commitments] utilization query failed:", e?.message);
                }
            }

            // ─── 4. RECOMENDACIONES ───────────────────────────────────────────────────
            // Usa Consumption API que devuelve TODOS los tipos (VM, MySQL, Redis, etc.)
            // en lugar de hardcodear "VirtualMachines".
            try {
                const { ConsumptionManagementClient } = await import("@azure/arm-consumption");
                const consumption = new ConsumptionManagementClient(credential, tenantId);
                const recIter = consumption.reservationRecommendations.list(mgScope, {
                    filter: "properties/lookBackPeriod eq 'Last30Days'"
                });
                const recs: any[] = [];
                for await (const rec of recIter) {
                    const props = (rec as any).properties || {};
                    recs.push({
                        type: props.resourceType || props.skuName || rec.kind || 'Unknown',
                        sku: props.skuProperties?.[0]?.value || props.skuName || 'Desconocido',
                        recommendedQuantity: props.recommendedQuantity || 0,
                        monthlySavings: props.netSavings || 0,
                        term: props.term || '1 Year'
                    });
                    if (recs.length >= 20) break;
                }
                recommendations = recs;
            } catch (e: any) {
                console.warn("[Commitments] recommendations query failed:", e.message);
            }

            return { utilization, coverage, hasReservations, activeReservations, reservationDetails, recommendations };
        }, 43200);

        // Write-through de historial diario (best-effort, solo tenants reales).
        recordDailySnapshotAsync(tenantId, 'commitments', {
            utilization: Number(data.utilization || 0),
            coverage: Number(data.coverage || 0),
            activeReservations: Number(data.activeReservations || 0),
            recommendationsCount: Array.isArray(data.recommendations) ? data.recommendations.length : 0,
        });

        return NextResponse.json({ success: true, data });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Commitments Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

