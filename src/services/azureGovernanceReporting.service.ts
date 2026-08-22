/**
 * Reporting de Gobernanza — motor de agregación y Score de Seguridad Financiera.
 *
 * La recolección de datos vive en `governanceReportingService.ts` (Policy
 * Insights summarize + Resource Graph). Este servicio agrega el score ponderado,
 * las distribuciones con porcentaje y la auditoría de RBAC, y es puro: no toca
 * Azure, así que el cálculo es testeable sin credenciales.
 *
 * RBAC Azure mínimo: `Reader` (incluye `policyresources` y
 * `authorizationresources`). Todo read-only.
 */

import Decimal from "decimal.js";
import { errorMessage } from "@/lib/apiErrors";
import {
  PILLAR_LABELS_ES,
  PILLAR_WEIGHTS,
  PRIVILEGED_ROLES,
  type GovernancePillar,
  type GovernanceReportingPayload,
  type GovernanceReportingSummary,
  type NonCompliantResourceDetail,
  type OrphanedAssignmentDetail,
  type PillarScoreDetail,
  type RbacPrincipalDistribution,
  type RbacPrincipalType,
  type RegionDistribution,
  type ResourceTypeDistribution,
} from "@/types/azureGovernanceReporting.types";

// ─────────────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  "microsoft.compute/virtualmachines": "Virtual Machines",
  "microsoft.storage/storageaccounts": "Storage Accounts",
  "microsoft.network/networkinterfaces": "Network Interfaces",
  "microsoft.network/publicipaddresses": "Public IP Addresses",
  "microsoft.sql/servers/databases": "SQL Databases",
  "microsoft.network/virtualnetworks": "Virtual Networks",
  "microsoft.compute/disks": "Managed Disks",
  "microsoft.keyvault/vaults": "Key Vaults",
  "microsoft.web/sites": "App Services",
  "microsoft.web/serverfarms": "App Service Plans",
  "microsoft.network/networksecuritygroups": "Network Security Groups",
  "microsoft.operationalinsights/workspaces": "Log Analytics Workspaces",
};

export function toResourceTypeLabel(type: unknown): string {
  const original = String(type || "").trim();
  if (!original) return "Otros recursos";
  const known = TYPE_LABELS[original.toLowerCase()];
  if (known) return known;
  // Se conserva la cadena original para no perder los límites de palabra del
  // camelCase que devuelve ARG (`virtualMachines`).
  const last = original.split("/").pop() || original;
  return last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function normalizePrincipalType(raw: unknown): RbacPrincipalType | "Unknown" {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "user") return "User";
  if (s === "serviceprincipal" || s === "service principal" || s === "app") return "ServicePrincipal";
  if (s === "group") return "Group";
  // Azure devuelve principalType vacío o "Unknown" cuando el objeto de
  // directorio ya no existe: ese es exactamente el SID huérfano que hay que
  // detectar, así que no se lo mapea a User por conveniencia.
  return "Unknown";
}

export function isOrphanedPrincipal(raw: unknown): boolean {
  return normalizePrincipalType(raw) === "Unknown";
}

export function isPrivilegedRole(roleName: unknown): boolean {
  const s = String(roleName || "").trim().toLowerCase();
  return PRIVILEGED_ROLES.some((r) => r.toLowerCase() === s);
}

export function calcPercentage(part: number, total: number): number {
  if (total <= 0) return 0;
  return new Decimal(Math.max(0, part)).div(total).times(100).toDecimalPlaces(1).toNumber();
}

// ─────────────────────────────────────────────────────────────────────────────
// Distribuciones
// ─────────────────────────────────────────────────────────────────────────────

