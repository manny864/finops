/**
 * GET /api/analytics/self-service-alerts
 * POST /api/analytics/self-service-alerts   (crear)
 * PUT /api/analytics/self-service-alerts    (editar — antes no existía y el
 *     modal de edición terminaba creando una regla nueva)
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

function tipoDeReglaEnDb(alertType: AlertRuleType): string {
  if (alertType === "BUDGET") return "budget";
  if (alertType === "ANOMALY_PERCENT") return "anomaly";
  if (alertType === "FORECAST_OVERRUN") return "forecast";
  return "threshold";
}

const TIPOS_DE_ALCANCE: AlertScopeType[] = ["TENANT", "SUBSCRIPTION", "RESOURCE_GROUP", "TAG"];

/**
 * El alcance vive en `scope_type`/`scope_value` desde 20260914-004. Las filas
 * anteriores sólo tienen `scope_subscription_id`, y las que escribe
 * /api/budgets/alerts lo siguen usando: por eso el respaldo.
 */
function alcanceDeFila(r: any): Pick<SelfServiceAlertRule, "scopeType" | "scopeValue" | "scopeValueKey"> {
  let tipo = TIPOS_DE_ALCANCE.includes(r.scope_type) ? (r.scope_type as AlertScopeType) : "TENANT";
  const valor = r.scope_value || r.scope_subscription_id || "";

  // `scope_type` quedo en su DEFAULT pero hay suscripcion: es una fila de
  // /api/budgets/alerts, que todavia escribe solo la columna vieja. Leerla como
  // "todo el tenant" mostraria un alcance que no es el que se guardo.
  if (tipo === "TENANT" && r.scope_subscription_id) tipo = "SUBSCRIPTION";

  if (tipo === "TENANT" || !valor) {
    return { scopeType: "TENANT", scopeValue: "Tenant Completo", scopeValueKey: "scopeTenant" };
  }
  return { scopeType: tipo, scopeValue: valor, scopeValueKey: undefined };
}

/** Normaliza lo que manda el cliente: un alcance sin valor es el tenant entero. */
function alcanceDelBody(body: any): { tipo: AlertScopeType; valor: string | null } {
  const tipo = TIPOS_DE_ALCANCE.includes(body.scopeType) ? (body.scopeType as AlertScopeType) : "TENANT";
  const valor = typeof body.scopeValue === "string" ? body.scopeValue.trim().slice(0, 255) : "";
  if (tipo === "TENANT" || !valor) return { tipo: "TENANT", valor: null };
  return { tipo, valor };
}

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
        `SELECT id, rule_name, rule_type, scope_subscription_id, scope_type, scope_value,
                threshold_value, threshold_unit, channel, channel_target, enabled, last_triggered_at,
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
          ...alcanceDeFila(r),
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

    const dbRuleType = tipoDeReglaEnDb(alertType);

    const alcance = alcanceDelBody({ scopeType, scopeValue });

    const [insertResult]: any = await pool.query(
      `INSERT INTO AlertRules
        (tenant_id, rule_name, rule_type, scope_type, scope_value, scope_subscription_id,
         threshold_value, threshold_unit, channel, channel_target, enabled, trigger_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [
        tenantId,
        name,
        dbRuleType,
        alcance.tipo,
        alcance.valor,
        // Se sigue escribiendo por compatibilidad: /api/budgets/alerts y las
        // filas viejas leen el alcance de acá.
        alcance.tipo === "SUBSCRIPTION" ? alcance.valor : null,
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

/**
 * PUT /api/analytics/self-service-alerts?tenantId=&ruleId=
 *
 * Editar no existía: el modal mandaba POST también al editar, así que "guardar"
 * sobre una regla existente creaba una segunda regla con los mismos datos.
 */
export async function PUT(request: NextRequest) {
  try {
    await initializeDatabase();
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    const ruleId = request.nextUrl.searchParams.get("ruleId");
    if (!tenantId || !ruleId) {
      return NextResponse.json({ error: "Falta tenantId o ruleId" }, { status: 400 });
    }

    const body = await request.json();
    const { name, alertType, thresholdValue, thresholdUnit, notificationChannel, channelTarget } = body;

    if (!name || !alertType || thresholdValue == null || !notificationChannel || !channelTarget) {
      return NextResponse.json({ error: "Faltan campos obligatorios para la regla." }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json({ success: true, mock: true, id: ruleId });
    }

    await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

    const alcance = alcanceDelBody(body);

    // El tenant va en el WHERE, no sólo el id: sin eso cualquiera con rol Admin
    // en su tenant podría editar la regla de otro pasando el id.
    const [res]: any = await pool.query(
      `UPDATE AlertRules
          SET rule_name = ?, rule_type = ?, scope_type = ?, scope_value = ?, scope_subscription_id = ?,
              threshold_value = ?, threshold_unit = ?, channel = ?, channel_target = ?
        WHERE id = ? AND tenant_id = ?`,
      [
        name,
        tipoDeReglaEnDb(alertType),
        alcance.tipo,
        alcance.valor,
        alcance.tipo === "SUBSCRIPTION" ? alcance.valor : null,
        Number(thresholdValue),
        thresholdUnit || "PERCENT",
        String(notificationChannel).toLowerCase(),
        channelTarget,
        ruleId,
        tenantId,
      ]
    );

    if (res.affectedRows === 0) {
      return NextResponse.json({ error: "La regla no existe en este tenant." }, { status: 404 });
    }

    return NextResponse.json({ success: true, id: ruleId });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API SelfServiceAlerts] PUT error:", errorMessage(error));
    return NextResponse.json({ error: "Error actualizando la regla" }, { status: 500 });
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
