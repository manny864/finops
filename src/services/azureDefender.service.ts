/**
 * Microsoft Defender for Cloud — Cobertura por Recurso y FinOps de Planes
 *
 * RBAC minimo en Azure (Service Principal del tenant):
 *   - `Security Reader` para leer `Microsoft.Security/pricings`.
 *   - `Reader` para el inventario de recursos via Resource Graph.
 *   - `Security Admin` SOLO para cambiar el tier, que sigue viviendo en
 *     `setDefenderPlanTier` (src/modules/collectors/azure/defenderCostService.ts)
 *     y no se invoca desde aca: este servicio es de lectura.
 *
 * Lo que aporta sobre la consola nativa: Azure dice que planes estan en Standard,
 * pero no sobre que recursos se aplican ni cuales quedan afuera. Aca se cruzan
 * los pricings contra el inventario real para producir cobertura por recurso.
 */

import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { errorMessage } from "@/lib/apiErrors";
import {
  DEFENDER_CATEGORY_COLORS,
  DEFENDER_PLAN_CATALOG,
  DEFENDER_UNIT_PRICES,
  type DefenderAssociatedResource,
  type DefenderCoverageStatus,
  type DefenderPayload,
  type DefenderPlanCategory,
  type DefenderPlanItem,
  type DefenderPricingTier,
  type DefenderRemediationAction,
  type DefenderSubPlan,
  type DefenderSummaryMetrics,
  type ResourceEnvironment,
} from "@/types/azureDefender.types";

const ARM_BASE = "https://management.azure.com";
const SECURITY_API_VERSION = "2023-01-01";

// ─────────────────────────────────────────────────────────────────────────────
// Normalizacion de planes y entornos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traduce el nombre tecnico del pricing a su denominacion comercial.
 * Los planes que no estan en el catalogo conservan su nombre de Azure en vez de
 * caer a un "Other" generico, que era lo que hacia ilegible el tablero anterior.
 */
export function normalizePlanName(planKey: string): {
  displayName: string;
  category: DefenderPlanCategory;
  resourceTypes: string[];
} {
  const entry = DEFENDER_PLAN_CATALOG[planKey.toLowerCase()];
  if (entry) return entry;
  // Fallback legible: "SomeNewPlan" -> "Defender for Some New Plan".
  const spaced = planKey.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return { displayName: `Defender for ${spaced}`, category: "Other", resourceTypes: [] };
}

/** Normaliza el subPlan que Azure devuelve como `P1`/`P2` o `Plan1`/`Plan2`. */
export function normalizeSubPlan(raw: unknown): DefenderSubPlan | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "p1" || v === "plan1") return "Plan1";
  if (v === "p2" || v === "plan2") return "Plan2";
  return undefined;
}

/**
 * Clasifica el entorno de un recurso. Prioriza el tag `Environment` (fuente de
 * verdad segun src/lib/tagConfig.ts) y solo cae al nombre del grupo de recursos
 * cuando el tag falta.
 */
export function classifyEnvironment(
  resourceGroup: string,
  tags?: Record<string, unknown> | null
): ResourceEnvironment {
  const tagValue = tags
    ? String(
        tags.Environment ?? tags.environment ?? tags.Env ?? tags.env ?? tags.Ambiente ?? tags.ambiente ?? ""
      ).toLowerCase()
    : "";
  if (tagValue) {
    if (/^(prod|production|produccion|productivo|prd)$/.test(tagValue)) return "Production";
    if (/^(stg|stage|staging|preprod|pre-prod|uat)$/.test(tagValue)) return "Staging";
    if (/^(dev|development|desarrollo|test|testing|qa|sandbox|lab|poc)$/.test(tagValue)) return "Development";
  }
  const rg = resourceGroup.toLowerCase();
  if (/\b(stg|stage|staging|preprod|pre-prod|uat)\b/.test(rg)) return "Staging";
  if (/\b(dev|desarrollo|test|testing|qa|sandbox|lab|poc)\b/.test(rg)) return "Development";
  // Sin señal explicita se asume produccion: sub-clasificar como Dev un recurso
  // productivo llevaria a recomendar un downgrade de seguridad.
  return "Production";
}

/** Entorno dominante entre un conjunto de recursos. */
export function dominantEnvironment(resources: DefenderAssociatedResource[]): ResourceEnvironment {
  if (resources.length === 0) return "Production";
  const counts: Record<ResourceEnvironment, number> = { Production: 0, Development: 0, Staging: 0 };
  resources.forEach((r) => (counts[r.environment] += 1));
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as ResourceEnvironment) || "Production";
}

