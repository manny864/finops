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
        description: "Recursos huérfanos y desperdicio detectado (discos sin VM, IPs públicas inactivas, snapshots viejos).",
        inputSchema: { type: "object", properties: {} },
        handler: async (_args, tenantId) => {
            try {
                const [rows]: any = await pool.query(
                    `SELECT id, subscription_id, resource_name, resource_type, resource_group, region, estimated_waste_usd, reason
                     FROM ZombieResources
                     WHERE tenant_id=? AND status='active'
                     ORDER BY estimated_waste_usd DESC LIMIT 100`,
                    [tenantId]
                );
                return { count: (rows || []).length, waste: rows || [] };
            } catch {
                return { count: 0, waste: [], note: "Tabla ZombieResources no disponible" };
            }
        },
    },
    {
        name: "get_zombie_resources",
        description: "Alias de get_waste_zombies para compatibilidad hacia atrás.",
        inputSchema: { type: "object", properties: {} },
        handler: async (_args, tenantId) => {
            try {
                const [rows]: any = await pool.query(
                    `SELECT id, subscription_id, resource_name, resource_type, resource_group, region, estimated_waste_usd, reason
                     FROM ZombieResources
                     WHERE tenant_id=? AND status='active'
                     ORDER BY estimated_waste_usd DESC LIMIT 100`,
                    [tenantId]
                );
                return { count: (rows || []).length, zombies: rows || [] };
            } catch {
                return { count: 0, zombies: [], note: "Tabla ZombieResources no disponible" };
            }
        },
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
                const [rows]: any = await pool.query(
                    `SELECT id, detected_date, service_name, actual_cost_usd, expected_cost_usd, deviation_percentage, severity, status
                     FROM Anomalies
                     WHERE tenant_id=?
                     ORDER BY detected_date DESC LIMIT ?`,
                    [tenantId, limit]
                );
                return { count: (rows || []).length, anomalies: rows || [] };
            } catch {
                return { count: 0, anomalies: [], note: "Tabla Anomalies no disponible" };
            }
        },
    },
    {
        name: "get_budgets_status",
        description: "Estado de presupuestos del tenant — % consumido por budget y alertas activas.",
        inputSchema: { type: "object", properties: {} },
        handler: async (_args, tenantId) => {
            try {
                const [rows]: any = await pool.query(
                    `SELECT name, amount_usd, period, actual_spend_usd
                     FROM Budgets WHERE tenant_id=? AND active=1`,
                    [tenantId]
                );
                const budgets = (rows || []).map((b: any) => {
                    const used = Number(b.actual_spend_usd) || 0;
                    const total = Number(b.amount_usd) || 0;
                    const pct = total > 0 ? (used / total) * 100 : 0;
                    return {
                        name: b.name,
                        period: b.period,
                        budgetUSD: total,
                        spentUSD: used,
                        usagePct: Math.round(pct * 10) / 10,
                        status: pct >= 100 ? "exceeded" : pct >= 80 ? "warning" : "ok",
                    };
                });
                return { count: budgets.length, budgets };
            } catch {
                return { count: 0, budgets: [], note: "Tabla Budgets no disponible" };
            }
        },
    },
    {
        name: "get_budget_status",
        description: "Alias de get_budgets_status para compatibilidad hacia atrás.",
        inputSchema: { type: "object", properties: {} },
        handler: async (_args, tenantId) => {
            try {
                const [rows]: any = await pool.query(
                    `SELECT name, amount_usd, period, actual_spend_usd
                     FROM Budgets WHERE tenant_id=? AND active=1`,
                    [tenantId]
                );
                const budgets = (rows || []).map((b: any) => {
                    const used = Number(b.actual_spend_usd) || 0;
                    const total = Number(b.amount_usd) || 0;
                    const pct = total > 0 ? (used / total) * 100 : 0;
                    return {
                        name: b.name,
                        period: b.period,
                        budgetUSD: total,
                        spentUSD: used,
                        usagePct: Math.round(pct * 10) / 10,
                        status: pct >= 100 ? "exceeded" : pct >= 80 ? "warning" : "ok",
                    };
                });
                return { count: budgets.length, budgets };
            } catch {
                return { count: 0, budgets: [], note: "Tabla Budgets no disponible" };
            }
        },
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
                const [rows]: any = await pool.query(
                    `SELECT id, kind, resource_id, action_text, estimated_savings_usd
                     FROM recommendations
                     WHERE tenant_id=? AND status='open'
                     ORDER BY estimated_savings_usd DESC LIMIT ?`,
                    [tenantId, limit]
                );
                return { count: (rows || []).length, recommendations: rows || [] };
            } catch {
                return { count: 0, recommendations: [], note: "Tabla recommendations no disponible" };
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
