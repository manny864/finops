/**
 * GET /api/analytics/scorecard
 * FinOps Scorecard — Responsabilidad Financiera por Equipo
 *
 * Ruta NUEVA, separada de la legacy /api/intelligence/scorecard: aquella esta
 * interceptada por el monkey-patch de modo demo en TenantProvider y sirve otra
 * forma de respuesta.
 *
 * RBAC: `isMockTenant` ANTES del guard (rama mock de literales puros) y
 * requireTenantAccess para tenants reales.
 * RBAC Azure minimo: `Reader` (inventario y tags) + `Cost Management Reader`
 * (gasto y cobertura por tag). Sin permisos de escritura.
 */

import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError, type CostColumn } from "@/lib/azureCostColumn";
import { withArgLimit } from "@/lib/argConcurrency";
import { getResourceCostsById } from "@/services/azureResourcesInventory.service";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  assembleLiveScorecard,
  getMockScorecardPayload,
  normalizeTeamName,
  type RawTeamResource,
} from "@/services/azureScorecard.service";

/** Tags que se consideran obligatorias para la higiene del pilar 1. */
const REQUIRED_TAGS = ["CostCenter", "Environment", "Owner"];

/** Tag que define la pertenencia a un equipo, en el orden en que se busca. */
const TEAM_TAG_KEYS = ["CostCenter", "costCenter", "Department", "Team"];

/**
 * Zombis detectables con Resource Graph solo: discos sin adjuntar, NICs sin
 * asociar e IPs publicas sin vincular. Otros tipos requieren telemetria y se
 * dejan fuera en vez de adivinarse.
 */
const ZOMBIE_QUERY = `
  resources
  | where (type =~ 'microsoft.compute/disks' and tostring(properties.diskState) == 'Unattached')
     or (type =~ 'microsoft.network/networkinterfaces' and isnull(properties.virtualMachine))
     or (type =~ 'microsoft.network/publicipaddresses' and isnull(properties.ipConfiguration))
  | project id, name, subscriptionId
`;

const INVENTORY_QUERY = `
  resources
  | project id, name, type, resourceGroup, subscriptionId, tags
`;

interface TeamCostRow {
  spend: number;
  reserved: number;
}

/**
 * Gasto y cobertura de compromisos por valor de tag, en una sola consulta a
 * Cost Management por suscripcion: agrupar por TagKey + PricingModel devuelve
 * ambas metricas juntas y evita una segunda pasada sobre el mismo periodo.
 * Se usa AmortizedCost porque con ActualCost la compra de una reserva aparece
 * como un pico puntual y distorsionaria el gasto mensual del equipo.
 */
