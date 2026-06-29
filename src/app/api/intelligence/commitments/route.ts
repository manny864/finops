import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: `Acceso denegado. El token no coincide con el tenant.` }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('commitments', tenantId));
        }

        const cacheKey = `commitments:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            const credential = await getAzureCredential(tenantId);
            const costClient = new CostManagementClient(credential);
            
            // Scope a nivel tenant o subscripcion dependiendo del acuerdo. 
            // Azure Cost Management para reservas requiere alcance de Enrollment (EA) o Billing Profile (MCA).
            // Lo intentamos al nivel de Management Group o Subscription. Si falla, manejamos el error devolviendo arrays vacíos.
            const scope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
            
            let utilization: number | null = null;
            let coverage = 0;
            let hasReservations = false;
            let recommendations: any[] = [];

            try {
                // Para obtener recomendaciones a través de Cost Management (esto puede fallar por falta de permisos en EA)
                const recs = await (costClient as any).generateReservationRecommendationDetails.default(scope, "Shared", "VirtualMachines", "Last30Days");
                if (recs && recs.value) {
                    recommendations = recs.value.slice(0, 10).map((r: any) => ({
                        type: r.type || 'VirtualMachines',
                        sku: r.skuProperties ? r.skuProperties[0].value : 'Desconocido',
                        recommendedQuantity: r.recommendedQuantity || 0,
                        monthlySavings: r.netSavings || 0,
                        term: r.term || '1-3 YR'
                    }));
                }
            } catch (e: any) {
                console.warn("Fallo al obtener recomendaciones de reserva (posiblemente falta Billing Scope):", e.message);
            }

            try {
                // Cálculo de Utilización de Reservas consultando Usage (AmortizedCost vs ActualCost)
                const costRes = await costClient.query.usage(scope, {
                    type: "AmortizedCost",
                    timeframe: "MonthToDate",
                    dataset: {
                        granularity: "None",
                        aggregation: {
                            totalCost: { name: "PreTaxCost", function: "Sum" }
                        },
                        grouping: [{ type: "Dimension", name: "PricingModel" }] // Muestra Reservation vs OnDemand
                    }
                });

                let onDemandCost = 0;
                let reservationCost = 0;

                if (costRes.rows) {
                    costRes.rows.forEach(row => {
                        const cost = parseFloat(row[0] as string);
                        const pricingModel = String(row[1]).toLowerCase();
                        if (pricingModel === 'reservation' || pricingModel === 'savingsplan') {
                            reservationCost += cost;
                        } else {
                            onDemandCost += cost;
                        }
                    });
                }
                
                const totalCompute = onDemandCost + reservationCost;
                if (totalCompute > 0) {
                    coverage = (reservationCost / totalCompute) * 100;
                    hasReservations = reservationCost > 0;
                }

            } catch (e: any) {
                console.warn("Fallo al obtener cobertura de reservas:", e.message);
            }

            // Utilización REAL de reservas vía Consumption API (ReservationsSummaries).
            // Solo se intenta si efectivamente hay cobertura de reservas, y requiere
            // permisos de Billing (EA/MCA). Si falla, devolvemos null (UI mostrará "no disponible").
            if (hasReservations) {
                try {
                    const { ConsumptionManagementClient } = await import("@azure/arm-consumption");
                    const consumption = new ConsumptionManagementClient(credential, tenantId);
                    let totalReserved = 0;
                    let totalUsed = 0;
                    const ordersSeen = new Set<string>();

                    // Iteramos summaries del mes actual a través de los reservation orders disponibles.
                    // La API requiere reservationOrderId, así que primero listamos las recomendaciones existentes
                    // que ya hayan generado órdenes. Si no podemos enumerarlas, dejamos utilization=null.
                    try {
                        const recIter = consumption.reservationRecommendations.list(scope);
                        for await (const rec of recIter) {
                            const orderId = (rec as any)?.properties?.reservationOrderId || (rec as any)?.reservationOrderId;
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

                    if (totalReserved > 0) {
                        utilization = (totalUsed / totalReserved) * 100;
                    }
                } catch (e: any) {
                    console.warn("No se pudo calcular utilización real de reservas:", e?.message);
                }
            }

            return {
                utilization,            // number | null
                coverage,
                hasReservations,
                recommendations
            };
        }, 43200);

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error("Commitments Error:", error);
        return NextResponse.json({ error: "Fallo al consultar compromisos financieros", details: error.message }, { status: 500 });
    }
}
