/**
 * MCP (Model Context Protocol) HTTP bridge.
 *
 * Expone un conjunto de herramientas READ-ONLY de FinOps a
 * agentes IA externos (Claude Desktop, Cursor, Copilot, Custom GPTs) vía JSON-RPC 2.0.
 *
 * Auth: header `Authorization: Bearer mcp_live_<key>`.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { authenticateMcpToken } from "@/services/mcpApiKey.service";
import { errorMessage } from "@/lib/apiErrors";
import { assembleLiveAnomalies } from "@/services/azureAnomalyDetection.service";
import { getActiveHardWaste } from "@/services/azureHardWaste.service";
import { motivoDelHallazgo } from "@/services/azureZombieAudit.service";
import { getBudgetStatuses } from "@/services/budgetUtilization.service";
import { getAdvisorExecutiveData } from "@/services/azureAdvisor.service";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

interface ToolDef {
    name: string;
    description: string;
    inputSchema: { type: "object"; properties: Record<string, any>; required?: string[] };
    handler: (args: Record<string, any>, tenantId: string) => Promise<any>;
}

async function authenticateMCP(request: NextRequest): Promise<{ tenantId: string; keyId: number } | null> {
    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
    const token = authHeader.slice(7).trim();
    return authenticateMcpToken(token);
}

/**
 * `get_waste_zombies` y `get_zombie_resources`: el desperdicio duro vigente del escaneo de Resource Graph (el que
 * cuentan la pantalla de Recursos Zombis y el reporte ejecutivo), de mayor a menor plata. Sólo difieren en el nombre
 * de la lista. En frío espera el escaneo (30 s o más). Si falla lo dice en `note` y lo registra: un vacío acá se lee
 * como "no hay desperdicio" (antes pedía la tabla `ZombieResources`, que no existe, y pasaba justo eso).
 */
function zombiesHandler(tool: string, lista: "waste" | "zombies"): ToolDef["handler"] {
    return async (_args, tenantId) => {
        try {
            const hallazgos = (await getActiveHardWaste(tenantId)).slice(0, 100);
            return {
                count: hallazgos.length,
                [lista]: hallazgos.map((r) => ({
                    id: r.id,
                    subscription_id: r.subscriptionId,
                    resource_name: r.name,
                    resource_type: r.resourceType,
                    resource_group: r.resourceGroup,
                    region: r.location,
                    estimated_waste_usd: r.monthlySavingsUSD,
                    reason: motivoDelHallazgo(r),
                })),
            };
        } catch (e) {
            console.error(`[mcp] ${tool} falló:`, errorMessage(e));
            return { count: 0, [lista]: [], note: `No se pudo escanear Resource Graph: ${errorMessage(e) || "error desconocido"}` };
        }
    };
}

/**
 * `get_budgets_status` y `get_budget_status`: el límite sale de `Budgets` y el gasto del mes de Cost Management, por la
 * misma caché que la pantalla de Presupuestos. Un presupuesto cuyo gasto no se pudo leer sale con `spentUSD: null` y
 * `status: "unknown"`, no con 0. Si falla lo dice en `note` y lo registra (antes pedía columnas que `Budgets` no tiene).
 */
function budgetsHandler(tool: string): ToolDef["handler"] {
    return async (_args, tenantId) => {
        try {
            const budgets = await getBudgetStatuses(tenantId);
            return { count: budgets.length, budgets };
        } catch (e) {
            console.error(`[mcp] ${tool} falló:`, errorMessage(e));
            return { count: 0, budgets: [], note: `No se pudieron leer los presupuestos: ${errorMessage(e) || "error desconocido"}` };
        }
    };
}

