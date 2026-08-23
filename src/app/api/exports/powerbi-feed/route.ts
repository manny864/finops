/**
 * Power BI data feed (Feature G).
 *
 * Endpoint que Power BI consume via "Get Data > Web" usando un MCP API key
 * en el header. Reutiliza la misma auth y los mismos handlers que /api/mcp
 * para minimizar duplicación, pero devuelve formato plano JSON tabular
 * en lugar del envoltorio JSON-RPC.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import pool from "@/modules/storage/db";
import { resolvePeriodRange } from "@/lib/invoicingPeriod";
import { errorMessage } from '@/lib/apiErrors';

function hashKey(plain: string): string {
    return crypto.createHash("sha256").update(plain).digest("hex");
}

async function authenticate(request: NextRequest): Promise<string | null> {
    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
    const token = authHeader.slice(7).trim();
    if (!token.startsWith("mcp_")) return null;
    const hash = hashKey(token);

    try {
        const [rows] = await pool.query(
            `SELECT tenant_id FROM MCPApiKeys WHERE key_hash=? AND revoked_at IS NULL LIMIT 1`,
            [hash]
        );
        const arr = rows as Array<{ tenant_id: string }>;
        return arr.length > 0 ? arr[0].tenant_id : null;
    } catch { return null; }
}

async function feedCosts(tenantId: string, days: number) {
    try {
        const [rows] = await pool.query(
            `SELECT
                DATE(COALESCE(cs.ChargePeriodStart, cs.date)) AS date,
                COALESCE(cs.service_name, 'General') AS service,
                COALESCE(cs.subscription_id, 'default') AS subscriptionName,
                COALESCE(cs.resource_group, '*') AS resourceGroup,
                COALESCE(cs.ResourceId, cs.MeterName, cs.service_name, 'Resource') AS resourceName,
                SUM(COALESCE(cs.EffectiveCost, cs.BilledCost, cs.cost_usd, 0)) AS costUSD
             FROM CostSnapshots cs
             WHERE cs.tenant_id = ?
               AND DATE(COALESCE(cs.ChargePeriodStart, cs.date)) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             GROUP BY DATE(COALESCE(cs.ChargePeriodStart, cs.date)), cs.service_name, cs.subscription_id, cs.resource_group, cs.ResourceId, cs.MeterName
             ORDER BY date ASC`,
            [tenantId, days]
        );
        if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch {
        // Fallback si la tabla CostSnapshots no responde
    }

    const [legacyRows] = await pool.query(
        `SELECT
            sync_date as date,
            'General' as service,
            'default' as subscriptionName,
            '*' as resourceGroup,
            'All Resources' as resourceName,
            total_cost_usd as costUSD
         FROM cost_snapshots
         WHERE tenant_id=? AND sync_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         ORDER BY sync_date ASC`,
        [tenantId, days]
    );
    return legacyRows;
}

async function feedInvoicing(tenantId: string, period: string) {
    const { start, end } = resolvePeriodRange(period);
    // Mismo shape/columnas que /api/admin/report/invoicing — el key ya trae
    // el tenant_id resuelto server-side (authenticate()), así que no hay
    // forma de que un caller pida datos de otro tenant vía este endpoint.
    const [rows] = await pool.query(
        `SELECT
            DATE(COALESCE(cs.ChargePeriodStart, cs.date)) AS date,
            cs.customer_id AS customerId,
            cs.subscription_id AS subscriptionId,
            cs.service_name AS service,
            cs.resource_group AS resourceGroup,
            SUM(COALESCE(cs.EffectiveCost, cs.BilledCost, cs.cost_usd, 0)) AS originalCost
         FROM CostSnapshots cs
         WHERE cs.tenant_id = ?
           AND DATE(COALESCE(cs.ChargePeriodStart, cs.date)) BETWEEN ? AND ?
         GROUP BY DATE(COALESCE(cs.ChargePeriodStart, cs.date)), cs.customer_id, cs.subscription_id, cs.service_name, cs.resource_group
         ORDER BY date ASC`,
        [tenantId, start, end]
    );
    return rows;
}

async function feedZombies(tenantId: string) {
    try {
        const [rows] = await pool.query(
            `SELECT resource_id, resource_type, location, COALESCE(resource_group, '*') as resource_group, estimated_monthly_cost_usd
             FROM zombies WHERE tenant_id=? AND resolved_at IS NULL`,
            [tenantId]
        );
        return rows;
    } catch { return []; }
}

async function feedBudgets(tenantId: string) {
    try {
        const [rows] = await pool.query(
            `SELECT name, amount_usd, period, actual_spend_usd
             FROM Budgets WHERE tenant_id=? AND active=1`,
            [tenantId]
        );
        return (rows as any[]).map(b => {
            const used = Number(b.actual_spend_usd) || 0;
            const total = Number(b.amount_usd) || 0;
            const pct = total > 0 ? (used / total) * 100 : 0;
            return {
                name: b.name, period: b.period,
                budgetUSD: total, spentUSD: used,
                usagePct: Math.round(pct * 10) / 10,
                status: pct >= 100 ? "exceeded" : pct >= 80 ? "warning" : "ok",
            };
        });
    } catch { return []; }
}

export async function GET(request: NextRequest) {
    const tenantId = await authenticate(request);
    if (!tenantId) {
        return NextResponse.json({ success: false, error: "Unauthorized: bearer mcp_ key required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "costs";
    const days = Math.min(Math.max(Number(searchParams.get("days")) || 90, 1), 365);

    try {
        if (type === "costs") {
            const data = await feedCosts(tenantId, days);
            return NextResponse.json({ success: true, type, days, data });
        }
        if (type === "invoicing") {
            const period = searchParams.get("period") || "last3m";
            const data = await feedInvoicing(tenantId, period);
            return NextResponse.json({ success: true, type, period, data });
        }
        if (type === "zombies") {
            const data = await feedZombies(tenantId);
            return NextResponse.json({ success: true, type, data });
        }
        if (type === "budgets") {
            const data = await feedBudgets(tenantId);
            return NextResponse.json({ success: true, type, data });
        }
        if (type === "sustainability") {
            // Para sustainability requiere SP de Azure — no se puede servir
            // estáticamente; devolvemos shape vacía con doc.
            return NextResponse.json({
                success: true,
                type,
                byRegion: [],
                note: "Sustainability data requiere onboarding completo. Usar el dashboard SaaS para verlo.",
            });
        }
        return NextResponse.json({ success: false, error: `Tipo no soportado: ${type}` }, { status: 400 });
    } catch (err) {
        return NextResponse.json({ success: false, error: errorMessage(err) || "Error" }, { status: 500 });
    }
}
