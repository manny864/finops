/**
 * Unit Economics — Costo Cloud contra Valor de Negocio
 *
 *   GET   /api/intelligence/unit-economics?tenantId=…&windowDays=30
 *   POST  /api/intelligence/unit-economics   (configuración + carga manual)
 *
 * RBAC: `isMockTenant` ANTES del guard (la rama mock son literales sintéticos
 * puros, sin I/O). Lectura con `requireTenantAccess`; la escritura de
 * configuración exige `requireTenantRole(['Admin','Owner'])`, porque cambiar la
 * meta de costo unitario altera las alertas de todo el tenant.
 *
 * RBAC Azure mínimo: `Cost Management Reader` sobre las suscripciones.
 *
 * La lógica vive en src/services/azureUnitEconomics.service.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate, invalidateCache } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import {
  resolveCostColumn,
  degradeCostColumn,
  isCostUsdUnsupportedError,
  type CostColumn,
} from "@/lib/azureCostColumn";
import { errorMessage } from "@/lib/apiErrors";
import {
  assembleLiveUnitEconomics,
  getMockUnitEconomicsPayload,
  getTenantConfig,
  isValidMetricType,
  normalizeIngestionMode,
  saveTenantConfig,
  upsertBusinessUnits,
} from "@/services/azureUnitEconomics.service";

/** Ventanas admitidas. Se acota para no dejar que el cliente pida 10 años. */
const ALLOWED_WINDOWS = [30, 90, 365];

function resolveWindow(raw: string | null): number {
  const n = Number(raw);
  return ALLOWED_WINDOWS.includes(n) ? n : 30;
}

/** Categoriza un nombre de servicio de Azure para el desglose de la tabla. */
function categorizeService(serviceName: string): string {
  const s = serviceName.toLowerCase();
  if (/virtual machine|app service|functions|container|kubernetes|batch|vmss/.test(s)) return "Cómputo";
  if (/sql|mysql|postgres|cosmos|redis|database|mariadb/.test(s)) return "Base de Datos";
  if (/storage|blob|disk|files|backup|archive/.test(s)) return "Almacenamiento";
  if (/network|bandwidth|front door|gateway|load balancer|dns|cdn|expressroute|vpn/.test(s)) return "Redes";
  if (/openai|cognitive|machine learning|search|foundry|bot/.test(s)) return "IA";
  return "Otros";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const windowDays = resolveWindow(searchParams.get("windowDays"));

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockUnitEconomicsPayload(tenantId, windowDays));
    }

    await requireTenantAccess(request, tenantId);

    // El gasto se cachea aparte del ensamblado: la configuración y el volumen de
    // negocio cambian mucho más seguido que la serie de Cost Management.
    const cacheKey = `unit_economics:v3:cost:${tenantId}:${windowDays}`;
    const costData = await getWithStaleWhileRevalidate(cacheKey, async () => {
      const daily: Record<string, number> = {};
      const byService: Record<string, number> = {};

      let credential;
      let costClient;
      let subs: string[] = [];
      try {
        credential = await getAzureCredential(tenantId);
        costClient = new CostManagementClient(credential);
        subs = await getSubscriptionsForTenant(tenantId, credential);
      } catch (e) {
        // Sin credenciales se devuelve vacío real; el ensamblado mostrará $0.00
        // y estado vacío legítimo, nunca el dataset demo (Directiva 24.1).
        console.warn(`[UnitEconomics] Sin credenciales para ${tenantId}:`, errorMessage(e));
        return { daily, byService };
      }
      if (subs.length === 0) return { daily, byService };

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (windowDays - 1));

      // CostUSD (normalizado por Azure) en vez de PreTaxCost (moneda de
      // facturación de la suscripción) — ver src/lib/azureCostColumn.ts.
      let activeCol: CostColumn = await resolveCostColumn(tenantId);
      const buildQuery = (col: CostColumn, groupByService: boolean) => ({
        type: "ActualCost",
        timeframe: "Custom",
        timePeriod: { from: startDate, to: endDate },
        dataset: {
          granularity: groupByService ? "None" : "Daily",
          aggregation: { totalCost: { name: col, function: "Sum" } },
          ...(groupByService
            ? { grouping: [{ type: "Dimension", name: "ServiceName" }] }
            : {}),
        },
      });

      for (const subId of subs) {
        const scope = `subscriptions/${subId}`;

        // 1. Serie diaria.
        try {
          let res;
          try {
            res = await costClient.query.usage(scope, buildQuery(activeCol, false));
          } catch (colErr) {
            if (activeCol === "CostUSD" && isCostUsdUnsupportedError(colErr)) {
              console.warn(`[UnitEconomics] CostUSD no soportado en ${tenantId}, degradando a PreTaxCost.`);
              await degradeCostColumn(tenantId);
              activeCol = "PreTaxCost";
              res = await costClient.query.usage(scope, buildQuery(activeCol, false));
            } else {
              throw colErr;
            }
          }
          for (const row of res.rows || []) {
            const cost = parseFloat(String(row[0]));
            const raw = String(row[1]);
            let date = raw;
            if (raw.length === 8) date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
            else if (raw.includes("T")) date = raw.split("T")[0];
            daily[date] = (daily[date] || 0) + (Number.isFinite(cost) ? cost : 0);
          }
        } catch (subErr) {
          console.error(`[UnitEconomics] Serie diaria de ${subId}:`, errorMessage(subErr));
        }

        // 2. Gasto por servicio, para la atribución del costo unitario.
        try {
          const res = await costClient.query.usage(scope, buildQuery(activeCol, true));
          for (const row of res.rows || []) {
            const cost = parseFloat(String(row[0]));
            const name = String(row[1] || "Otros");
            byService[name] = (byService[name] || 0) + (Number.isFinite(cost) ? cost : 0);
          }
        } catch (subErr) {
          console.error(`[UnitEconomics] Gasto por servicio de ${subId}:`, errorMessage(subErr));
        }
      }

      return { daily, byService };
    }, 43200);

    const payload = await assembleLiveUnitEconomics({
      tenantId,
      windowDays,
      dailyCosts: new Map(Object.entries(costData.daily || {})),
      serviceSpend: Object.entries(costData.byService || {})
        .filter(([, spend]) => spend > 0)
        .map(([serviceName, monthlySpendUSD]) => ({
          serviceName,
          serviceCategory: categorizeService(serviceName),
          monthlySpendUSD,
          // Cost Management no devuelve la serie diaria por servicio en la misma
          // consulta; sin ella la correlación con el volumen no se puede
          // calcular y la elasticidad queda como "Fixed" por defecto. Se prefiere
          // eso a inventar un perfil diario.
          associatedResourcesCount: 0,
        })),
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Unit Economics] Error:", error);
    return NextResponse.json({ error: "Error interno procesando Unit Economics" }, { status: 500 });
  }
}

