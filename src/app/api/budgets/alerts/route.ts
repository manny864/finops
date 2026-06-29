import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

const MOCK_RULES = [
    {
        id: "mock-alert-1",
        ruleName: "Budget Alert > 80%",
        ruleType: "budget",
        thresholdValue: 80,
        thresholdUnit: "percent",
        channel: "email",
        channelTarget: "ops@company.com",
        enabled: true,
        lastTriggeredAt: "2026-06-15T10:00:00Z",
        triggerCount: 3,
    },
    {
        id: "mock-alert-2",
        ruleName: "Cost Anomaly Detection",
        ruleType: "anomaly",
        thresholdValue: 25,
        thresholdUnit: "percent",
        channel: "teams",
        channelTarget: "https://hooks.teams.example/webhook-1",
        enabled: true,
        lastTriggeredAt: "2026-06-20T08:30:00Z",
        triggerCount: 7,
    },
    {
        id: "mock-alert-3",
        ruleName: "Forecast Overrun Warning",
        ruleType: "forecast",
        thresholdValue: 110,
        thresholdUnit: "percent",
        channel: "slack",
        channelTarget: "#finops-alerts",
        enabled: false,
        lastTriggeredAt: null,
        triggerCount: 0,
    },
    {
        id: "mock-alert-4",
        ruleName: "Threshold $5000 USD",
        ruleType: "threshold",
        thresholdValue: 5000,
        thresholdUnit: "usd",
        channel: "webhook",
        channelTarget: "https://hooks.example.com/finops",
        enabled: true,
        lastTriggeredAt: "2026-06-28T01:00:00Z",
        triggerCount: 1,
    },
];

function authCheck(request: NextRequest, tenantId: string): NextResponse | null {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
    }
    const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
    if (!decoded || !decoded.tid) {
        return NextResponse.json({ error: "Token inválido." }, { status: 401 });
    }
    const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
    const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
    if (decoded.tid !== tenantId && !isSuperAdmin) {
        return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
    }
    return null;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        const authErr = authCheck(request, tenantId);
        if (authErr) return authErr;

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, rules: MOCK_RULES });
        }

        try {
            const [rows]: any = await pool.query(
                `SELECT ar.id, ar.rule_name AS ruleName, ar.rule_type AS ruleType,
                        ar.threshold_value AS thresholdValue, ar.threshold_unit AS thresholdUnit,
                        ar.channel, ar.channel_target AS channelTarget, ar.enabled,
                        ar.last_triggered_at AS lastTriggeredAt, ar.trigger_count AS triggerCount,
                        ar.budget_id AS budgetId, b.cost_center_tag_value AS budgetName
                 FROM AlertRules ar
                 LEFT JOIN Budgets b ON b.id = ar.budget_id
                 WHERE ar.tenant_id = ?
                 ORDER BY ar.created_at DESC`,
                [tenantId]
            );
            return NextResponse.json({ success: true, mock: false, rules: rows });
        } catch {
            return NextResponse.json({ success: true, mock: true, rules: MOCK_RULES });
        }
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Error interno" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        const authErr = authCheck(request, tenantId);
        if (authErr) return authErr;

        const body = await request.json();
        const { ruleName, ruleType, thresholdValue, thresholdUnit, comparisonOperator, channel, channelTarget, scopeSubscriptionId, budgetId } = body;

        if (!ruleName || !ruleType || thresholdValue == null || !channel || !channelTarget) {
            return NextResponse.json({ error: "Faltan campos obligatorios." }, { status: 400 });
        }

        // Reglas tipo "budget" deben apuntar a un Budget específico.
        if (ruleType === "budget" && !budgetId) {
            return NextResponse.json({ error: "Para reglas de tipo Presupuesto debe seleccionarse un Budget." }, { status: 400 });
        }

        if (isMockTenant(tenantId)) {
            console.log("[AlertRules][mock] POST skipped for mock tenant:", tenantId);
            return NextResponse.json({ success: true, mock: true, id: `mock-${Date.now()}` });
        }

        try {
            const [result]: any = await pool.query(
                `INSERT INTO AlertRules
                    (tenant_id, rule_name, rule_type, scope_subscription_id, budget_id, threshold_value, threshold_unit,
                     comparison_operator, channel, channel_target, enabled, trigger_count, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
                [
                    tenantId,
                    ruleName,
                    ruleType,
                    scopeSubscriptionId || null,
                    ruleType === "budget" ? Number(budgetId) : null,
                    thresholdValue,
                    thresholdUnit || "percent",
                    comparisonOperator || "gt",
                    channel,
                    channelTarget,
                    "api",
                ]
            );
            return NextResponse.json({ success: true, mock: false, id: result.insertId });
        } catch {
            console.log("[AlertRules][fallback] POST fallback to mock for tenant:", tenantId);
            return NextResponse.json({ success: true, mock: true, id: `mock-${Date.now()}` });
        }
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Error interno" }, { status: 500 });
    }
}
