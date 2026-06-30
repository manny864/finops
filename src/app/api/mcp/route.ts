/**
 * MCP (Model Context Protocol) HTTP bridge.
 *
 * Expone un conjunto restringido de herramientas READ-ONLY de FinOps a
 * agentes IA externos (Claude Desktop via gateway, Copilot, GPTs).
 *
 * Auth: header `Authorization: Bearer mcp_<key>`.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import pool from "@/modules/storage/db";

interface ToolDef {
    name: string;
    description: string;
    inputSchema: { type: "object"; properties: Record<string, any>; required?: string[] };
    handler: (args: Record<string, any>, tenantId: string) => Promise<any>;
}

function hashKey(plain: string): string {
    return crypto.createHash("sha256").update(plain).digest("hex");
}

async function authenticateMCP(request: NextRequest): Promise<{ tenantId: string; keyId: number } | null> {
    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
    const token = authHeader.slice(7).trim();
    if (!token.startsWith("mcp_")) return null;
    const hash = hashKey(token);

    try {
        const [rows] = await pool.query(
            `SELECT id, tenant_id FROM MCPApiKeys WHERE key_hash=? AND revoked_at IS NULL LIMIT 1`,
            [hash]
        );
        const arr = rows as Array<{ id: number; tenant_id: string }>;
        if (arr.length === 0) return null;
        pool.query(`UPDATE MCPApiKeys SET last_used_at=NOW() WHERE id=?`, [arr[0].id]).catch(() => {});
        return { tenantId: arr[0].tenant_id, keyId: arr[0].id };
    } catch {
        return null;
    }
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
            const [rows] = await pool.query(
                `SELECT sync_date as date, total_cost_usd as cost FROM cost_snapshots
                 WHERE tenant_id=? AND sync_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 ORDER BY sync_date ASC`,
                [tenantId, days]
            );
            const arr = rows as Array<{ date: string; cost: number }>;
            const total = arr.reduce((a, r) => a + Number(r.cost), 0);
            const avg = arr.length > 0 ? total / arr.length : 0;
            const first = arr[0]?.cost ? Number(arr[0].cost) : 0;
            const last = arr[arr.length - 1]?.cost ? Number(arr[arr.length - 1].cost) : 0;
            const trendPct = first > 0 ? ((last - first) / first) * 100 : 0;
            return {
                days, totalCostUSD: Math.round(total * 100) / 100,
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
                const [rows] = await pool.query(
                    `SELECT resource_id, SUM(cost_usd) as total
                     FROM billing_facts
                     WHERE tenant_id=? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                     GROUP BY resource_id
                     ORDER BY total DESC
                     LIMIT ?`,
                    [tenantId, limit]
                );
                return {
                    period: "30d",
                    resources: (rows as any[]).map(r => ({
                        resourceId: r.resource_id,
                        costUSD: Math.round(Number(r.total) * 100) / 100,
                    })),
                };
            } catch (e: any) {
                return { period: "30d", resources: [], note: `Tabla no disponible: ${e?.message || "?"}` };
            }
        },
    },
    {
        name: "get_zombie_resources",
        description: "Recursos huérfanos detectados (discos no atados, etc).",
        inputSchema: { type: "object", properties: {} },
        handler: async (_args, tenantId) => {
            try {
                const [rows] = await pool.query(
                    `SELECT resource_id, resource_type, location, estimated_monthly_cost_usd
                     FROM zombies
                     WHERE tenant_id=? AND resolved_at IS NULL
                     ORDER BY estimated_monthly_cost_usd DESC LIMIT 100`,
                    [tenantId]
                );
                return { count: (rows as any[]).length, zombies: rows };
            } catch {
                return { count: 0, zombies: [], note: "Tabla zombies no disponible" };
            }
        },
    },
    {
        name: "get_recommendations",
        description: "Recomendaciones activas (rightsizing, RIs, schedule).",
        inputSchema: {
            type: "object",
            properties: { limit: { type: "number", description: "Default 20, max 100" } },
        },
        handler: async (args, tenantId) => {
            const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
            try {
                const [rows] = await pool.query(
                    `SELECT id, kind, resource_id, action_text, estimated_savings_usd
                     FROM recommendations
                     WHERE tenant_id=? AND status='open'
                     ORDER BY estimated_savings_usd DESC LIMIT ?`,
                    [tenantId, limit]
                );
                return { count: (rows as any[]).length, recommendations: rows };
            } catch {
                return { count: 0, recommendations: [], note: "Tabla recommendations no disponible" };
            }
        },
    },
    {
        name: "get_budget_status",
        description: "Estado de presupuestos del tenant — % consumido por budget.",
        inputSchema: { type: "object", properties: {} },
        handler: async (_args, tenantId) => {
            try {
                const [rows] = await pool.query(
                    `SELECT name, amount_usd, period, actual_spend_usd
                     FROM Budgets WHERE tenant_id=? AND active=1`,
                    [tenantId]
                );
                const budgets = (rows as any[]).map(b => {
                    const used = Number(b.actual_spend_usd) || 0;
                    const total = Number(b.amount_usd) || 0;
                    const pct = total > 0 ? (used / total) * 100 : 0;
                    return {
                        name: b.name, period: b.period, budgetUSD: total, spentUSD: used,
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
    try { body = await request.json(); }
    catch {
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
                        name: t.name, description: t.description, inputSchema: t.inputSchema,
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
    } catch (err: any) {
        return NextResponse.json({
            jsonrpc: "2.0",
            error: { code: -32603, message: err?.message || "Internal error" },
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
