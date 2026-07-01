import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('scorecard', tenantId));
        }

        const cacheKey = `scorecard:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let credential;
            let argClient;
            try {
                credential = await getAzureCredential(tenantId);
                argClient = new ResourceGraphClient(credential);
            } catch (e: any) {
                console.warn(`[Scorecard] Sin credenciales para ${tenantId}:`, e?.message);
                return [];
            }
            
            const scope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
            
            // Para la fase real, necesitamos ejecutar un query en ARG para encontrar:
            // 1. Recursos huérfanos por tag 'CostCenter'
            // 2. Faltantes de tag
            // Nota: Aquí se implementaría la lógica real usando la API de ARG para agrupar por tag.CostCenter.
            // Dada la complejidad sin acceso garantizado a los Management Groups del cliente,
            // si el cliente falla devolvemos datos vacíos, pero para tenants reales con scopes válidos funcionará.

            let teamsScorecard: any[] = [];
            try {
                // Consulta ARG ilustrativa
                const query = `
                    Resources
                    | extend costCenter = tostring(tags.CostCenter)
                    | extend costCenter = iff(isnotempty(costCenter), costCenter, "Untagged/Unknown")
                    | summarize totalResources = count(),
                                untaggedResources = countif(isnull(tags) or array_length(bag_keys(tags)) == 0)
                                by costCenter
                `;
                const response = await argClient.resources({ query, managementGroups: [tenantId] });
                
                if (response.data && Array.isArray(response.data)) {
                    teamsScorecard = response.data.map((row: any) => {
                        let score = 100;
                        const penalties = [];
                        
                        // Penalización por falta de tags
                        const untaggedRatio = row.untaggedResources / row.totalResources;
                        if (untaggedRatio > 0.1) {
                            const penalty = Math.min(30, Math.floor(untaggedRatio * 100));
                            score -= penalty;
                            penalties.push({
                                reason: `Alta proporción de recursos sin etiquetas (${Math.floor(untaggedRatio * 100)}%)`,
                                impact: -penalty,
                                costImpact: 0 // Se necesitaría Cost Management API para cruzar costo
                            });
                        }

                        // Score final
                        score = Math.max(0, score);
                        return {
                            team: row.costCenter,
                            score,
                            totalCost: 0, // placeholder
                            penalties
                        };
                    });
                }
            } catch (err: any) {
                console.warn("Error consultando Resource Graph para Scorecard (Posible falta de permisos MG):", err.message);
            }

            // Ordenar por score descendente
            return teamsScorecard.sort((a, b) => b.score - a.score);

        }, 43200); // 12 hours TTL

        return NextResponse.json({ success: true, data });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Scorecard Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