// ─────────────────────────────────────────────────────────────────────────────
// Costo y cobertura
// ─────────────────────────────────────────────────────────────────────────────

/** Precio unitario mensual del plan segun categoria y sub-plan. */
export function unitPriceFor(category: DefenderPlanCategory, subPlan?: DefenderSubPlan): number {
  if (category === "Servers") {
    return subPlan === "Plan1" ? DEFENDER_UNIT_PRICES.Servers_Plan1 : DEFENDER_UNIT_PRICES.Servers_Plan2;
  }
  return DEFENDER_UNIT_PRICES[category] ?? 0;
}

/**
 * Costo mensual del plan. Solo el tier Standard factura; en Free el costo es
 * cero real, no "sin datos".
 */
export function calcPlanMonthlyCost(
  tier: DefenderPricingTier,
  category: DefenderPlanCategory,
  subPlan: DefenderSubPlan | undefined,
  coveredResourcesCount: number
): number {
  if (tier !== "Standard") return 0;
  // Los planes sin recurso contable (ARM, CSPM a nivel suscripcion) igual
  // facturan una base: se cobra la unidad una vez.
  const units = coveredResourcesCount > 0 ? coveredResourcesCount : 1;
  return Number((unitPriceFor(category, subPlan) * units).toFixed(2));
}

