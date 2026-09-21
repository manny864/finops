/**
 * POST /api/analytics/self-service-alerts/test
 * Motor de Prueba de Entrega (Test Payload Engine)
 *
 * RBAC: `requireTenantRole(['Admin','Owner'])`, igual que crear/editar/borrar una
 * regla en la ruta hermana. Era `requireTenantAccess` (cualquier miembro) y eso
 * lo convertia en la UNICA operacion mutante del modulo abierta a un Reader
 * --mutante porque dispara un POST saliente desde nuestra infraestructura hacia
 * una URL que manda el cliente en el body. Ver SEC-01 de
 * docs/security/audit-2026-09-21.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { testAlertRuleDelivery } from "@/services/azureSelfServiceAlerts.service";
import { SelfServiceAlertRule } from "@/types/azureSelfServiceAlerts.types";
import { errorMessage } from "@/lib/apiErrors";

export async function POST(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    const locale = request.nextUrl.searchParams.get("locale") || request.headers.get("x-locale") || "es";
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    const isMock = isMockTenant(tenantId);

    if (!isMock) {
      await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
    }

    const rule: SelfServiceAlertRule = await request.json();

    if (!rule || !rule.notificationChannel) {
      return NextResponse.json({ error: "Regla de alerta no válida para la prueba." }, { status: 400 });
    }

    const testResult = await testAlertRuleDelivery(rule, isMock, locale);

    return NextResponse.json(testResult);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API SelfServiceAlerts:Test] Error:", errorMessage(error));
    return NextResponse.json(
      {
        success: false,
        httpStatusCode: 500,
        responseMessage: `Error al probar la entrega: ${errorMessage(error)}`,
        messageKey: "testError",
        messageParams: { error: errorMessage(error) },
        testedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
