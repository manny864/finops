import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
// RBAC: GET requiere pertenencia al tenant (read). POST (crear alert rule)
// requiere rol Admin/Owner, alineado con el DELETE en [id]/route.ts.

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });

    try {
        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Auth error" }, { status: 401 });
    }

    if (isMockTenant(tenantId)) {
        return NextResponse.json(getMockDataForRoute('alerts', tenantId));
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
    } catch (err: any) {
        // CRÍTICO: NUNCA devolver MOCK_RULES en un tenant real. Devolver lista vacía
        // con error explícito para que el frontend pueda mostrar estado vacío legítimo.
        console.error("[AlertRules] GET failed for real tenant:", tenantId, err?.message);
        return NextResponse.json({
            success: false,
            mock: false,
            rules: [],
            error: `No se pudieron cargar las reglas: ${err?.message || "error desconocido"}`,
        }, { status: 200 });
    }
}

export async function POST(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });

    try {
        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Auth error" }, { status: 401 });
    }

    const body = await request.json();
    const { ruleName, ruleType, thresholdValue, thresholdUnit, comparisonOperator, channel, channelTarget, scopeSubscriptionId, budgetId } = body;

    if (!ruleName || !ruleType || thresholdValue == null || !channel || !channelTarget) {
        return NextResponse.json({ error: "Faltan campos obligatorios." }, { status: 400 });
    }

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
    } catch (err: any) {
        // CRÍTICO: NUNCA falsificar success en tenant real. Devolver el error real.
        console.error("[AlertRules] POST failed for real tenant:", tenantId, err?.message);
        return NextResponse.json({
            success: false,
            error: `No se pudo crear la regla: ${err?.message || "error desconocido"}`,
        }, { status: 500 });
    }
}