export function buildResourceTypeBreakdown(
  rows: Array<{ type?: unknown; count?: unknown }>,
  total: number,
  topN = 5
): ResourceTypeDistribution[] {
  const mapped = rows
    .map((r) => ({
      typeKey: String(r.type || "unknown").toLowerCase(),
      typeDisplayName: toResourceTypeLabel(r.type),
      count: Number(r.count) || 0,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const top = mapped.slice(0, topN);
  const restCount = mapped.slice(topN).reduce((a, r) => a + r.count, 0);
  // El resto se agrupa en vez de descartarse: si no, la suma de las barras no
  // cuadra con el total del encabezado y el tablero se lee como si faltaran
  // recursos.
  const out = top.map((r) => ({ ...r, percentage: calcPercentage(r.count, total) }));
  if (restCount > 0) {
    out.push({
      typeKey: "otros",
      typeDisplayName: "Otros recursos",
      count: restCount,
      percentage: calcPercentage(restCount, total),
    });
  }
  return out;
}

export function buildRegionBreakdown(
  rows: Array<{ location?: unknown; count?: unknown }>,
  total: number,
  topN = 6
): RegionDistribution[] {
  const mapped = rows
    .map((r) => ({
      regionKey: String(r.location || "unknown").toLowerCase(),
      regionDisplayName: String(r.location || "sin región"),
      count: Number(r.count) || 0,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const top = mapped.slice(0, topN);
  const restCount = mapped.slice(topN).reduce((a, r) => a + r.count, 0);
  const out = top.map((r) => ({ ...r, percentage: calcPercentage(r.count, total) }));
  if (restCount > 0) {
    out.push({
      regionKey: "otras",
      regionDisplayName: "Otras regiones",
      count: restCount,
      percentage: calcPercentage(restCount, total),
    });
  }
  return out;
}

export function buildRbacBreakdown(assignments: OrphanedAssignmentDetail[]): RbacPrincipalDistribution[] {
  const types: RbacPrincipalType[] = ["User", "ServicePrincipal", "Group"];
  return types.map((t) => {
    const own = assignments.filter((a) => a.principalType === t);
    return {
      principalType: t,
      count: own.length,
      privilegedRolesCount: own.filter((a) => a.isPrivileged).length,
      // Un SID huérfano tiene principalType Unknown por definición, así que no
      // cae en ninguno de los tres buckets: se reporta aparte, en el total.
      orphanedSidsCount: 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Score de Seguridad Financiera
// ─────────────────────────────────────────────────────────────────────────────

export interface PillarInput {
  /** null = no medible (sin permisos o sin datos). */
  rawScore: number | null;
  detail: string;
}

/**
 * Pondera los cuatro pilares. Los no medibles se excluyen y su peso se
 * redistribuye proporcionalmente entre los que sí lo son: dejarlos en 0
 * castigaría al tenant por una falta de permisos del Service Principal, y
 * dejarlos en 100 haría subir el score justamente por no tener información.
 */
export function calcFinancialSecurityScore(inputs: Record<GovernancePillar, PillarInput>): {
  score: number;
  pillars: PillarScoreDetail[];
} {
  const keys = Object.keys(PILLAR_WEIGHTS) as GovernancePillar[];
  const measurable = keys.filter((k) => inputs[k]?.rawScore !== null && inputs[k]?.rawScore !== undefined);
  const measurableWeight = measurable.reduce((a, k) => a + PILLAR_WEIGHTS[k], 0);

  const pillars: PillarScoreDetail[] = keys.map((k) => {
    const input = inputs[k] || { rawScore: null, detail: "Sin datos." };
    const isMeasurable = input.rawScore !== null && input.rawScore !== undefined;
    const effectiveWeight =
      isMeasurable && measurableWeight > 0
        ? new Decimal(PILLAR_WEIGHTS[k]).div(measurableWeight).times(100).toDecimalPlaces(1).toNumber()
        : 0;
    const clamped = isMeasurable ? Math.min(100, Math.max(0, input.rawScore as number)) : 0;
    return {
      pillar: k,
      rawScore: isMeasurable ? Number(clamped.toFixed(1)) : null,
      weight: PILLAR_WEIGHTS[k],
      effectiveWeight,
      contribution: isMeasurable
        ? new Decimal(clamped).times(effectiveWeight).div(100).toDecimalPlaces(1).toNumber()
        : 0,
      measurable: isMeasurable,
      detail: input.detail,
    };
  });

  // Sin ningún pilar medible el score es 0, no 100: no se puede afirmar que la
  // gobernanza esté sana cuando no se pudo medir nada.
  const score = pillars.reduce((a, p) => a.plus(p.contribution), new Decimal(0)).toDecimalPlaces(1).toNumber();
  return { score: Math.min(100, score), pillars };
}

export interface GovernanceScoreInput {
  compliantResources: number;
  nonCompliantResources: number;
  policyDataAvailable: boolean;
  taggedResources: number;
  totalResources: number;
  totalRbacAssignments: number;
  orphanedSids: number;
  zombieResources: number;
}

export function buildPillarInputs(i: GovernanceScoreInput): Record<GovernancePillar, PillarInput> {
  const evaluated = i.compliantResources + i.nonCompliantResources;
  const rbacKnown = i.totalRbacAssignments > 0;

  return {
    PolicyCompliance: {
      rawScore: i.policyDataAvailable && evaluated > 0 ? calcPercentage(i.compliantResources, evaluated) : null,
      detail:
        i.policyDataAvailable && evaluated > 0
          ? `${i.compliantResources} de ${evaluated} evaluaciones conformes.`
          : "Policy Insights no devolvió evaluaciones: no hay políticas asignadas o falta el rol Reader sobre el alcance.",
    },
    TagHygiene: {
      rawScore: i.totalResources > 0 ? calcPercentage(i.taggedResources, i.totalResources) : null,
      detail:
        i.totalResources > 0
          ? `${i.taggedResources} de ${i.totalResources} recursos con las etiquetas obligatorias.`
          : "Sin inventario de recursos visible.",
    },
    RbacHygiene: {
      rawScore: rbacKnown ? calcPercentage(i.totalRbacAssignments - i.orphanedSids, i.totalRbacAssignments) : null,
      detail: rbacKnown
        ? `${i.orphanedSids} de ${i.totalRbacAssignments} asignaciones apuntan a un principal que ya no existe.`
        : "Sin asignaciones de rol visibles para el Service Principal.",
    },
    ZombieControl: {
      rawScore:
        i.totalResources > 0
          ? calcPercentage(i.totalResources - Math.min(i.zombieResources, i.totalResources), i.totalResources)
          : null,
      detail:
        i.totalResources > 0
          ? `${i.zombieResources} recurso(s) huérfano(s) sobre ${i.totalResources} auditados.`
          : "Sin inventario de recursos visible.",
    },
  };
}

/** Texto del subtítulo de la tarjeta de score, con los conteos reales. */
export function buildScoreSubtitle(s: {
  auditedResourcesCount: number;
  activePolicyAssignmentsCount: number;
  subscriptionsCount: number;
}): string {
  const n = (v: number) => v.toLocaleString("es-AR");
  const plural = (v: number, one: string, many: string) => (v === 1 ? one : many);
  return (
    `Basado en ${n(s.auditedResourcesCount)} ${plural(s.auditedResourcesCount, "recurso auditado", "recursos auditados")} ` +
    `y ${n(s.activePolicyAssignmentsCount)} ${plural(s.activePolicyAssignmentsCount, "asignación de política activa", "asignaciones de política activas")} ` +
    `en ${n(s.subscriptionsCount)} ${plural(s.subscriptionsCount, "suscripción", "suscripciones")}.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensamblado
// ─────────────────────────────────────────────────────────────────────────────

export function assembleLiveGovernanceReport(input: {
  score: GovernanceScoreInput;
  subscriptionsCount: number;
  activePolicyAssignmentsCount: number;
  nonCompliantPoliciesCount: number;
  resourceTypeRows: Array<{ type?: unknown; count?: unknown }>;
  regionRows: Array<{ location?: unknown; count?: unknown }>;
  rbacAssignments: OrphanedAssignmentDetail[];
  nonCompliantResources: NonCompliantResourceDetail[];
}): GovernanceReportingPayload {
  try {
    const { score, pillars } = calcFinancialSecurityScore(buildPillarInputs(input.score));
    const orphaned = input.rbacAssignments.filter((a) => a.isOrphaned);

    const summary: GovernanceReportingSummary = {
      financialSecurityScorePercentage: score,
      auditedResourcesCount: input.score.totalResources,
      activePolicyAssignmentsCount: input.activePolicyAssignmentsCount,
      nonCompliantResourcesCount: input.score.nonCompliantResources,
      nonCompliantPoliciesCount: input.nonCompliantPoliciesCount,
      subscriptionsCount: input.subscriptionsCount,
      totalRbacAssignmentsCount: input.rbacAssignments.length,
      orphanedSidsCount: orphaned.length,
      privilegedRolesCount: input.rbacAssignments.filter((a) => a.isPrivileged).length,
      resourceTypeBreakdown: buildResourceTypeBreakdown(input.resourceTypeRows, input.score.totalResources),
      regionBreakdown: buildRegionBreakdown(input.regionRows, input.score.totalResources),
      rbacBreakdown: buildRbacBreakdown(input.rbacAssignments),
      pillars,
    };

    return {
      summary,
      nonCompliantResources: input.nonCompliantResources,
      orphanedAssignments: input.rbacAssignments.filter((a) => a.isOrphaned || a.isPrivileged),
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[azureGovernanceReporting] assembleLiveGovernanceReport:", errorMessage(error));
    return emptyGovernanceReport();
  }
}

export function emptyGovernanceReport(): GovernanceReportingPayload {
  const { score, pillars } = calcFinancialSecurityScore(
    buildPillarInputs({
      compliantResources: 0,
      nonCompliantResources: 0,
      policyDataAvailable: false,
      taggedResources: 0,
      totalResources: 0,
      totalRbacAssignments: 0,
      orphanedSids: 0,
      zombieResources: 0,
    })
  );
  return {
    summary: {
      financialSecurityScorePercentage: score,
      auditedResourcesCount: 0,
      activePolicyAssignmentsCount: 0,
      nonCompliantResourcesCount: 0,
      nonCompliantPoliciesCount: 0,
      subscriptionsCount: 0,
      totalRbacAssignmentsCount: 0,
      orphanedSidsCount: 0,
      privilegedRolesCount: 0,
      resourceTypeBreakdown: [],
      regionBreakdown: [],
      rbacBreakdown: buildRbacBreakdown([]),
      pillars,
    },
    nonCompliantResources: [],
    orphanedAssignments: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exportables
// ─────────────────────────────────────────────────────────────────────────────

/** Dataset plano del reporte, para CSV. Un bloque por sección. */
export function buildCsvRows(payload: GovernanceReportingPayload): string[][] {
  const s = payload.summary;
  const rows: string[][] = [["Sección", "Clave", "Valor", "Detalle"]];

  rows.push(["Score", "Score de Seguridad Financiera", `${s.financialSecurityScorePercentage}%`, buildScoreSubtitle(s)]);
  for (const p of s.pillars) {
    rows.push([
      "Score",
      PILLAR_LABELS_ES[p.pillar],
      p.measurable ? `${p.rawScore}%` : "No medible",
      `Peso ${p.weight}% (efectivo ${p.effectiveWeight}%) · ${p.detail}`,
    ]);
  }

  rows.push(["Azure Policy", "Recursos no conformes", String(s.nonCompliantResourcesCount), ""]);
  rows.push(["Azure Policy", "Políticas no conformes", String(s.nonCompliantPoliciesCount), ""]);
  rows.push(["Azure Policy", "Asignaciones de política", String(s.activePolicyAssignmentsCount), ""]);

  for (const t of s.resourceTypeBreakdown) {
    rows.push(["Inventario por tipo", t.typeDisplayName, String(t.count), `${t.percentage}%`]);
  }
  for (const r of s.regionBreakdown) {
    rows.push(["Inventario por región", r.regionDisplayName, String(r.count), `${r.percentage}%`]);
  }
  for (const b of s.rbacBreakdown) {
    rows.push(["RBAC", b.principalType, String(b.count), `${b.privilegedRolesCount} rol(es) privilegiado(s)`]);
  }
  rows.push(["RBAC", "SIDs huérfanos", String(s.orphanedSidsCount), "Principal inexistente en el directorio"]);

  for (const r of payload.nonCompliantResources) {
    rows.push(["Recurso no conforme", r.resourceName, r.violatedPolicyName, `${r.resourceType} · ${r.subscriptionName} · ${r.policyEffect}`]);
  }
  for (const a of payload.orphanedAssignments) {
    rows.push([
      "Asignación observada",
      a.principalId,
      a.roleName,
      `${a.principalType} · ${a.scopeDisplayName} · ${a.isOrphaned ? "SID huérfano" : "Rol privilegiado"}`,
    ]);
  }

  return rows;
}

/** Serializa a CSV escapando comillas y separadores. */
export function toCsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset demo
// ─────────────────────────────────────────────────────────────────────────────

function tierOf(tenantId: string): "Professional" | "Business" | "Enterprise" {
  if (tenantId.includes("4444") || tenantId.includes("enterprise")) return "Enterprise";
  if (tenantId.includes("2222") || tenantId.includes("business")) return "Business";
  return "Professional";
}

const DEMO_SUBS = ["CSCS-LandingZone", "CSCS-Produccion", "CSCS-Testing-CL", "Produccion_RPA365"];

const DEMO_TYPE_ROWS = [
  { type: "microsoft.compute/virtualmachines", count: 400 },
  { type: "microsoft.storage/storageaccounts", count: 300 },
  { type: "microsoft.network/networkinterfaces", count: 300 },
  { type: "microsoft.network/publicipaddresses", count: 200 },
  { type: "microsoft.sql/servers/databases", count: 150 },
  { type: "microsoft.keyvault/vaults", count: 220 },
  { type: "microsoft.web/sites", count: 180 },
  { type: "microsoft.network/networksecuritygroups", count: 250 },
];

const DEMO_REGION_ROWS = [
  { location: "eastus", count: 1100 },
  { location: "westeurope", count: 600 },
  { location: "brazilsouth", count: 300 },
];

const DEMO_ROLES = ["Reader", "Contributor", "Owner", "Cost Management Reader", "User Access Administrator"];

export function getMockGovernanceReportPayload(tenantId: string): GovernanceReportingPayload {
  const tier = tierOf(tenantId);
  const scale = tier === "Enterprise" ? 1 : tier === "Business" ? 0.6 : 0.3;
  const totalResources = Math.round(2000 * scale);
  const subsCount = tier === "Enterprise" ? 4 : tier === "Business" ? 2 : 1;

  const nonCompliant = Math.round(150 * scale);
  const compliant = Math.round(totalResources * 0.86) - nonCompliant > 0 ? Math.round(totalResources * 0.86) : totalResources - nonCompliant;
  const taggedResources = Math.round(totalResources * 0.81);
  const zombies = Math.round(totalResources * 0.04);

  // Asignaciones RBAC: 350 usuarios, 150 SPs, 100 grupos + huérfanos.
  const rbacAssignments: OrphanedAssignmentDetail[] = [];
  const push = (type: string, n: number, orphanRate: number) => {
    for (let i = 0; i < Math.round(n * scale); i++) {
      const role = DEMO_ROLES[i % DEMO_ROLES.length];
      const orphaned = i > 0 && i % Math.max(2, Math.round(1 / orphanRate)) === 0;
      rbacAssignments.push({
        assignmentId: `/subscriptions/demo/providers/Microsoft.Authorization/roleAssignments/ra-${type}-${i}`,
        principalId: orphaned ? `00000000-dead-0000-0000-${String(i).padStart(12, "0")}` : `${type.toLowerCase()}-${i}@cscloudsolutions.com.ar`,
        principalType: orphaned ? "Unknown" : type,
        roleName: role,
        scopeDisplayName: DEMO_SUBS[i % subsCount],
        isPrivileged: isPrivilegedRole(role),
        isOrphaned: orphaned,
      });
    }
  };
  push("User", 350, 0.03);
  push("ServicePrincipal", 150, 0.08);
  push("Group", 100, 0.02);

  const nonCompliantResources: NonCompliantResourceDetail[] = Array.from(
    { length: Math.min(60, nonCompliant) },
    (_, i) => {
      const t = DEMO_TYPE_ROWS[i % DEMO_TYPE_ROWS.length];
      const efectos = ["Deny", "Audit", "Modify", "DeployIfNotExists"];
      return {
        resourceId: `/subscriptions/demo/resourceGroups/rg-demo-${(i % 5) + 1}/providers/${t.type}/res-${i + 1}`,
        resourceName: `${toResourceTypeLabel(t.type).split(" ")[0].toLowerCase()}-demo-${i + 1}`,
        resourceType: toResourceTypeLabel(t.type),
        subscriptionName: DEMO_SUBS[i % subsCount],
        violatedPolicyName: ["Exigir etiqueta CostCenter", "Restringir regiones permitidas", "Bloquear IPs públicas", "Auditar Storage sin HTTPS"][i % 4],
        policyEffect: efectos[i % efectos.length],
      };
    }
  );

  const scaledTypeRows = DEMO_TYPE_ROWS.map((r) => ({ ...r, count: Math.round(r.count * scale) }));
  const scaledRegionRows = DEMO_REGION_ROWS.slice(0, subsCount === 1 ? 1 : 3).map((r) => ({
    ...r,
    count: Math.round(r.count * scale),
  }));

  const payload = assembleLiveGovernanceReport({
    score: {
      compliantResources: compliant,
      nonCompliantResources: nonCompliant,
      policyDataAvailable: true,
      taggedResources,
      totalResources,
      totalRbacAssignments: rbacAssignments.length,
      orphanedSids: rbacAssignments.filter((a) => a.isOrphaned).length,
      zombieResources: zombies,
    },
    subscriptionsCount: subsCount,
    activePolicyAssignmentsCount: Math.round(54 * scale),
    nonCompliantPoliciesCount: Math.round(25 * scale),
    resourceTypeRows: scaledTypeRows,
    regionRows: scaledRegionRows,
    rbacAssignments,
    nonCompliantResources,
  });

  return { ...payload, source: "mock", lastUpdated: "2026-08-22T09:00:00.000Z" };
}