async function fetchSpendAndCoverageByTeam(tenantId: string, tagKey: string): Promise<Map<string, TeamCostRow>> {
  const out = new Map<string, TeamCostRow>();
  const subs = await getSubscriptionsForTenant(tenantId);
  if (subs.length === 0) return out;

  const credential = await getAzureCredential(tenantId);
  const client = new CostManagementClient(credential);
  const col: CostColumn = await resolveCostColumn(tenantId);

  const buildOptions = (useCol: CostColumn) =>
    ({
      type: "AmortizedCost",
      timeframe: "MonthToDate",
      dataset: {
        granularity: "None",
        aggregation: { totalCost: { name: useCol, function: "Sum" } },
        grouping: [
          { type: "TagKey", name: tagKey },
          { type: "Dimension", name: "PricingModel" },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

  await Promise.all(
    subs.map(async (subId) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let res: any;
        try {
          res = await client.query.usage(`/subscriptions/${subId}`, buildOptions(col));
        } catch (e) {
          if (col === "CostUSD" && isCostUsdUnsupportedError(e)) {
            await degradeCostColumn(tenantId);
            res = await client.query.usage(`/subscriptions/${subId}`, buildOptions("PreTaxCost"));
          } else {
            throw e;
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cols: any[] = res?.columns || [];
        const costIdx = cols.findIndex((c) => /cost/i.test(c.name));
        const tagIdx = cols.findIndex((c) => /tag/i.test(c.name));
        const modelIdx = cols.findIndex((c) => c.name === "PricingModel");
        if (costIdx < 0 || tagIdx < 0) return;

        for (const row of res?.rows || []) {
          const raw = String(row[tagIdx] ?? "");
          // Azure devuelve "key:value", o "key:" para los recursos sin esa tag.
          const value = raw.includes(":") ? raw.split(":").slice(1).join(":").trim() : raw.trim();
          const team = normalizeTeamName(value);
          const cost = Number(row[costIdx]) || 0;
          const model = modelIdx >= 0 ? String(row[modelIdx] ?? "").toLowerCase() : "";
          const entry = out.get(team) || { spend: 0, reserved: 0 };
          entry.spend += cost;
          if (model === "reservation" || model === "savingsplan") entry.reserved += cost;
          out.set(team, entry);
        }
      } catch (e) {
        console.warn(`[Scorecard] costo por tag fallo en la suscripcion ${subId}:`, errorMessage(e));
      }
    })
  );

  return out;
}

/** Presupuestos mensuales por centro de costo, normalizados al equipo canonico. */
async function fetchBudgetsByTeam(tenantId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows]: any = await pool.query(
      "SELECT cost_center_name, monthly_budget_usd FROM CostCenterBudgets WHERE tenant_id = ?",
      [tenantId]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (rows as any[]) || []) {
      const team = normalizeTeamName(r.cost_center_name);
      const amount = Number(r.monthly_budget_usd) || 0;
      // Varios alias del mismo equipo comparten un unico techo presupuestario.
      out.set(team, (out.get(team) || 0) + amount);
    }
  } catch (e) {
    console.warn("[Scorecard] lectura de CostCenterBudgets fallo:", errorMessage(e));
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockScorecardPayload(tenantId));
    }

    await requireTenantAccess(request, tenantId);

    const payload = await getWithStaleWhileRevalidate(
      `scorecard:v2:${tenantId}`,
      async () => {
        const credential = await getAzureCredential(tenantId).catch(() => null);
        if (!credential) {
          // Estado vacio legitimo: nunca el dataset demo (Directiva 24.1).
          return assembleLiveScorecard({
            resources: [],
            budgetsByTeam: new Map(),
            coverageByTeam: new Map(),
          });
        }

        const client = await getResourceGraphClient(tenantId);
        const [invRes, zombieRes] = await withArgLimit(async () =>
          Promise.all([client.resources({ query: INVENTORY_QUERY }), client.resources({ query: ZOMBIE_QUERY })])
        );

        const zombieRows = (zombieRes.data || []) as Array<{ id?: string; subscriptionId?: string }>;
        const zombieIds = new Set(zombieRows.map((r) => String(r.id || "").toLowerCase()));

        // El costo por recurso solo se resuelve para los zombies: es un
        // conjunto acotado, y pedirlo para el inventario completo dispararia
        // cientos de consultas para un dato que el pilar de gasto ya obtiene
        // agregado por tag.
        const [teamCosts, budgetsByTeam, zombieCosts] = await Promise.all([
          fetchSpendAndCoverageByTeam(tenantId, "CostCenter").catch((e) => {
            console.warn("[Scorecard] gasto por equipo no disponible:", errorMessage(e));
            return new Map<string, TeamCostRow>();
          }),
          fetchBudgetsByTeam(tenantId),
          zombieRows.length > 0
            ? getResourceCostsById(
                tenantId,
                zombieRows.map((r) => ({ id: String(r.id || ""), subscriptionId: String(r.subscriptionId || "") }))
              ).catch(() => new Map<string, number>())
            : Promise.resolve(new Map<string, number>()),
        ]);

        const resources: RawTeamResource[] = ((invRes.data || []) as Array<Record<string, unknown>>).map((row) => {
          const tags = (row.tags || {}) as Record<string, unknown>;
          const teamTag = TEAM_TAG_KEYS.map((k) => tags[k]).find((v) => typeof v === "string" && v.trim()) ?? "";
          const id = String(row.id || "");
          const lower = id.toLowerCase();
          return {
            teamTag,
            resourceName: String(row.name || ""),
            // "Etiquetado" significa tener TODAS las obligatorias, no solo una:
            // un recurso con CostCenter pero sin Environment sigue sin poder
            // asignarse correctamente en el showback por ambiente.
            isTagged: REQUIRED_TAGS.every((t) => {
              const v = tags[t] ?? tags[t.charAt(0).toLowerCase() + t.slice(1)];
              return typeof v === "string" && v.trim().length > 0;
            }),
            // El gasto del equipo llega agregado por tag desde Cost Management;
            // a nivel de recurso solo se conoce el de los zombies.
            monthlySpendUSD: zombieCosts.get(lower) || 0,
            isZombie: zombieIds.has(lower),
          };
        });

        const spendByTeam = new Map<string, number>();
        const coverageByTeam = new Map<string, number>();
        for (const [team, v] of teamCosts.entries()) {
          spendByTeam.set(team, Number(v.spend.toFixed(2)));
          coverageByTeam.set(team, v.spend > 0 ? Number(((v.reserved / v.spend) * 100).toFixed(1)) : 0);
        }

        return assembleLiveScorecard({ resources, spendByTeam, budgetsByTeam, coverageByTeam });
      },
      43200
    );

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Scorecard] Error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno procesando el scorecard" }, { status: 500 });
  }
}
