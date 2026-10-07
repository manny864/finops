import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { errorMessage } from '@/lib/apiErrors';
import { alcanceDeLaRuta } from "@/services/perspectivesData.service";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const identidad = await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('scorecard', tenantId));
        }

        // MEJ-34: el alcance transversal, sobre la misma ventana de 30 días que
        // usa el cruce de costo por CostCenter de más abajo.
        const alcance = await alcanceDeLaRuta(tenantId, request.nextUrl.searchParams, {
            where: "tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)",
            params: [tenantId],
        }, identidad.alcance ?? null);

        const cacheKey = `scorecard:${tenantId}`;
        const calcular = async () => {
            let credential;
            let argClient;
            try {
                credential = await getAzureCredential(tenantId);
                argClient = await getResourceGraphClient(tenantId, credential);
            } catch (e) {
                console.warn(`[Scorecard] Sin credenciales para ${tenantId}:`, errorMessage(e));
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
                    | extend costCenter = iff(isnotempty(costCenter), costCenter, "Untagged")
                    | summarize totalResources = count(),
                                untaggedResources = countif(isnull(tags) or array_length(bag_keys(tags)) == 0)
                                by costCenter
                `;
                const response = await argClient.resources({ query, managementGroups: [tenantId] });

                // Costo real por CostCenter (últimos 30 días), cruzando el tag
                // CostSnapshots.Tags.CostCenter — antes esto era un placeholder
                // fijo en 0 ("se necesitaría Cost Management API"), pero el dato
                // ya está persistido localmente vía el cron de sync diario.
                const costByTeam = new Map<string, number>();
                try {
                    const [costRows]: any = await pool.query(
                        `SELECT COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')), 'null'), 'Untagged') AS costCenter,
                                SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
                         FROM CostSnapshots
                         WHERE tenant_id = ?
                           AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                           ${alcance.and}
                         GROUP BY costCenter`,
                        [tenantId, ...alcance.params]
                    );
                    for (const r of (costRows as any[])) {
                        costByTeam.set(r.costCenter, Number(r.total) || 0);
                    }
                } catch (costErr) {
                    console.warn("[Scorecard] No se pudo cruzar costo por CostCenter:", errorMessage(costErr));
                }

                if (response.data && Array.isArray(response.data)) {
                    teamsScorecard = response.data.map((row: any) => {
                        let score = 100;
                        const penalties = [];
                        const totalCost = costByTeam.get(row.costCenter) || 0;

                        // Penalización por falta de tags
                        const untaggedRatio = row.untaggedResources / row.totalResources;
                        if (untaggedRatio > 0.1) {
                            const penalty = Math.min(30, Math.floor(untaggedRatio * 100));
                            score -= penalty;
                            penalties.push({
                                reason: `Alta proporción de recursos sin etiquetas (${Math.floor(untaggedRatio * 100)}%)`,
                                impact: -penalty,
                                costImpact: Number((totalCost * untaggedRatio).toFixed(2)),
                            });
                        }

                        // Score final
                        score = Math.max(0, score);
                        return {
                            team: row.costCenter,
                            score,
                            totalCost: Number(totalCost.toFixed(2)),
                            penalties
                        };
                    });
                }
            } catch (err) {
                console.warn("Error consultando Resource Graph para Scorecard (Posible falta de permisos MG):", errorMessage(err));
            }

            // Ordenar por score descendente
            return teamsScorecard.sort((a, b) => b.score - a.score);

        };

        // El recorte no se cachea: `cacheKey` no lo incluye, y con 12 h de TTL
        // una vista acotada serviría el tablero de otro grupo el resto del día.
        const data = alcance.aplicado
            ? await calcular()
            : await getWithStaleWhileRevalidate(cacheKey, calcular, 43200); // 12 hours TTL

        // MEJ-34: false con un alcance pedido = el costo por equipo es el del tenant entero.
        return NextResponse.json({ success: true, data, scopeApplied: alcance.aplicado });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Scorecard Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
