/**
 * GET  /api/governance/ha — Recomendaciones de Alta Disponibilidad.
 * POST /api/governance/ha — exime o reincorpora una recomendación.
 *
 * El escaneo ARG vive en `haService.evaluateHALive`; acá se lo traduce al
 * contrato del módulo, se cruzan las exenciones y se proyecta SLA y costo.
 *
 * RBAC: `isMockTenant` ANTES del guard — la rama mock devuelve literales puros.
 * Antes el guard corría primero y los tenants demo recibían 401.
 * Tier mínimo: Business (`/governance/ha` en routeTiers.ts).
 * RBAC Azure mínimo: `Reader`. Sin escritura sobre Azure.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate, invalidateCache } from "@/lib/cache";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { evaluateHALive } from "@/services/haService";
import { recordDailySnapshotAsync } from "@/services/snapshotService";
import {
  assembleLiveHa,
  deleteHaExemption,
  getHaExemptions,
  getMockHaPayload,
  mapHaItem,
  saveHaExemption,
  type RawHaItem,
} from "@/services/azureHighAvailability.service";
import { errorMessage } from "@/lib/apiErrors";

function isDemo(tenantId: string, searchParams: URLSearchParams): boolean {
  return (
    isMockTenant(tenantId) ||
    searchParams.get("mock") === "true" ||
    tenantId.startsWith("demo-") ||
    tenantId.startsWith("mock-")
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    if (isDemo(tenantId, searchParams)) {
      return NextResponse.json(getMockHaPayload(tenantId));
    }

    await requireTenantTier(request, tenantId, "Business");

    const payload = await getWithStaleWhileRevalidate(
      `ha:summary:v2:${tenantId}`,
      async () => {
        const credential = await getAzureCredential(tenantId).catch(() => null);
        if (!credential) {
          // Vacío legítimo, nunca el dataset demo (Directiva 24.1).
          return assembleLiveHa({ items: [], availableSubscriptions: [] });
        }

        const [live, subscriptions, subNames, exemptions] = await Promise.all([
          evaluateHALive(tenantId).catch((e) => {
            console.warn("[HA] evaluación ARG falló:", errorMessage(e));
            return { items: [] as RawHaItem[], counts: {} };
          }),
          getSubscriptionsForTenant(tenantId, credential).catch(() => [] as string[]),
          getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>()),
          getHaExemptions(tenantId),
        ]);

        const items = ((live.items || []) as RawHaItem[]).map((row) =>
          mapHaItem(row, { subscriptionNames: subNames, exemptions })
        );

        const assembled = assembleLiveHa({
          items,
          availableSubscriptions: subscriptions.map((id) => ({
            id,
            name: subNames.get(id.toLowerCase()) || id,
          })),
        });

        // Histórico diario (best-effort). Se registran los conteos ya netos de
        // exenciones, que es lo que la tendencia debería reflejar.
        recordDailySnapshotAsync(tenantId, "governance", {
          critical: assembled.summary.criticalCount,
          high: assembled.summary.highCount,
          medium: assembled.summary.mediumCount,
          low: assembled.summary.lowCount,
          total: assembled.summary.totalRecommendationsCount,
        });

        return assembled;
      },
      900,
      300
    );

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API HA] Error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno evaluando la alta disponibilidad" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId, action, recommendationId, resourceId, resourceName, issueCategory, reason, durationDays } =
      body || {};

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    if (!recommendationId) return NextResponse.json({ error: "Falta recommendationId" }, { status: 400 });

    if (isDemo(tenantId, new URL(request.url).searchParams)) {
      // El sandbox no persiste: la UI aplica el cambio de forma optimista.
      return NextResponse.json({
        success: true,
        mock: true,
        message: "Exención registrada en el entorno de demostración.",
      });
    }

    const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin"]);
    await requireTenantTier(request, tenantId, "Business");

    if (action === "REMOVE_EXEMPTION") {
      await deleteHaExemption(tenantId, recommendationId);
      await invalidateCache(`ha:summary:v2:${tenantId}`).catch(() => {});
      return NextResponse.json({ success: true, message: "Exención removida; la recomendación vuelve al tablero." });
    }

    if (action === "EXEMPT") {
      await saveHaExemption(
        tenantId,
        {
          recommendationId: String(recommendationId),
          resourceId: String(resourceId || ""),
          resourceName: String(resourceName || ""),
          issueCategory: String(issueCategory || ""),
          reason: String(reason || "").slice(0, 500),
          durationDays: durationDays ? Number(durationDays) : undefined,
        },
        identity.email || "admin"
      );
      await invalidateCache(`ha:summary:v2:${tenantId}`).catch(() => {});
      return NextResponse.json({ success: true, message: "Recomendación eximida." });
    }

    return NextResponse.json({ error: "Acción no reconocida (EXEMPT / REMOVE_EXEMPTION)" }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API HA] POST error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno procesando la exención" }, { status: 500 });
  }
}