const TOOLS: ToolDef[] = [
    {
        name: "get_cost_summary",
        description: "Resumen de costos del tenant: total, promedio diario, tendencia. Lee de cost_snapshots.",
        inputSchema: {
            type: "object",
            properties: { days: { type: "number", description: "Ventana en días (default 30, max 365)" } },
        },
        handler: async (args, tenantId) => {
            const days = Math.min(Math.max(Number(args.days) || 30, 1), 365);
            const [rows]: any = await pool.query(
                `SELECT sync_date as date, total_cost_usd as cost FROM cost_snapshots
                 WHERE tenant_id=? AND sync_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 ORDER BY sync_date ASC`,
                [tenantId, days]
            );
            const arr = (rows || []) as Array<{ date: string; cost: number }>;
            const total = arr.reduce((a, r) => a + Number(r.cost), 0);
            const avg = arr.length > 0 ? total / arr.length : 0;
            const first = arr[0]?.cost ? Number(arr[0].cost) : 0;
            const last = arr[arr.length - 1]?.cost ? Number(arr[arr.length - 1].cost) : 0;
            const trendPct = first > 0 ? ((last - first) / first) * 100 : 0;
            return {
                days,
                totalCostUSD: Math.round(total * 100) / 100,
                avgDailyUSD: Math.round(avg * 100) / 100,
                trendPct: Math.round(trendPct * 10) / 10,
                pointCount: arr.length,
            };
        },
    },
    {
        name: "get_top_resources",
        description: "Top N recursos más caros del último período (30 días).",
        inputSchema: {
            type: "object",
            properties: { limit: { type: "number", description: "Cantidad (default 10, max 100)" } },
        },
        handler: async (args, tenantId) => {
            const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 100);
            try {
                const [rows]: any = await pool.query(
                    `SELECT service_name, resource_group, SUM(cost_usd) as total
                     FROM CostSnapshots
                     WHERE tenant_id=? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                     GROUP BY service_name, resource_group
                     ORDER BY total DESC
                     LIMIT ?`,
                    [tenantId, limit]
                );
                return {
                    period: "30d",
                    resources: (rows || []).map((r: any) => ({
                        serviceName: r.service_name,
                        resourceGroup: r.resource_group,
                        costUSD: Math.round(Number(r.total) * 100) / 100,
                    })),
                };
            } catch (e) {
                return { period: "30d", resources: [], note: `Tabla no disponible: ${errorMessage(e) || "?"}` };
            }
        },
    },
    {
        name: "get_waste_zombies",
        description:
            "Recursos huérfanos y desperdicio detectado (discos sin VM, IPs públicas inactivas, snapshots viejos). " +
            "Lee el escaneo vivo de Resource Graph: el primer pedido tras 15 min sin uso puede tardar más de 30 s.",
        inputSchema: { type: "object", properties: {} },
        handler: zombiesHandler("get_waste_zombies", "waste"),
    },
    {
        name: "get_zombie_resources",
        description: "Alias de get_waste_zombies para compatibilidad hacia atrás.",
        inputSchema: { type: "object", properties: {} },
        handler: zombiesHandler("get_zombie_resources", "zombies"),
    },
    {
        name: "get_anomalies_feed",
        description: "Feed de anomalías de gasto detectadas recientemente para el tenant.",
        inputSchema: {
            type: "object",
            properties: { limit: { type: "number", description: "Cantidad de anomalías (default 20, max 100)" } },
        },
        handler: async (args, tenantId) => {
            const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
            try {
                // `Anomalies` no guarda servicio, severidad ni desvío: la causa sale de `top_contributors`, la severidad
                // del z-score y el desvío de monto y esperado. `assembleLiveAnomalies` es el ensamblado de la pantalla.
                const [rows]: any = await pool.query(
                    `SELECT id, subscription_id, DATE_FORMAT(date, '%Y-%m-%d') AS date, amount, expected_amount, z_score,
                            top_contributors, status
                     FROM Anomalies
                     WHERE tenant_id=?
                     ORDER BY Anomalies.date DESC LIMIT ?`,
                    [tenantId, limit]
                );
                const { anomalies } = assembleLiveAnomalies({ dailyCosts: [], dbAnomalies: rows || [] }).summary;
                return {
                    count: anomalies.length,
                    anomalies: anomalies.map((a) => ({
                        id: Number(a.id),
                        detected_date: a.detectionDate,
                        service_name: a.rootCauses[0]?.serviceName || null,
                        actual_cost_usd: a.actualCostUSD,
                        expected_cost_usd: a.expectedCostUSD,
                        deviation_percentage:
                            a.expectedCostUSD > 0
                                ? Math.round(((a.actualCostUSD - a.expectedCostUSD) / a.expectedCostUSD) * 10000) / 100
                                : 0,
                        severity: a.severity,
                        status: a.state,
                    })),
                };
            } catch (e) {
                // La tabla existe: lo que falló es la lectura. Se registra para que no sea sólo "no hay anomalías".
                console.error("[mcp] get_anomalies_feed falló:", errorMessage(e));
                return { count: 0, anomalies: [], note: `No se pudieron leer las anomalías: ${errorMessage(e) || "error desconocido"}` };
            }
        },
    },
    {
        name: "get_budgets_status",
        description: "Estado de presupuestos del tenant — % consumido por budget y alertas activas.",
        inputSchema: { type: "object", properties: {} },
        handler: budgetsHandler("get_budgets_status"),
    },
    {
        name: "get_budget_status",
        description: "Alias de get_budgets_status para compatibilidad hacia atrás.",
        inputSchema: { type: "object", properties: {} },
        handler: budgetsHandler("get_budget_status"),
    },
    {
        name: "get_recommendations",
        description: "Recomendaciones activas de optimización (rightsizing, reservas, apagado programado).",
        inputSchema: {
            type: "object",
            properties: { limit: { type: "number", description: "Default 20, max 100" } },
        },
        handler: async (args, tenantId) => {
            const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
            try {
                // No hay tabla de recomendaciones (esta tool pedía `recommendations`, que no existe): salen de Azure
                // Advisor, categoría Cost (rightsizing, reservas, apagado programado), las que siguen abiertas. Clave
                // de caché propia y no la de /api/advisor: esa guarda el texto reescrito con IA que ve la pantalla.
                const abiertas = await getWithStaleWhileRevalidate(
                    `mcp:advisor-cost:v1:${tenantId}`,
                    async () => {
                        const { recommendations } = await getAdvisorExecutiveData(tenantId, "es");
                        return recommendations.Cost.filter((r) => (r.status ?? "active") === "active").map((r) => ({
                            id: r.id,
                            kind: r.actionType,
                            resource_id: r.resourceId,
                            action_text: r.aiSuggestedAction?.actionTitle || r.titleTranslated,
                            estimated_savings_usd: r.monthlySavingsUSD,
                        }));
                    },
                    1800
                );
                const top = [...abiertas].sort((a, b) => b.estimated_savings_usd - a.estimated_savings_usd).slice(0, limit);
                return { count: top.length, recommendations: top };
            } catch (e) {
                console.error("[mcp] get_recommendations falló:", errorMessage(e));
                return {
                    count: 0,
                    recommendations: [],
                    note: `No se pudieron leer las recomendaciones de Azure Advisor: ${errorMessage(e) || "error desconocido"}`,
                };
            }
        },
    },
];