/**
 * Guarda la configuración del módulo y, opcionalmente, un volumen diario
 * cargado a mano desde el drawer.
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      // El tenant demo no persiste nada: la configuración es de solo lectura.
      return NextResponse.json({ success: true, mock: true });
    }

    // Cambiar la meta de costo unitario altera las alertas de todo el tenant:
    // no es una acción de lectura.
    await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

    const body = await request.json();

    if (body.primaryMetric !== undefined && !isValidMetricType(body.primaryMetric)) {
      return NextResponse.json({ error: `metricType inválido: ${String(body.primaryMetric)}` }, { status: 400 });
    }

    const current = await getTenantConfig(tenantId);
    const targetCost = body.targetCostPerUnitUSD !== undefined ? Number(body.targetCostPerUnitUSD) : current.targetCostPerUnitUSD;
    const threshold = body.alertThresholdPercentage !== undefined ? Number(body.alertThresholdPercentage) : current.alertThresholdPercentage;

    if (!Number.isFinite(targetCost) || targetCost < 0) {
      return NextResponse.json({ error: "targetCostPerUnitUSD debe ser un número >= 0" }, { status: 400 });
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1000) {
      return NextResponse.json({ error: "alertThresholdPercentage debe estar entre 0 y 1000" }, { status: 400 });
    }

    await saveTenantConfig({
      tenantId,
      primaryMetric: body.primaryMetric ?? current.primaryMetric,
      targetCostPerUnitUSD: targetCost,
      alertThresholdPercentage: threshold,
      ingestionMode: body.ingestionMode ? normalizeIngestionMode(body.ingestionMode) : current.ingestionMode,
    });

    // Carga manual de volumen desde el mismo drawer.
    if (body.metricDate && body.unitCount !== undefined) {
      const unitCount = Number(body.unitCount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.metricDate))) {
        return NextResponse.json({ error: "metricDate debe tener formato YYYY-MM-DD" }, { status: 400 });
      }
      if (!Number.isFinite(unitCount) || unitCount < 0) {
        return NextResponse.json({ error: "unitCount debe ser un número >= 0" }, { status: 400 });
      }
      await upsertBusinessUnits({
        tenantId,
        metricDate: String(body.metricDate),
        metricType: body.primaryMetric ?? current.primaryMetric,
        unitCount,
        source: "Manual",
      });
    }

    // La serie cacheada mezcla gasto y configuración: invalidar para que el
    // siguiente GET refleje el cambio en vez de servir el valor viejo 12 horas.
    for (const w of ALLOWED_WINDOWS) {
      await invalidateCache(`unit_economics:v3:cost:${tenantId}:${w}`).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Unit Economics] POST Error:", error);
    return NextResponse.json({ error: "Error interno guardando la configuración" }, { status: 500 });
  }
}
