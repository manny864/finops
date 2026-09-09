/**
 * Cost Allocation — Prorrateo de Recursos Compartidos
 *
 * RBAC mínimo: `Cost Management Reader` (costo real del recurso compartido) y
 * `Reader` (inventario via Resource Graph). Las reglas viven en MySQL
 * `AllocationRules`, no en Azure.
 *
 * La invariante que gobierna todo el módulo: los porcentajes de una regla deben
 * sumar exactamente 100%. Por debajo hay residuo huérfano —una fuga silenciosa
 * en el showback— y por encima se cobraría más de lo que el recurso cuesta. El
 * servicio se niega a persistir reglas que superen el 100% y expone el residuo
 * de las incompletas en vez de esconderlo.
 */

import { Decimal } from "decimal.js";
import pool from "@/modules/storage/db";
import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { errorMessage } from "@/lib/apiErrors";
import {
  ALLOC_SCALE,
  PERCENTAGE_TOLERANCE,
  SHARED_RESOURCE_TYPES,
  type AllocationRemediationAction,
  type AllocationStatus,
  type AllocationStrategy,
  type AllocationTarget,
  type CostAllocationPayload,
  type CostAllocationSummary,
  type SharedCostRule,
  type SharedResourceType,
} from "@/types/azureCostAllocation.types";

const VALID_STRATEGIES: AllocationStrategy[] = [
  "FIXED_PERCENTAGE",
  "DYNAMIC_AKS_NAMESPACE",
  "DYNAMIC_LAW_INGESTION",
  "PROPORTIONAL_DIRECT_SPEND",
];

// ─────────────────────────────────────────────────────────────────────────────
// Normalización y validación
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeStrategy(raw: unknown): AllocationStrategy {
  return typeof raw === "string" && (VALID_STRATEGIES as string[]).includes(raw)
    ? (raw as AllocationStrategy)
    : "FIXED_PERCENTAGE";
}

/** Deriva el tipo de recurso compartido a partir de su resource ID de Azure. */
export function deriveSharedResourceType(resourceId: string): SharedResourceType {
  const t = resourceId.toLowerCase();
  if (t.includes("/expressroutecircuits/")) return "ExpressRoute";
  if (t.includes("/managedclusters/")) return "AKS";
  if (t.includes("/workspaces/") && t.includes("operationalinsights")) return "LogAnalytics";
  if (t.includes("/azurefirewalls/")) return "AzureFirewall";
  if (t.includes("/virtualnetworkgateways/")) return "VPNGateway";
  if (t.includes("/virtualnetworks/")) return "VNetHub";
  return "Other";
}

export function isValidResourceType(raw: unknown): raw is SharedResourceType {
  return typeof raw === "string" && (SHARED_RESOURCE_TYPES as readonly string[]).includes(raw);
}

/**
 * Estado de una regla según la suma de sus porcentajes.
 * La tolerancia evita marcar como incompleta una regla de 33.33 × 3, que suma
 * 99.99 por redondeo decimal y no por un error del usuario.
 */
export function deriveAllocationStatus(totalPercentage: number): AllocationStatus {
  if (totalPercentage > 100 + PERCENTAGE_TOLERANCE) return "OVER_ALLOCATED";
  if (totalPercentage < 100 - PERCENTAGE_TOLERANCE) return "INCOMPLETE";
  return "VALID_100";
}

/**
 * Valida un conjunto de targets antes de persistirlo. Devuelve los errores en
 * vez de lanzar, para que la ruta pueda responder 400 con el detalle.
 */
