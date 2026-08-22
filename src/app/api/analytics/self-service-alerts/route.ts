/**
 * GET /api/analytics/self-service-alerts
 * POST /api/analytics/self-service-alerts
 * DELETE /api/analytics/self-service-alerts
 *
 * RBAC: isMockTenant ANTES del guard RBAC para literales sintéticos puros.
 * Para tenants reales: requireTenantAccess / requireTenantRole y tolerancia cero a fallbacks mock.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  formatAlertThreshold,
  getMockSelfServiceAlertsPayload,
  assembleLiveSelfServiceAlerts,
} from "@/services/azureSelfServiceAlerts.service";
import {
  AlertRuleType,
  AlertScopeType,
  NotificationChannelType,
  SelfServiceAlertRule,
} from "@/types/azureSelfServiceAlerts.types";

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockSelfServiceAlertsPayload(tenantId));
    }

    await requireTenantAccess(request, tenantId);

    try {
      const [rows]: any = await pool.query(
        `SELECT id, rule_name, rule_type, scope_subscription_id, threshold_value,
                threshold_unit, channel, channel_target, enabled, last_triggered_at,
                trigger_count, created_at, updated_at
         FROM AlertRules
         WHERE tenant_id = ?
         ORDER BY created_at DESC`,
        [tenantId]
      );

      const rules: SelfServiceAlertRule[] = (rows || []).map((r: any) => {
        const alertType = (
          r.rule_type === "budget"
            ? "BUDGET"
            : r.rule_type === "anomaly"
              ? "ANOMALY_PERCENT"
              : r.rule_type === "forecast"
                ? "FORECAST_OVERRUN"
                : "FIXED_THRESHOLD"
        ) as AlertRuleType;

        const thresholdValue = Number(r.threshold_value || 0);
        const thresholdUnit = (r.threshold_unit?.toUpperCase() === "PERCENT" ? "PERCENT" : "USD") as "PERCENT" | "USD";
        const channel = (r.channel?.toUpperCase() || "EMAIL") as NotificationChannelType;

        return {
          id: String(r.id),
          name: r.rule_name || "Regla de Alerta",
          alertType,
          scopeType: (r.scope_subscription_id ? "SUBSCRIPTION" : "TENANT") as AlertScopeType,
          scopeValue: r.scope_subscription_id || "Tenant Completo",
          thresholdValue,
          thresholdUnit,
          formattedThreshold: formatAlertThreshold(alertType, thresholdValue, thresholdUnit),
          notificationChannel: channel,
          channelConfig: {
            channelTarget: r.channel_target || "",
            webhookUrl: channel === "WEBHOOK" || channel === "TEAMS" || channel === "SLACK" ? r.channel_target : undefined,
            recipients: channel === "EMAIL" ? (r.channel_target ? [r.channel_target] : []) : undefined,
            serviceNowEndpoint: channel === "SERVICENOW" ? r.channel_target : undefined,
          },
          isEnabled: Boolean(r.enabled),
          lastFiredTimestamp: r.last_triggered_at ? new Date(r.last_triggered_at).toISOString() : null,
          fireCount: Number(r.trigger_count || 0),
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        };
      });

      return NextResponse.json(assembleLiveSelfServiceAlerts(rules));
    } catch (dbErr) {
      console.error("[API SelfServiceAlerts] Database query error:", errorMessage(dbErr));
      return NextResponse.json(assembleLiveSelfServiceAlerts([]));
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API SelfServiceAlerts] GET error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error interno cargando reglas de alerta" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    const body = await request.json();

    // 1. Manejo de Toggle / Update de Estado
    if (body.action === "TOGGLE_STATE") {
      const { ruleId, isEnabled } = body;
      if (!ruleId) {
        return NextResponse.json({ error: "Falta ruleId" }, { status: 400 });
      }

      if (isMockTenant(tenantId)) {
        return NextResponse.json({ success: true, mock: true, ruleId, isEnabled });
      }

      await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

      await pool.query(
        `UPDATE AlertRules SET enabled = ? WHERE id = ? AND tenant_id = ?`,
        [isEnabled ? 1 : 0, ruleId, tenantId]
      );

      return NextResponse.json({ success: true, ruleId, isEnabled });
    }

    // 2. Creación de Nueva Regla
    const {
      name,
      alertType,
      scopeType,
      scopeValue,
      thresholdValue,
      thresholdUnit,
      notificationChannel,
      channelTarget,
    } = body;

    if (!name || !alertType || thresholdValue == null || !notificationChannel || !channelTarget) {
      return NextResponse.json({ error: "Faltan campos obligatorios para la regla." }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        mock: true,
        id: `mock-${Date.now()}`,
        message: "Regla creada en entorno de demostración.",
      });
    }

    await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

    const dbRuleType =
      alertType === "BUDGET"
        ? "budget"
        : alertType === "ANOMALY_PERCENT"
          ? "anomaly"
          : alertType === "FORECAST_OVERRUN"
            ? "forecast"
            : "threshold";

    const [insertResult]: any = await pool.query(
      `INSERT INTO AlertRules
        (tenant_id, rule_name, rule_type, scope_subscription_id, threshold_value, threshold_unit, channel, channel_target, enabled, trigger_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [
        tenantId,
        name,
        dbRuleType,
        scopeType === "SUBSCRIPTION" ? scopeValue : null,
        Number(thresholdValue),
        thresholdUnit || "PERCENT",
        String(notificationChannel).toLowerCase(),
        channelTarget,
      ]
    );

    return NextResponse.json({
      success: true,
      id: String(insertResult.insertId),
      message: "Regla de alerta guardada con éxito.",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API SelfServiceAlerts] POST error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error procesando solicitud de regla" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeDatabase();
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    const ruleId = request.nextUrl.searchParams.get("ruleId");

    if (!tenantId || !ruleId) {
      return NextResponse.json({ error: "Faltan parámetros tenantId o ruleId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json({ success: true, mock: true, ruleId });
    }

    await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

    await pool.query(
      `DELETE FROM AlertRules WHERE id = ? AND tenant_id = ?`,
      [ruleId, tenantId]
    );

    return NextResponse.json({ success: true, ruleId });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API SelfServiceAlerts] DELETE error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error eliminando regla de alerta" },
      { status: 500 }
    );
  }
}