export function deriveCoverageStatus(covered: number, uncovered: number): DefenderCoverageStatus {
  if (covered === 0) return "None";
  if (uncovered > 0) return "Partial";
  return "Full";
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de deteccion de fugas y riesgos
// ─────────────────────────────────────────────────────────────────────────────

export function generateDefenderRecommendations(plans: DefenderPlanItem[]): DefenderRemediationAction[] {
  const out: DefenderRemediationAction[] = [];

  for (const plan of plans) {
    // Regla 1 — Servers Plan 2 sobre VMs de Dev/Test.
    if (plan.category === "Servers" && plan.pricingTier === "Standard" && plan.subPlan === "Plan2") {
      const nonProd = plan.associatedResources.filter(
        (r) => r.isProtected && r.environment !== "Production"
      );
      if (nonProd.length > 0) {
        // Plan 2 añade EDR, evaluacion de vulnerabilidades y acceso JIT sobre
        // Plan 1. En Dev/Test el delta rara vez se justifica.
        const delta = DEFENDER_UNIT_PRICES.Servers_Plan2 - DEFENDER_UNIT_PRICES.Servers_Plan1;
        out.push({
          id: `downgrade-${plan.id}`,
          planKey: plan.planKey,
          subscriptionId: plan.subscriptionId,
          title: `Bajar a Plan 1 en ${nonProd.length} VM(s) de Dev/Staging`,
          description: `${nonProd.length} de ${plan.coveredResourcesCount} VMs protegidas con Plan 2 estan en entornos no productivos (${Array.from(
            new Set(nonProd.map((r) => r.resourceGroup))
          )
            .slice(0, 3)
            .join(", ")}). Plan 1 conserva la deteccion base y ahorra ${delta} USD/VM/mes. Nota: el tier de Defender for Servers se fija por suscripcion, asi que este cambio requiere separar las VMs no productivas en su propia suscripcion o usar exclusiones por recurso.`,
          category: "DOWNGRADE_SERVERS_TIER",
          estimatedSavingsUSD: Number((nonProd.length * delta).toFixed(2)),
          confidence: "MEDIUM",
          actionType: "SET_SERVERS_PLAN1",
        });
      }
    }

    // Regla 2 — Defender for Storage sobre cuentas de respaldo o logs.
    if (plan.category === "Storage" && plan.pricingTier === "Standard") {
      const coldAccounts = plan.associatedResources.filter(
        (r) => r.isProtected && /backup|respaldo|archive|archivo|logs?|diag|dump|export/i.test(r.resourceName)
      );
      if (coldAccounts.length > 0) {
        out.push({
          id: `exclude-storage-${plan.id}`,
          planKey: plan.planKey,
          subscriptionId: plan.subscriptionId,
          title: `Excluir ${coldAccounts.length} cuenta(s) de respaldo/logs de Defender for Storage`,
          description: `${coldAccounts.map((r) => r.resourceName).slice(0, 3).join(", ")}${
            coldAccounts.length > 3 ? "…" : ""
          } parecen cuentas frias de respaldo o diagnostico, sin exposicion externa. Defender for Storage cuesta ${DEFENDER_UNIT_PRICES.Storage} USD/cuenta/mes y su valor esta en detectar malware y accesos anomalos, escenarios que no aplican a un blob de backup interno. Confirmar que no reciben cargas de terceros antes de excluirlas.`,
          category: "EXCLUDE_STORAGE_BACKUP",
          estimatedSavingsUSD: Number((coldAccounts.length * DEFENDER_UNIT_PRICES.Storage).toFixed(2)),
          confidence: "MEDIUM",
          actionType: "EXCLUDE_STORAGE_ACCOUNT",
        });
      }
    }

    // Regla 3 — Bases de datos de produccion sin cobertura. NO es un ahorro:
    // es un riesgo de seguridad, y se reporta con ahorro cero para no mezclarlo
    // con las oportunidades de recorte.
    if (plan.category === "Databases" && plan.pricingTier === "Free") {
      const prodDbs = plan.associatedResources.filter((r) => r.environment === "Production");
      if (prodDbs.length > 0) {
        out.push({
          id: `enable-db-${plan.id}`,
          planKey: plan.planKey,
          subscriptionId: plan.subscriptionId,
          title: `RIESGO: ${prodDbs.length} base(s) de datos productivas sin proteccion avanzada`,
          description: `${plan.planDisplayName} esta en tier Free en ${plan.subscriptionName}, dejando ${prodDbs.length} instancia(s) de produccion sin deteccion de SQL injection, exfiltracion ni accesos anomalos. Activarlo cuesta ${DEFENDER_UNIT_PRICES.Databases} USD/instancia/mes. Esto es un hallazgo de riesgo, no una oportunidad de ahorro.`,
          category: "ENABLE_DB_PROTECTION",
          estimatedSavingsUSD: 0,
          confidence: "HIGH",
          actionType: "ENABLE_DB_STANDARD",
        });
      }
    }

    // Gobernanza de auto-provisioning: un plan Standard sin ningun recurso que
    // proteger suele venir de habilitacion masiva a nivel suscripcion.
    if (plan.pricingTier === "Standard" && plan.coveredResourcesCount === 0 && plan.category !== "CSPM" && plan.category !== "ResourceManager") {
      out.push({
        id: `govern-${plan.id}`,
        planKey: plan.planKey,
        subscriptionId: plan.subscriptionId,
        title: `${plan.planDisplayName} activo sin recursos que proteger en ${plan.subscriptionName}`,
        description:
          "El plan esta en Standard pero la suscripcion no tiene recursos de ese tipo. Es el patron tipico de habilitacion automatica a nivel suscripcion: no cobra hoy por recurso, pero empezara a hacerlo con el primer recurso que alguien cree, sin decision explicita.",
        category: "GOVERN_AUTO_PROVISIONING",
        estimatedSavingsUSD: Number(plan.monthlyCostUSD.toFixed(2)),
        confidence: "MEDIUM",
        actionType: "REVIEW_AUTO_PROVISIONING",
      });
    }
  }

  return out.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregacion
// ─────────────────────────────────────────────────────────────────────────────

export function calculateDefenderSummary(
  plans: DefenderPlanItem[],
  remediations: DefenderRemediationAction[]
): DefenderSummaryMetrics {
  const totalCost = plans.reduce((a, p) => a + p.monthlyCostUSD, 0);
  const protectedCount = plans.reduce((a, p) => a + p.coveredResourcesCount, 0);
  const uncovered = plans.reduce((a, p) => a + p.uncoveredResourcesCount, 0);
  const evaluated = protectedCount + uncovered;

  const byCategory = new Map<string, { costUSD: number; category: DefenderPlanCategory }>();
  for (const p of plans) {
    if (p.monthlyCostUSD <= 0) continue;
    const cur = byCategory.get(p.planDisplayName) || { costUSD: 0, category: p.category };
    cur.costUSD += p.monthlyCostUSD;
    byCategory.set(p.planDisplayName, cur);
  }

  // Proyeccion lineal a fin de mes a partir del avance del mes en curso.
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projected = dayOfMonth > 0 ? (totalCost / dayOfMonth) * daysInMonth : totalCost;

  return {
    totalMonthlyCostUSD: Number(totalCost.toFixed(2)),
    projectedMonthEndCostUSD: Number(projected.toFixed(2)),
    totalProtectedResources: protectedCount,
    totalEvaluatedResources: evaluated,
    coveragePercentage: evaluated > 0 ? Number(((protectedCount / evaluated) * 100).toFixed(1)) : 0,
    totalUnprotectedCriticalResources: plans.reduce(
      (a, p) => a + p.associatedResources.filter((r) => !r.isProtected && r.environment === "Production").length,
      0
    ),
    standardPlansCount: plans.filter((p) => p.pricingTier === "Standard").length,
    evaluatedPlansCount: plans.length,
    potentialSavingsUSD: Number(remediations.reduce((a, r) => a + r.estimatedSavingsUSD, 0).toFixed(2)),
    breakdownByPlan: Array.from(byCategory.entries())
      .map(([planName, v]) => ({
        planName,
        costUSD: Number(v.costUSD.toFixed(2)),
        percentage: totalCost > 0 ? Number(((v.costUSD / totalCost) * 100).toFixed(1)) : 0,
        color: DEFENDER_CATEGORY_COLORS[v.category],
      }))
      .sort((a, b) => b.costUSD - a.costUSD),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset sintetico por tier (solo tenants demo — AGENTS.md #13)
// ─────────────────────────────────────────────────────────────────────────────

function res(
  name: string,
  type: string,
  rg: string,
  environment: ResourceEnvironment,
  isProtected: boolean
): DefenderAssociatedResource {
  return {
    resourceId: `/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/${rg}/providers/${type}/${name}`,
    resourceName: name,
    resourceType: type,
    resourceGroup: rg,
    location: "eastus",
    environment,
    isProtected,
  };
}

function buildPlan(input: {
  planKey: string;
  subscriptionId: string;
  subscriptionName: string;
  pricingTier: DefenderPricingTier;
  subPlan?: DefenderSubPlan;
  resources: DefenderAssociatedResource[];
}): DefenderPlanItem {
  const { displayName, category } = normalizePlanName(input.planKey);
  const covered = input.resources.filter((r) => r.isProtected).length;
  const uncovered = input.resources.length - covered;
  return {
    id: `${input.subscriptionId}/${input.planKey}`,
    planKey: input.planKey,
    planDisplayName: displayName,
    category,
    subscriptionId: input.subscriptionId,
    subscriptionName: input.subscriptionName,
    pricingTier: input.pricingTier,
    subPlan: input.subPlan,
    coveredResourcesCount: covered,
    uncoveredResourcesCount: uncovered,
    monthlyCostUSD: calcPlanMonthlyCost(input.pricingTier, category, input.subPlan, covered),
    coverageStatus: deriveCoverageStatus(covered, uncovered),
    dominantEnvironment: dominantEnvironment(input.resources),
    hasUnprotectedProduction: input.resources.some((r) => !r.isProtected && r.environment === "Production"),
    associatedResources: input.resources,
  };
}

export function getMockDefenderPayload(tenantId: string): DefenderPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const SUB_PROD = { id: "00000000-0000-0000-0000-000000000001", name: "Produccion CSCloudSolutions" };
  const SUB_DEV = { id: "00000000-0000-0000-0000-000000000002", name: "Desarrollo y QA" };

  const VM = "Microsoft.Compute/virtualMachines";
  const SA = "Microsoft.Storage/storageAccounts";
  const SQL = "Microsoft.Sql/servers";
  const WEB = "Microsoft.Web/sites";
  const KV = "Microsoft.KeyVault/vaults";

  const plans: DefenderPlanItem[] = [
    buildPlan({
      planKey: "VirtualMachines",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      pricingTier: "Standard",
      subPlan: "Plan2",
      resources: [
        res("vm-prod-app-01", VM, "rg-prod-app", "Production", true),
        res("vm-prod-app-02", VM, "rg-prod-app", "Production", true),
        res("vm-prod-db-01", VM, "rg-prod-data", "Production", true),
        // Regla 1: VMs no productivas bajo Plan 2.
        res("vm-staging-app", VM, "rg-staging-app", "Staging", true),
        res("vm-dev-build", VM, "rg-dev-ci", "Development", true),
        res("vm-legacy-unmanaged", VM, "rg-legacy", "Production", false),
      ],
    }),
    buildPlan({
      planKey: "StorageAccounts",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      pricingTier: "Standard",
      resources: [
        res("safinopsapp", SA, "rg-prod-app", "Production", true),
        // Regla 2: cuentas frias de respaldo/logs pagando Defender.
        res("safinopsbackups", SA, "rg-backup", "Production", true),
        res("stdiaglogs", SA, "rg-observability", "Production", true),
      ],
    }),
    buildPlan({
      planKey: "SqlServers",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      // Regla 3: bases productivas sin proteccion avanzada.
      pricingTier: "Free",
      resources: [
        res("sql-prod-core", SQL, "rg-prod-data", "Production", false),
        res("sql-prod-reporting", SQL, "rg-prod-data", "Production", false),
      ],
    }),
    buildPlan({
      planKey: "CloudPosture",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      pricingTier: "Standard",
      resources: [],
    }),
    buildPlan({
      planKey: "KeyVaults",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      pricingTier: "Free",
      resources: [res("kv-prod-secrets", KV, "rg-prod-app", "Production", false)],
    }),
  ];

  if (isBusiness) {
    plans.push(
      buildPlan({
        planKey: "AppServices",
        subscriptionId: SUB_DEV.id,
        subscriptionName: SUB_DEV.name,
        pricingTier: "Standard",
        resources: [
          res("app-dev-api", WEB, "rg-dev-web", "Development", true),
          res("app-qa-portal", WEB, "rg-qa-web", "Development", true),
        ],
      }),
      buildPlan({
        planKey: "VirtualMachines",
        subscriptionId: SUB_DEV.id,
        subscriptionName: SUB_DEV.name,
        pricingTier: "Standard",
        subPlan: "Plan1",
        resources: [
          res("vm-dev-01", VM, "rg-dev-ci", "Development", true),
          res("vm-qa-runner", VM, "rg-qa-ci", "Development", true),
        ],
      })
    );
  }

  if (isEnterprise) {
    plans.push(
      buildPlan({
        planKey: "Containers",
        subscriptionId: SUB_PROD.id,
        subscriptionName: SUB_PROD.name,
        pricingTier: "Standard",
        resources: [
          res("aks-prod-cluster", "Microsoft.ContainerService/managedClusters", "rg-prod-aks", "Production", true),
        ],
      }),
      buildPlan({
        planKey: "OpenSourceRelationalDatabases",
        subscriptionId: SUB_PROD.id,
        subscriptionName: SUB_PROD.name,
        pricingTier: "Free",
        resources: [
          res("pg-prod-analytics", "Microsoft.DBforPostgreSQL/flexibleServers", "rg-prod-data", "Production", false),
        ],
      }),
      // Plan Standard sin recursos: patron de auto-provisioning.
      buildPlan({
        planKey: "Api",
        subscriptionId: SUB_DEV.id,
        subscriptionName: SUB_DEV.name,
        pricingTier: "Standard",
        resources: [],
      })
    );
  }

  const remediations = generateDefenderRecommendations(plans);
  const summary = calculateDefenderSummary(plans, remediations);

  return {
    summary,
    plans,
    remediations,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: Array.from(new Set(plans.map((p) => p.subscriptionName))),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Descubrimiento vivo
// ─────────────────────────────────────────────────────────────────────────────

function emptyPayload(availableSubscriptions: string[] = []): DefenderPayload {
  return {
    summary: calculateDefenderSummary([], []),
    plans: [],
    remediations: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions,
  };
}

interface InventoryRow {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  location: string;
  subscriptionId: string;
  tags?: Record<string, unknown> | null;
}

/**
 * Inventario vivo: pricings por suscripcion cruzados con Resource Graph.
 *
 * Devuelve estado vacio legitimo si no hay credenciales o no hay planes; nunca
 * cae al dataset mock (Directiva 24.1).
 */
export async function fetchLiveDefenderData(
  tenantId: string,
  subscriptionIdsFilter: string[] = []
): Promise<DefenderPayload> {
  try {
    const credential = await getAzureCredential(tenantId);
    if (!credential) return emptyPayload();

    const subMap = await getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>());
    const availableSubscriptions = Array.from(subMap.values());

    const subscriptionIds =
      subscriptionIdsFilter.length > 0 ? subscriptionIdsFilter : Array.from(subMap.keys());
    if (subscriptionIds.length === 0) return emptyPayload(availableSubscriptions);

    // 1. Inventario de todos los tipos de recurso que algun plan puede cubrir.
    const coveredTypes = Array.from(
      new Set(Object.values(DEFENDER_PLAN_CATALOG).flatMap((c) => c.resourceTypes))
    );
    const inventory: InventoryRow[] = [];
    if (coveredTypes.length > 0) {
      const client = await getResourceGraphClient(tenantId);
      const typeList = coveredTypes.map((t) => `'${t}'`).join(", ");
      const query = `
        resources
        | where type in~ (${typeList})
        | project id, name, type, resourceGroup, location, subscriptionId, tags
      `;
      const response = await withArgLimit(async () => client.resources({ query }));
      for (const row of (response.data || []) as Array<Record<string, unknown>>) {
        inventory.push({
          id: String(row.id || ""),
          name: String(row.name || ""),
          type: String(row.type || ""),
          resourceGroup: String(row.resourceGroup || ""),
          location: String(row.location || ""),
          subscriptionId: String(row.subscriptionId || ""),
          tags: (row.tags as Record<string, unknown> | null) ?? null,
        });
      }
    }

    // 2. Pricings por suscripcion.
    const tokenData = await credential.getToken(`${ARM_BASE}/.default`);
    if (!tokenData) return emptyPayload(availableSubscriptions);

    const plans: DefenderPlanItem[] = [];
    for (const subscriptionId of subscriptionIds) {
      try {
        const url = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Security/pricings?api-version=${SECURITY_API_VERSION}`;
        const res2 = await fetch(url, { headers: { Authorization: `Bearer ${tokenData.token}` } });
        if (!res2.ok) continue;
        const json = (await res2.json()) as { value?: Array<Record<string, unknown>> };

        for (const item of json.value || []) {
          const planKey = String(item.name || "");
          if (!planKey) continue;
          const props = (item.properties || {}) as Record<string, unknown>;
          const pricingTier: DefenderPricingTier = props.pricingTier === "Standard" ? "Standard" : "Free";
          const subPlan = normalizeSubPlan(props.subPlan);
          const { displayName, category, resourceTypes } = normalizePlanName(planKey);

          // 3. Cruce con el inventario: que recursos caen bajo este plan.
          const scoped = inventory.filter(
            (r) =>
              r.subscriptionId.toLowerCase() === subscriptionId.toLowerCase() &&
              resourceTypes.some((t) => t.toLowerCase() === r.type.toLowerCase())
          );

          const associatedResources: DefenderAssociatedResource[] = scoped.map((r) => ({
            resourceId: r.id,
            resourceName: r.name,
            resourceType: r.type,
            resourceGroup: r.resourceGroup,
            location: r.location,
            environment: classifyEnvironment(r.resourceGroup, r.tags),
            // El tier se fija por suscripcion: en Standard todo el scope queda
            // protegido, en Free ninguno. Las exclusiones por recurso no se
            // exponen en la API de pricings, asi que no se infieren.
            isProtected: pricingTier === "Standard",
          }));

          const covered = associatedResources.filter((r) => r.isProtected).length;
          const uncovered = associatedResources.length - covered;

          plans.push({
            id: `${subscriptionId}/${planKey}`,
            planKey,
            planDisplayName: displayName,
            category,
            subscriptionId,
            subscriptionName: subMap.get(subscriptionId) || subscriptionId,
            pricingTier,
            subPlan,
            coveredResourcesCount: covered,
            uncoveredResourcesCount: uncovered,
            monthlyCostUSD: calcPlanMonthlyCost(pricingTier, category, subPlan, covered),
            coverageStatus: deriveCoverageStatus(covered, uncovered),
            dominantEnvironment: dominantEnvironment(associatedResources),
            hasUnprotectedProduction: associatedResources.some(
              (r) => !r.isProtected && r.environment === "Production"
            ),
            associatedResources,
          });
        }
      } catch (error) {
        // Una suscripcion sin permiso de Security Reader no debe tumbar el
        // inventario completo: se registra y se sigue con las demas.
        console.warn(
          `[azureDefender.service] pricings de ${subscriptionId} no disponibles:`,
          errorMessage(error)
        );
      }
    }

    if (plans.length === 0) return emptyPayload(availableSubscriptions);

    const remediations = generateDefenderRecommendations(plans);
    const summary = calculateDefenderSummary(plans, remediations);

    return {
      summary,
      plans,
      remediations,
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions,
    };
  } catch (error) {
    console.error("[azureDefender.service] fetchLiveDefenderData:", errorMessage(error));
    return emptyPayload();
  }
}