export function validateTargets(
  targets: Array<{ targetCostCenterName?: unknown; percentage?: unknown }>
): { valid: boolean; errors: string[]; totalPercentage: number } {
  const errors: string[] = [];
  let total = new Decimal(0);
  const seen = new Set<string>();

  if (targets.length === 0) errors.push("La regla no tiene ningún centro de costo asignado");

  targets.forEach((t, i) => {
    const name = String(t.targetCostCenterName || "").trim();
    if (!name) {
      errors.push(`Fila ${i + 1}: falta el centro de costo`);
      return;
    }
    // Un mismo centro dos veces en la misma regla es casi siempre un error de
    // captura, y duplicarlo distorsiona el showback sin que se note.
    const key = name.toLowerCase();
    if (seen.has(key)) errors.push(`El centro de costo "${name}" está repetido en la regla`);
    seen.add(key);

    const pct = Number(t.percentage);
    if (!Number.isFinite(pct)) {
      errors.push(`Fila ${i + 1}: el porcentaje no es un número`);
      return;
    }
    if (pct < 0) errors.push(`Fila ${i + 1}: el porcentaje no puede ser negativo`);
    if (pct > 100) errors.push(`Fila ${i + 1}: el porcentaje no puede superar 100`);
    total = total.plus(pct);
  });

  const totalPercentage = total.toDecimalPlaces(2).toNumber();
  if (totalPercentage > 100 + PERCENTAGE_TOLERANCE) {
    errors.push(`La suma de porcentajes es ${totalPercentage}% y no puede superar 100%`);
  }

  return { valid: errors.length === 0, errors, totalPercentage };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo del prorrateo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reparte el costo del recurso compartido entre los targets.
 *
 * El último target absorbe el residuo del redondeo para que la suma de los
 * montos cuadre EXACTAMENTE con lo asignado: repartir 100 USD entre tres
 * centros al 33.33% deja centavos flotando si cada uno se redondea por
 * separado, y esos centavos aparecen después como descuadre en el showback.
 */
export function calculateAllocation(
  monthlyCostUSD: number,
  targets: Array<{ targetCostCenterId: string; targetCostCenterName: string; percentage: number }>
): { allocated: AllocationTarget[]; totalPercentage: number; unallocatedAmountUSD: number } {
  const cost = new Decimal(Number.isFinite(monthlyCostUSD) ? monthlyCostUSD : 0);
  const totalPct = targets.reduce((a, t) => a.plus(Number(t.percentage) || 0), new Decimal(0));

  const allocated: AllocationTarget[] = targets.map((t, i) => {
    const pct = new Decimal(Number(t.percentage) || 0);
    const isLast = i === targets.length - 1;
    let amount: Decimal;
    if (isLast) {
      // El último toma lo que falta para completar el total asignado.
      const assignedSoFar = targets
        .slice(0, i)
        .reduce((a, x) => a.plus(cost.times(Number(x.percentage) || 0).div(100).toDecimalPlaces(2)), new Decimal(0));
      amount = cost.times(totalPct).div(100).toDecimalPlaces(2).minus(assignedSoFar);
    } else {
      amount = cost.times(pct).div(100).toDecimalPlaces(2);
    }
    return {
      targetCostCenterId: t.targetCostCenterId,
      targetCostCenterName: t.targetCostCenterName,
      percentage: pct.toDecimalPlaces(2).toNumber(),
      allocatedAmountUSD: amount.toDecimalPlaces(2).toNumber(),
    };
  });

  const totalPercentage = totalPct.toDecimalPlaces(2).toNumber();
  // El residuo solo existe cuando la regla está incompleta; una regla
  // sobre-asignada no genera "residuo negativo", genera un error de validación.
  const unallocatedPct = Decimal.max(new Decimal(100).minus(totalPct), 0);
  const unallocatedAmountUSD = cost.times(unallocatedPct).div(100).toDecimalPlaces(2).toNumber();

  return { allocated, totalPercentage, unallocatedAmountUSD };
}

/**
 * Reparte proporcionalmente al gasto directo de cada centro de costo.
 * Con gasto directo total en cero devuelve un reparto vacío en vez de dividir
 * por cero o repartir en partes iguales, que sería una decisión inventada.
 */
export function calculateProportionalTargets(
  directSpendByCostCenter: Array<{ costCenterId: string; costCenterName: string; directSpendUSD: number }>
): Array<{ targetCostCenterId: string; targetCostCenterName: string; percentage: number }> {
  const total = directSpendByCostCenter.reduce((a, c) => a + Math.max(0, c.directSpendUSD), 0);
  if (total <= 0) return [];
  return directSpendByCostCenter
    .filter((c) => c.directSpendUSD > 0)
    .map((c) => ({
      targetCostCenterId: c.costCenterId,
      targetCostCenterName: c.costCenterName,
      percentage: new Decimal(c.directSpendUSD).div(total).times(100).toDecimalPlaces(2).toNumber(),
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregación
// ─────────────────────────────────────────────────────────────────────────────

export function buildAllocationSummary(rules: SharedCostRule[]): CostAllocationSummary {
  const totalShared = rules.reduce((a, r) => a + r.monthlyCostUSD, 0);
  const totalUnallocated = rules.reduce((a, r) => a + r.unallocatedAmountUSD, 0);
  const totalAllocated = rules.reduce(
    (a, r) => a + r.targets.reduce((b, t) => b + t.allocatedAmountUSD, 0),
    0
  );

  const byCenter = new Map<string, number>();
  for (const r of rules) {
    for (const t of r.targets) {
      byCenter.set(t.targetCostCenterName, (byCenter.get(t.targetCostCenterName) || 0) + t.allocatedAmountUSD);
    }
  }

  return {
    totalSharedSpendUSD: Number(totalShared.toFixed(2)),
    totalAllocatedSpendUSD: Number(totalAllocated.toFixed(2)),
    totalUnallocatedSpendUSD: Number(totalUnallocated.toFixed(2)),
    allocationCoveragePercentage:
      totalShared > 0 ? Number(((totalAllocated / totalShared) * 100).toFixed(1)) : 0,
    affectedCostCentersCount: byCenter.size,
    activeRulesCount: rules.length,
    invalidRulesCount: rules.filter((r) => r.status !== "VALID_100").length,
    unruledSharedResourcesCount: 0,
    showbackByCostCenter: Array.from(byCenter.entries())
      .map(([costCenterName, allocatedUSD]) => ({
        costCenterName,
        allocatedUSD: Number(allocatedUSD.toFixed(2)),
        percentage: totalAllocated > 0 ? Number(((allocatedUSD / totalAllocated) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.allocatedUSD - a.allocatedUSD),
    rules,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recomendaciones
// ─────────────────────────────────────────────────────────────────────────────

export function generateAllocationRecommendations(
  summary: CostAllocationSummary,
  unruledResources: Array<{ resourceId: string; resourceName: string; resourceType: SharedResourceType; monthlyCostUSD: number }>
): AllocationRemediationAction[] {
  const out: AllocationRemediationAction[] = [];

  for (const r of summary.rules) {
    // Reglas incompletas: el residuo es gasto que nadie está viendo en su
    // showback, así que aparece como si no existiera.
    if (r.status === "INCOMPLETE") {
      out.push({
        id: `complete-${r.id}`,
        ruleId: r.id,
        params: {
          name: r.sharedResourceName,
          pct: r.totalAllocatedPercentage,
          missing: (100 - r.totalAllocatedPercentage).toFixed(2),
          amount: r.unallocatedAmountUSD.toFixed(2),
        },
        category: "COMPLETE_100_PERCENT",
        estimatedSavingsOrImpactUSD: r.unallocatedAmountUSD,
        confidence: "HIGH",
        actionType: "EDIT_RULE",
      });
    }

    if (r.status === "OVER_ALLOCATED") {
      out.push({
        id: `over-${r.id}`,
        ruleId: r.id,
        params: { name: r.sharedResourceName, pct: r.totalAllocatedPercentage },
        category: "FIX_OVER_ALLOCATION",
        estimatedSavingsOrImpactUSD: 0,
        confidence: "HIGH",
        actionType: "EDIT_RULE",
      });
    }

    // Un AKS repartido por porcentaje fijo ignora quién consume realmente.
    if (r.resourceType === "AKS" && r.strategy === "FIXED_PERCENTAGE") {
      out.push({
        id: `aks-dynamic-${r.id}`,
        ruleId: r.id,
        params: { name: r.sharedResourceName },
        category: "DYNAMIC_NAMESPACE_ENABLE",
        estimatedSavingsOrImpactUSD: r.monthlyCostUSD,
        confidence: "MEDIUM",
        actionType: "ENABLE_DYNAMIC_AKS",
      });
    }

    // Lo mismo para Log Analytics: la ingesta por tabla dice exactamente quién
    // generó los datos.
    if (r.resourceType === "LogAnalytics" && r.strategy === "FIXED_PERCENTAGE") {
      out.push({
        id: `law-dynamic-${r.id}`,
        ruleId: r.id,
        params: { name: r.sharedResourceName },
        category: "LAW_INGESTION_SPLIT",
        estimatedSavingsOrImpactUSD: r.monthlyCostUSD,
        confidence: "MEDIUM",
        actionType: "ENABLE_DYNAMIC_LAW",
      });
    }
  }

  // Recursos compartidos sin ninguna regla: su costo entero queda huérfano.
  const significant = unruledResources.filter((r) => r.monthlyCostUSD > 0).sort((a, b) => b.monthlyCostUSD - a.monthlyCostUSD);
  for (const r of significant.slice(0, 3)) {
    out.push({
      id: `unruled-${r.resourceId}`,
      ruleId: "",
      params: { name: r.resourceName, type: r.resourceType, cost: r.monthlyCostUSD.toFixed(2) },
      category: "DETECT_UNALLOCATED_HUB",
      estimatedSavingsOrImpactUSD: r.monthlyCostUSD,
      confidence: "HIGH",
      actionType: "CREATE_RULE",
    });
  }

  return out.sort((a, b) => b.estimatedSavingsOrImpactUSD - a.estimatedSavingsOrImpactUSD);
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistencia
// ─────────────────────────────────────────────────────────────────────────────

interface RuleRow {
  id: string;
  ruleName: string | null;
  resourceName: string;
  sharedResourceId: string | null;
  resourceType: string;
  allocationStrategy: string;
  targetCostCenter: string;
  allocationPercentage: string;
}

/** Lee las reglas del tenant, agrupando las filas por recurso compartido. */
export async function getRulesFromDb(
  tenantId: string,
  costByResource: Map<string, number>
): Promise<SharedCostRule[]> {
  try {
    const [rows] = await pool.query(
      `SELECT id, ruleName, resourceName, sharedResourceId, resourceType, allocationStrategy,
              targetCostCenter, allocationPercentage
       FROM AllocationRules WHERE tenantId = ? ORDER BY resourceName ASC`,
      [tenantId]
    );

    const grouped = new Map<string, RuleRow[]>();
    for (const r of rows as RuleRow[]) {
      grouped.set(r.resourceName, [...(grouped.get(r.resourceName) || []), r]);
    }

    return Array.from(grouped.entries()).map(([resourceName, group]) => {
      const head = group[0];
      const monthlyCostUSD = costByResource.get(resourceName.toLowerCase()) || 0;
      const { allocated, totalPercentage, unallocatedAmountUSD } = calculateAllocation(
        monthlyCostUSD,
        group.map((g) => ({
          targetCostCenterId: g.targetCostCenter,
          targetCostCenterName: g.targetCostCenter,
          percentage: Number(g.allocationPercentage) || 0,
        }))
      );
      return {
        id: head.id,
        ruleName: head.ruleName || resourceName,
        sharedResourceId: head.sharedResourceId || "",
        sharedResourceName: resourceName,
        resourceType: isValidResourceType(head.resourceType) ? head.resourceType : "Other",
        resourceGroup: "",
        subscriptionId: "",
        subscriptionName: "",
        monthlyCostUSD,
        strategy: normalizeStrategy(head.allocationStrategy),
        targets: allocated,
        totalAllocatedPercentage: totalPercentage,
        unallocatedAmountUSD,
        status: deriveAllocationStatus(totalPercentage),
        lastUpdated: new Date().toISOString(),
      };
    });
  } catch (error) {
    console.warn("[azureCostAllocation.service] getRulesFromDb:", errorMessage(error));
    return [];
  }
}

/**
 * Reemplaza las filas de una regla de forma transaccional. Sin transacción, un
 * fallo entre el DELETE y el INSERT dejaría el recurso sin ninguna asignación:
 * su costo entero pasaría a residuo huérfano sin que nadie lo pidiera.
 */
export async function saveRule(input: {
  tenantId: string;
  ruleName: string;
  sharedResourceId: string;
  sharedResourceName: string;
  resourceType: SharedResourceType;
  strategy: AllocationStrategy;
  targets: Array<{ targetCostCenterName: string; percentage: number }>;
}): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM AllocationRules WHERE tenantId = ? AND resourceName = ?`, [
      input.tenantId,
      input.sharedResourceName,
    ]);
    for (const t of input.targets) {
      await conn.query(
        `INSERT INTO AllocationRules
           (id, tenantId, ruleName, resourceName, sharedResourceId, resourceType, allocationStrategy,
            targetCostCenter, allocationPercentage)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.tenantId,
          input.ruleName,
          input.sharedResourceName,
          input.sharedResourceId,
          input.resourceType,
          input.strategy,
          t.targetCostCenterName,
          t.percentage,
        ]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function deleteRule(tenantId: string, sharedResourceName: string): Promise<void> {
  await pool.query(`DELETE FROM AllocationRules WHERE tenantId = ? AND resourceName = ?`, [
    tenantId,
    sharedResourceName,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset sintético por tier (solo tenants demo — AGENTS.md #13)
// ─────────────────────────────────────────────────────────────────────────────

function buildRule(input: {
  id: string;
  name: string;
  type: SharedResourceType;
  rg: string;
  cost: number;
  strategy: AllocationStrategy;
  targets: Array<[string, number]>;
}): SharedCostRule {
  const { allocated, totalPercentage, unallocatedAmountUSD } = calculateAllocation(
    input.cost,
    input.targets.map(([name, pct]) => ({ targetCostCenterId: name, targetCostCenterName: name, percentage: pct }))
  );
  return {
    id: input.id,
    ruleName: input.name,
    sharedResourceId: `/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/${input.rg}/providers/${input.name}`,
    sharedResourceName: input.name,
    resourceType: input.type,
    resourceGroup: input.rg,
    subscriptionId: "00000000-0000-0000-0000-000000000001",
    subscriptionName: "Produccion CSCloudSolutions",
    monthlyCostUSD: input.cost,
    strategy: input.strategy,
    targets: allocated,
    totalAllocatedPercentage: totalPercentage,
    unallocatedAmountUSD,
    status: deriveAllocationStatus(totalPercentage),
    lastUpdated: new Date().toISOString(),
  };
}

export function getMockAllocationPayload(tenantId: string): CostAllocationPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const rules: SharedCostRule[] = [
    buildRule({
      id: "rule-er",
      name: "ExpressRoute-Corp",
      type: "ExpressRoute",
      rg: "rg-network-hub",
      cost: 689.5,
      strategy: "FIXED_PERCENTAGE",
      targets: [
        ["Engineering", 65],
        ["Marketing", 35],
      ],
    }),
    // Regla incompleta: el residuo queda visible como fuga del showback.
    buildRule({
      id: "rule-fw",
      name: "AzureFirewall-Hub",
      type: "AzureFirewall",
      rg: "rg-network-hub",
      cost: 912.4,
      strategy: "FIXED_PERCENTAGE",
      targets: [
        ["Engineering", 50],
        ["Data & Analytics", 25],
        ["Marketing", 10],
      ],
    }),
    // AKS con porcentaje fijo: candidato a reparto dinámico por Namespace.
    buildRule({
      id: "rule-aks",
      name: "AKS-Shared-Cluster",
      type: "AKS",
      rg: "rg-prod-aks",
      cost: 1_432.8,
      strategy: "FIXED_PERCENTAGE",
      targets: [
        ["Engineering", 40],
        ["Data & Analytics", 40],
        ["IA & Machine Learning", 20],
      ],
    }),
  ];

  if (isBusiness) {
    rules.push(
      buildRule({
        id: "rule-law",
        name: "LAW-Central",
        type: "LogAnalytics",
        rg: "rg-observability",
        cost: 2_180.15,
        strategy: "FIXED_PERCENTAGE",
        targets: [
          ["Engineering", 34],
          ["CloudOps / FinOps", 33],
          ["Data & Analytics", 33],
        ],
      })
    );
  }

  if (isEnterprise) {
    rules.push(
      buildRule({
        id: "rule-vnet",
        name: "VNetHub-Global",
        type: "VNetHub",
        rg: "rg-network-hub",
        cost: 344.2,
        strategy: "PROPORTIONAL_DIRECT_SPEND",
        targets: [
          ["Engineering", 48.5],
          ["Data & Analytics", 27.3],
          ["Marketing", 14.2],
          ["CloudOps / FinOps", 10],
        ],
      })
    );
  }

  const availableSharedResources = [
    ...rules.map((r) => ({
      resourceId: r.sharedResourceId,
      resourceName: r.sharedResourceName,
      resourceType: r.resourceType,
      resourceGroup: r.resourceGroup,
      subscriptionName: r.subscriptionName,
      monthlyCostUSD: r.monthlyCostUSD,
      hasRule: true,
    })),
    // Recurso compartido sin regla: su costo entero queda huérfano.
    {
      resourceId: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-network-hub/providers/VPNGateway-Branch",
      resourceName: "VPNGateway-Branch",
      resourceType: "VPNGateway" as SharedResourceType,
      resourceGroup: "rg-network-hub",
      subscriptionName: "Produccion CSCloudSolutions",
      monthlyCostUSD: 271.8,
      hasRule: false,
    },
  ];

  const unruled = availableSharedResources.filter((r) => !r.hasRule);
  const summary = buildAllocationSummary(rules);
  summary.unruledSharedResourcesCount = unruled.length;

  return {
    summary,
    remediations: generateAllocationRecommendations(summary, unruled),
    availableSharedResources,
    availableCostCenters: [
      "Engineering",
      "Marketing",
      "Data & Analytics",
      "IA & Machine Learning",
      "CloudOps / FinOps",
      "Sin Asignar (Untagged)",
    ],
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Descubrimiento vivo
// ─────────────────────────────────────────────────────────────────────────────

function emptyPayload(): CostAllocationPayload {
  return {
    summary: buildAllocationSummary([]),
    remediations: [],
    availableSharedResources: [],
    availableCostCenters: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Inventario vivo de recursos compartidos + reglas persistidas.
 *
 * El costo por recurso lo provee el llamador (la ruta resuelve Cost Management
 * y su caché), de modo que este servicio queda testeable sin tocar Azure.
 * Devuelve estado vacío legítimo si no hay credenciales; nunca cae al mock.
 */
export async function fetchLiveAllocationData(
  tenantId: string,
  costByResource: Map<string, number>
): Promise<CostAllocationPayload> {
  try {
    const rules = await getRulesFromDb(tenantId, costByResource);

    let availableSharedResources: CostAllocationPayload["availableSharedResources"] = [];
    const ruledNames = new Set(rules.map((r) => r.sharedResourceName.toLowerCase()));

    try {
      const credential = await getAzureCredential(tenantId);
      if (credential) {
        const subMap = await getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>());
        const client = await getResourceGraphClient(tenantId);
        const query = `
          resources
          | where type =~ 'microsoft.network/expressroutecircuits'
             or type =~ 'microsoft.containerservice/managedclusters'
             or type =~ 'microsoft.operationalinsights/workspaces'
             or type =~ 'microsoft.network/azurefirewalls'
             or type =~ 'microsoft.network/virtualnetworkgateways'
          | project id, name, type, resourceGroup, subscriptionId
        `;
        const res = await withArgLimit(async () => client.resources({ query }));
        availableSharedResources = ((res.data || []) as Array<Record<string, unknown>>).map((row) => {
          const resourceId = String(row.id || "");
          const resourceName = String(row.name || "");
          const subscriptionId = String(row.subscriptionId || "");
          return {
            resourceId,
            resourceName,
            resourceType: deriveSharedResourceType(resourceId),
            resourceGroup: String(row.resourceGroup || ""),
            subscriptionName: subMap.get(subscriptionId) || subscriptionId,
            monthlyCostUSD: costByResource.get(resourceName.toLowerCase()) || 0,
            hasRule: ruledNames.has(resourceName.toLowerCase()),
          };
        });
      }
    } catch (error) {
      // Sin inventario el módulo sigue siendo útil con las reglas persistidas:
      // se pierde el asistente de creación, no el prorrateo.
      console.warn("[azureCostAllocation.service] inventario no disponible:", errorMessage(error));
    }

    const unruled = availableSharedResources.filter((r) => !r.hasRule && r.monthlyCostUSD > 0);
    const summary = buildAllocationSummary(rules);
    summary.unruledSharedResourcesCount = unruled.length;

    return {
      summary,
      remediations: generateAllocationRecommendations(summary, unruled),
      availableSharedResources,
      availableCostCenters: Array.from(
        new Set(rules.flatMap((r) => r.targets.map((t) => t.targetCostCenterName)))
      ).sort(),
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[azureCostAllocation.service] fetchLiveAllocationData:", errorMessage(error));
    return emptyPayload();
  }
}

/** Color estable por índice, para las gráficas de reparto. */
export function costCenterColor(index: number): string {
  return ALLOC_SCALE[index % ALLOC_SCALE.length];
}