export async function POST(request: NextRequest) {
    const auth = await authenticateMCP(request);
    if (!auth) {
        return NextResponse.json({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unauthorized: invalid or missing MCP API key" },
            id: null,
        }, { status: 401 });
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
        }, { status: 400 });
    }

    const { method, params, id } = body;

    try {
        if (method === "tools/list") {
            return NextResponse.json({
                jsonrpc: "2.0",
                result: {
                    tools: TOOLS.map(t => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema,
                    })),
                },
                id,
            });
        }

        if (method === "tools/call") {
            const toolName = params?.name;
            const args = params?.arguments || {};
            const tool = TOOLS.find(t => t.name === toolName);
            if (!tool) {
                return NextResponse.json({
                    jsonrpc: "2.0",
                    error: { code: -32601, message: `Tool not found: ${toolName}` },
                    id,
                });
            }
            const result = await tool.handler(args, auth.tenantId);
            return NextResponse.json({
                jsonrpc: "2.0",
                result: {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                    isError: false,
                },
                id,
            });
        }

        if (method === "initialize") {
            return NextResponse.json({
                jsonrpc: "2.0",
                result: {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: {} },
                    serverInfo: { name: "finops-saas-mcp", version: "1.0.0" },
                },
                id,
            });
        }

        return NextResponse.json({
            jsonrpc: "2.0",
            error: { code: -32601, message: `Method not found: ${method}` },
            id,
        });
    } catch (err) {
        return NextResponse.json({
            jsonrpc: "2.0",
            error: { code: -32603, message: errorMessage(err) || "Internal error" },
            id,
        }, { status: 500 });
    }
}

export async function GET(_request: NextRequest) {
    return NextResponse.json({
        name: "finops-saas-mcp",
        version: "1.0.0",
        protocolVersion: "2024-11-05",
        description: "MCP bridge for FinOps SaaS — tenant-scoped read-only tools",
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
        usage: "POST with JSON-RPC 2.0. Methods: initialize, tools/list, tools/call",
    });
}
