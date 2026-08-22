/**
 * Prorrateo de Costos Compartidos
 *
 *   GET    /api/analytics/allocation?tenantId=…
 *   POST   /api/analytics/allocation   (crear o reemplazar una regla)
 *   DELETE /api/analytics/allocation?tenantId=…&resourceName=…
 *
 * Ruta NUEVA, separada de la legacy /api/intelligence/allocation-rules: aquella
 * sirve otra forma de respuesta y esta interceptada por el monkey-patch de modo
 * demo en TenantProvider, asi que cambiarla habria roto ambas cosas.
 *
 * RBAC: `isMockTenant` ANTES del guard (rama mock de literales puros). Lectura
 * con requireTenantAccess; la escritura exige requireTenantRole(['Admin','Owner'])
 * porque una regla de prorrateo redistribuye el gasto de todos los departamentos.
 *
 * RBAC Azure minimo: `Cost Management Reader` + `Reader`.
 */

import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate, invalidateCache } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import { resolveCostColumn, type CostColumn } from "@/lib/azureCostColumn";
import { errorMessage } from "@/lib/apiErrors";
import {
  deleteRule,
  fetchLiveAllocationData,
  getMockAllocationPayload,
  isValidResourceType,
  normalizeStrategy,
  saveRule,
  validateTargets,
} from "@/services/azureCostAllocation.service";

const CACHE_KEY = (tenantId: string) => `allocation:v1:cost-by-resource:${tenantId}`;

/** Costo mensual por nombre de recurso, desde Cost Management. */
async function fetchCostByResource(tenantId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  let credential;
  let subs: string[] = [];
  try {
    credential = await getAzureCredential(tenantId);
    subs = await getSubscriptionsForTenant(tenantId, credential);
  } catch (e) {
    console.warn(`[Allocation] Sin credenciales para ${tenantId}:`, errorMessage(e));
    return out;
  }
  if (subs.length === 0) return out;

  const client = new CostManagementClient(credential);
  const col: CostColumn = await resolveCostColumn(tenantId);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(1);

  for (const subId of subs) {
    try {
      const res = await client.query.usage(`subscriptions/${subId}`, {
        type: "ActualCost",
        timeframe: "Custom",
        timePeriod: { from: startDate, to: endDate },
        dataset: {
          granularity: "None",
          aggregation: { totalCost: { name: col, function: "Sum" } },
          grouping: [{ type: "Dimension", name: "ResourceId" }],
        },
      });
      for (const row of res.rows || []) {
        const cost = parseFloat(String(row[0]));
        const resourceId = String(row[1] || "");
        // Se indexa por NOMBRE, no por id: la tabla de reglas guarda el nombre
        // legible y el id completo no siempre esta disponible en reglas viejas.
        const name = (resourceId.split("/").pop() || "").toLowerCase();
        if (name) out[name] = (out[name] || 0) + (Number.isFinite(cost) ? cost : 0);
      }
    } catch (subErr) {
      console.error(`[Allocation] Costo por recurso de ${subId}:`, errorMessage(subErr));
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockAllocationPayload(tenantId));
    }

    await requireTenantAccess(request, tenantId);

    const costByResource = await getWithStaleWhileRevalidate(
      CACHE_KEY(tenantId),
      () => fetchCostByResource(tenantId),
      43200
    );

    const payload = await fetchLiveAllocationData(tenantId, new Map(Object.entries(costByResource || {})));
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Allocation] Error:", error);
    return NextResponse.json({ error: "Error interno procesando el prorrateo" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    if (isMockTenant(tenantId)) {
      return NextResponse.json({ success: true, mock: true });
    }

    // Una regla de prorrateo redistribuye gasto entre departamentos: no es una
    // accion de lectura ni de un usuario cualquiera del tenant.
    await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

    const body = await request.json();
    const sharedResourceName = String(body.sharedResourceName || "").trim();
    if (!sharedResourceName) {
      return NextResponse.json({ error: "Falta sharedResourceName" }, { status: 400 });
    }
    if (body.resourceType !== undefined && !isValidResourceType(body.resourceType)) {
      return NextResponse.json({ error: `resourceType invalido: ${String(body.resourceType)}` }, { status: 400 });
    }

    const targets = Array.isArray(body.targets) ? body.targets : [];
    const validation = validateTargets(targets);
    if (!validation.valid) {
      // 422 y no 400: el cuerpo es sintacticamente correcto, lo que falla es la
      // regla de negocio (suma > 100%, duplicados, negativos).
      return NextResponse.json({ error: "Regla invalida", details: validation.errors }, { status: 422 });
    }

    await saveRule({
      tenantId,
      ruleName: String(body.ruleName || sharedResourceName),
      sharedResourceId: String(body.sharedResourceId || ""),
      sharedResourceName,
      resourceType: isValidResourceType(body.resourceType) ? body.resourceType : "Other",
      strategy: normalizeStrategy(body.strategy),
      targets: targets.map((t: { targetCostCenterName: string; percentage: number }) => ({
        targetCostCenterName: String(t.targetCostCenterName).trim(),
        percentage: Number(t.percentage),
      })),
    });

    await invalidateCache(CACHE_KEY(tenantId)).catch(() => {});
    return NextResponse.json({ success: true, totalPercentage: validation.totalPercentage });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Allocation] POST Error:", error);
    return NextResponse.json({ error: "Error interno guardando la regla" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    const resourceName = request.nextUrl.searchParams.get("resourceName");
    if (!tenantId || !resourceName) {
      return NextResponse.json({ error: "Faltan tenantId o resourceName" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) return NextResponse.json({ success: true, mock: true });

    await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
    await deleteRule(tenantId, resourceName);
    await invalidateCache(CACHE_KEY(tenantId)).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Allocation] DELETE Error:", error);
    return NextResponse.json({ error: "Error interno eliminando la regla" }, { status: 500 });
  }
}
