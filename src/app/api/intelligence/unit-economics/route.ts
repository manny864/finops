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
            return NextResponse.json(getMockDataForRoute('unit_economics', tenantId));
        }

        const cacheKey = `unit_economics:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            const credential = await getAzureCredential(tenantId);
            const costClient = new CostManagementClient(credential);
            
            // Limitamos a consultar el Management Group
            const scope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
            
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 29); // Last 30 days including today

            // 1. Obtener Costos Diarios (Azure Cost Management)
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

            // Parsear filas devueltas por Cost Management
            const dailyCosts = new Map<string, number>();
            if (costRes.rows) {
                costRes.rows.forEach(row => {
                    const cost = parseFloat(row[0] as string);
                    const usageDate = String(row[1]); // formato YYYYMMDD o YYYY-MM-DDT...
                    // Estandarizar fecha a YYYY-MM-DD
                    let formattedDate = usageDate;
                    if (usageDate.length === 8) {
                        formattedDate = `${usageDate.substring(0,4)}-${usageDate.substring(4,6)}-${usageDate.substring(6,8)}`;
                    } else if (usageDate.includes('T')) {
                        formattedDate = usageDate.split('T')[0];
                    }
                    dailyCosts.set(formattedDate, cost);
                });
            }

            // 2. Mock de DAUs (En producción esto vendría de Datadog, Google Analytics, DB, etc.)
            const finalData = [];
            for (let i = 29; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split('T')[0];
                
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                const cost = dailyCosts.get(dateStr) || 0;
                
                // Métrica de Negocio (Usuarios Activos Diarios - DAU) simulada
                const dau = isWeekend ? 35000 + Math.floor(Math.random() * 5000) : 55000 + Math.floor(Math.random() * 8000);
                
                finalData.push({
                    date: dateStr,
                    cost: cost,
                    dau: dau,
                    costPerUser: cost > 0 ? (cost / dau) : 0
                });
            }

            return finalData;

        }, 43200); // 12 hours TTL

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error("Unit Economics Error:", error);
        return NextResponse.json({ error: "Fallo al procesar métricas unitarias", details: error.message }, { status: 500 });
    }
}
