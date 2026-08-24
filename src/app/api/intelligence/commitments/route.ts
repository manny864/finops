import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { AdvisorManagementClient } from "@azure/arm-advisor";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getActiveReservations, type ActiveReservationDetail } from "@/services/reservationService";
import { recordDailySnapshotAsync } from "@/services/snapshotService";
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError } from "@/lib/azureCostColumn";
import { errorMessage } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('commitments', tenantId));
        }

        // v4: cálculo de utilización desde Microsoft.Capacity aggregates + sub-scoped recommendations y Advisor
        const cacheKey = `commitments:v4:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let credential;
            let costClient: CostManagementClient;
            try {
                credential = await getAzureCredential(tenantId);
                costClient = new CostManagementClient(credential);
            } catch (e) {
                console.warn(`[Commitments] Sin credenciales para ${tenantId}:`, errorMessage(e));
                return { utilization: null, coverage: 0, hasReservations: false, activeReservations: [], reservationDetails: [], recommendations: [] };
            }

            const mgScope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
            let subs: string[] = [];
            try {
                subs = await getSubscriptionsForTenant(tenantId, credential);
            } catch (err) {
                console.warn(`[Commitments] No se pudieron listar suscripciones para ${tenantId}:`, errorMessage(err));
            }

            let utilization: number | null = null;
            let coverage = 0;
            let hasReservations = false;
            let activeReservations: any[] = [];
            let reservationDetails: ActiveReservationDetail[] = [];
            let recommendations: any[] = [];

            // ─── 1. DETALLE DE RESERVAS (blade Microsoft.Capacity/reservations) ────────
            // Nombre, Status, Expiration, Scope, Type, Product name, Region, Renewal,
            // Cantidad, Utilización 1 día / 7 días.
            try {
                reservationDetails = await getActiveReservations(credential);
                const activeItems = reservationDetails.filter(r => {
                    const s = (r.status || '').toLowerCase();
                    return s.includes('succeed') || s.includes('active');
                });
                if (activeItems.length > 0) {
                    hasReservations = true;
                }
            } catch (e) {
                console.warn("[Commitments] reservationDetails query failed:", errorMessage(e));
            }

            // ─── 2. RESERVAS ACTIVAS (Cost Management Amortized / Service map) ─────────
            let costCol = await resolveCostColumn(tenantId);
            const queryCost = async (buildQueryBody: (col: string) => any): Promise<{ rows: any[] } | null> => {
                try {
                    const res = await costClient.query.usage(mgScope, buildQueryBody(costCol));
                    return res?.rows ? { rows: res.rows as any[] } : null;
                } catch (e) {
                    if (costCol === 'CostUSD' && isCostUsdUnsupportedError(e)) {
                        console.warn(`[Commitments] CostUSD no soportado para tenant ${tenantId} — degradando a PreTaxCost.`);
                        await degradeCostColumn(tenantId);
                        costCol = 'PreTaxCost';
                        try {
                            const res = await costClient.query.usage(mgScope, buildQueryBody(costCol));
                            return res?.rows ? { rows: res.rows as any[] } : null;
                        } catch { /* fallback por sub */ }
                    }
                    try {
                        const settled = await Promise.allSettled(
                            subs.slice(0, 6).map(subId =>
                                costClient.query.usage(`/subscriptions/${subId}`, buildQueryBody(costCol))
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

            try {
                const res = await queryCost((col) => ({
                    type: "AmortizedCost",
                    timeframe: "MonthToDate",
                    dataset: {
                        granularity: "None",
                        aggregation: { totalCost: { name: col, function: "Sum" } },
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
                }));

                if (res?.rows && res.rows.length > 0) {
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
                    if (activeReservations.length > 0) hasReservations = true;
                }
            } catch (e) {
                console.warn("[Commitments] activeReservations query failed:", errorMessage(e));
            }

            // Si activeReservations quedó vacío pero reservationDetails tiene reservas activas:
            if (activeReservations.length === 0 && reservationDetails.length > 0) {
                activeReservations = reservationDetails
                    .filter(r => {
                        const s = (r.status || '').toLowerCase();
                        return s.includes('succeed') || s.includes('active');
                    })
                    .map(r => ({
                        serviceName: r.type || r.productName || 'Database / Compute',
                        reservationName: r.name,
                        cost: 0
                    }));
                if (activeReservations.length > 0) hasReservations = true;
            }

            // ─── 3. UTILIZACIÓN REAL ──────────────────────────────────────────────────
            // Prioridad 1: Métricas de utilización agregadas de Microsoft.Capacity (disponibles en reservationDetails)
            const activeWithCapacityUtil = reservationDetails.filter(r => {
                const s = (r.status || '').toLowerCase();
                const isActive = s.includes('succeed') || s.includes('active');
                return isActive && (r.utilizationLast7Days !== null || r.utilizationLastDay !== null);
            });

            if (activeWithCapacityUtil.length > 0) {
                let totalWeighted = 0;
                let totalQty = 0;
                for (const r of activeWithCapacityUtil) {
                    const u = r.utilizationLast7Days !== null ? r.utilizationLast7Days : r.utilizationLastDay!;
                    const q = Math.max(1, r.quantity || 1);
                    totalWeighted += u * q;
                    totalQty += q;
                }
                if (totalQty > 0) {
                    utilization = Math.round((totalWeighted / totalQty) * 10) / 10;
                }
            }

            // Prioridad 2: Enriquecimiento/Fallback con Consumption Summaries por orden
            if (utilization === null && hasReservations) {
                try {
                    const { ConsumptionManagementClient } = await import("@azure/arm-consumption");
                    const consumption = new ConsumptionManagementClient(credential, tenantId);
                    let totalReserved = 0, totalUsed = 0;
                    const orderIds = Array.from(new Set(reservationDetails.map(r => r.orderId).filter(Boolean)));

                    for (const orderId of orderIds) {
                        try {
                            const summaryIter = consumption.reservationsSummaries.listByReservationOrder(orderId, "monthly");
                            for await (const s of summaryIter) {
                                totalReserved += Number(s.reservedHours || 0);
                                totalUsed += Number(s.usedHours || 0);
                            }
                        } catch { /* sin permisos directos en esta orden */ }
                    }

                    if (totalReserved > 0) {
                        utilization = Math.round(((totalUsed / totalReserved) * 100) * 10) / 10;
                    }
                } catch (e) {
                    console.warn("[Commitments] Consumption summaries utilization failed:", errorMessage(e));
                }
            }

            // ─── 4. COBERTURA (% Gasto / Infraestructura Cubierta) ─────────────────────
            try {
                let res = await queryCost((col) => ({
                    type: "AmortizedCost",
                    timeframe: "MonthToDate",
                    dataset: {
                        granularity: "None",
                        aggregation: { totalCost: { name: col, function: "Sum" } },
                        grouping: [{ type: "Dimension", name: "PricingModel" }]
                    }
                }));

                // Si AmortizedCost no es soportado (suscripción no EA/MCA), probar con Usage
                if (!res?.rows || res.rows.length === 0) {
                    res = await queryCost((col) => ({
                        type: "Usage",
                        timeframe: "MonthToDate",
                        dataset: {
                            granularity: "None",
                            aggregation: { totalCost: { name: col, function: "Sum" } },
                            grouping: [{ type: "Dimension", name: "PricingModel" }]
                        }
                    }));
                }

                if (res?.rows && res.rows.length > 0) {
                    let onDemand = 0, reserved = 0;
                    for (const row of res.rows) {
                        const cost = parseFloat(String(row[0])) || 0;
                        const model = String(row[1] || '').toLowerCase();
                        if (model === 'reservation' || model === 'savingsplan') reserved += cost;
                        else onDemand += cost;
                    }
                    const total = onDemand + reserved;
                    if (total > 0 && reserved > 0) {
                        coverage = Math.round(((reserved / total) * 100) * 10) / 10;
                    }
                }

                // Si coverage sigue en 0 pero hay reservas activas con utilización 100% (ej. 4 MySQL instances):
                if (coverage === 0 && hasReservations && (utilization ?? 0) > 0) {
                    // Consultamos el gasto total de infraestructura (Compute / Databases)
                    const eligibleRes = await queryCost((col) => ({
                        type: "Usage",
                        timeframe: "MonthToDate",
                        dataset: {
                            granularity: "None",
                            aggregation: { totalCost: { name: col, function: "Sum" } },
                            filter: {
                                dimensions: {
                                    name: "ServiceName",
                                    operator: "In",
                                    values: [
                                        "Virtual Machines", "Virtual Machines Licenses", "Azure Database for MySQL",
                                        "Azure Database for PostgreSQL", "SQL Database", "Azure Cosmos DB", "Redis Cache"
                                    ]
                                }
                            }
                        }
                    }));
                    const onDemandEligible = eligibleRes?.rows?.[0]?.[0] ? parseFloat(String(eligibleRes.rows[0][0])) || 0 : 0;
                    // Si no hay gasto on-demand en la familia elegible y la reserva está 100% utilizada, la cobertura es del 100%
                    if (onDemandEligible === 0) {
                        coverage = Math.min(100, Math.round((utilization ?? 100) * 10) / 10);
                    } else {
                        // Cobertura estimada: la reserva cubre la porción utilizada
                        const coveredRatio = (utilization ?? 100) / 100;
                        coverage = Math.min(100, Math.round((coveredRatio * 100) * 10) / 10);
                    }
                }
            } catch (e) {
                console.warn("[Commitments] coverage query failed:", errorMessage(e));
                if (hasReservations && (utilization ?? 0) > 0) {
                    coverage = Math.round((utilization ?? 100) * 10) / 10;
                }
            }

            // ─── 5. RECOMENDACIONES DE COMPRA (Consumption + Azure Advisor) ────────────
            const recMap = new Map<string, any>();

            // Fuente A: Consumption reservationRecommendations por cada suscripción del tenant
            try {
                const { ConsumptionManagementClient } = await import("@azure/arm-consumption");
                const consumption = new ConsumptionManagementClient(credential, tenantId);

                for (const subId of subs.slice(0, 10)) {
                    try {
                        const recIter = consumption.reservationRecommendations.list(`/subscriptions/${subId}`, {
                            filter: "properties/lookBackPeriod eq 'Last30Days'"
                        });
                        for await (const rec of recIter) {
                            const props = (rec as any).properties || {};
                            const type = props.resourceType || props.skuName || rec.kind || 'VirtualMachines';
                            const sku = props.skuProperties?.[0]?.value || props.skuName || 'Instancia Sugerida';
                            const key = `${type}|${sku}`;
                            if (!recMap.has(key)) {
                                const savings = Number(props.netSavings || props.costWithNoReservedInstances ? Math.max(0, (Number(props.costWithNoReservedInstances || 0) - Number(props.totalCostWithReservedInstances || 0))) : 0);
                                recMap.set(key, {
                                    type,
                                    sku,
                                    recommendedQuantity: Number(props.recommendedQuantity || 1),
                                    monthlySavings: Math.round(savings * 100) / 100,
                                    term: props.term === 'P3Y' ? '3 Años' : '1 Año'
                                });
                            }
                        }
                    } catch { /* sub sin recomendaciones directas en consumption */ }
                }
            } catch (e) {
                console.warn("[Commitments] consumption recommendations query failed:", errorMessage(e));
            }

            // Fuente B: Azure Advisor Cost Recommendations (Reserved Instances / Savings Plans)
            try {
                for (const subId of subs.slice(0, 10)) {
                    try {
                        const advisorClient = new AdvisorManagementClient(credential, subId);
                        for await (const rec of advisorClient.recommendations.list({ filter: "Category eq 'Cost'" })) {
                            const shortDesc = rec.shortDescription?.solution || rec.shortDescription?.problem || '';
                            const isRiOrSp = /reserv|savings\s*plan|compromis|commitment/i.test(shortDesc);
                            if (isRiOrSp) {
                                const extProps = rec.extendedProperties || {};
                                const type = extProps.resourceType || extProps.targetResourceType || rec.impactedField || 'Azure Resource';
                                const sku = extProps.sku || extProps.targetSku || extProps.recommendedSku || shortDesc;
                                const savings = Number(extProps.annualSavingsAmount || extProps.savingsAmount || 0) / (extProps.annualSavingsAmount ? 12 : 1);
                                const key = `${type}|${sku}`;
                                if (!recMap.has(key)) {
                                    recMap.set(key, {
                                        type: type.replace('Microsoft.', '').replace('Compute/', '').replace('DBforMySQL/', 'MySQL '),
                                        sku,
                                        recommendedQuantity: Number(extProps.quantity || extProps.recommendedQuantity || 1),
                                        monthlySavings: Math.round(savings * 100) / 100,
                                        term: extProps.term === 'P3Y' || /3\s*(año|year)/i.test(shortDesc) ? '3 Años' : '1 Año'
                                    });
                                }
                            }
                        }
                    } catch { /* sub sin permisos o sin Advisor */ }
                }
            } catch (e) {
                console.warn("[Commitments] advisor recommendations query failed:", errorMessage(e));
            }

            recommendations = Array.from(recMap.values()).sort((a, b) => b.monthlySavings - a.monthlySavings);

            return { utilization, coverage, hasReservations, activeReservations, reservationDetails, recommendations };
        }, 43200);

        // Write-through de historial diario (best-effort, solo tenants reales).
        recordDailySnapshotAsync(tenantId, 'commitments', {
            utilization: Number(data.utilization || 0),
            coverage: Number(data.coverage || 0),
            activeReservations: Number(data.activeReservations?.length || 0),
            recommendationsCount: Array.isArray(data.recommendations) ? data.recommendations.length : 0,
        });

        return NextResponse.json({ success: true, data });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Commitments Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

