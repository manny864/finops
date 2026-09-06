/**
 * Políticas (Auto-Block) — motor de evaluación de Azure Policy.
 *
 * El cumplimiento sale de `policyresources` (tabla `policystates` de Policy
 * Insights, expuesta por Azure Resource Graph). La implementación anterior lo
 * estimaba con una heurística fija —25% de recursos no conformes sobre el
 * inventario— y devolvía ese número sin distinguirlo de un dato real: un tenant
 * sin una sola política asignada igual veía "75% de cumplimiento". Acá, si no
 * hay estados de política, el resumen es 0/0 y la UI muestra el vacío legítimo.
 *
 * RBAC Azure mínimo: `Reader` (ARG incluye policyresources) para la vista;
 * `Resource Policy Contributor` para asignar y `Policy Insights Data Writer`
 * para disparar remediaciones.
 */

import Decimal from "decimal.js";
import { errorMessage } from "@/lib/apiErrors";
import {
  BUILT_IN_TEMPLATES,
  INITIATIVE_CRITICAL_THRESHOLD,
  INITIATIVE_HEALTHY_THRESHOLD,
  REMEDIABLE_EFFECTS,
  type AutoBlockPayload,
  type AutoBlockSummaryMetrics,
  type CategoryComplianceItem,
  type InitiativeComplianceItem,
  type InitiativeStatus,
  type NonCompliantResourceItem,
  type PolicyAssignmentItem,
  type PolicyEffectType,
  type PolicyScopeOption,
  type PolicyScopeType,
} from "@/types/azureAutoBlockPolicies.types";

// ─────────────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────────────

const EFFECTS: PolicyEffectType[] = ["Deny", "Audit", "Modify", "DeployIfNotExists", "Disabled"];

export function normalizeEffect(raw: unknown): PolicyEffectType {
  const s = String(raw || "").trim().toLowerCase();
  const match = EFFECTS.find((e) => e.toLowerCase() === s);
  if (match) return match;
  // Alias que Azure devuelve en algunas definiciones.
  if (s === "deployifnotexist") return "DeployIfNotExists";
  if (s === "auditifnotexists") return "Audit";
  if (s === "append") return "Modify";
  // Fail-safe legible: un efecto desconocido no se muestra como Deny, que
  // haría creer que está bloqueando algo que en realidad sólo audita.
  return "Audit";
}

/** Deriva el tipo de scope del ARM ID de la asignación. */
export function deriveScopeType(scopeId: unknown): PolicyScopeType {
  const s = String(scopeId || "").toLowerCase();
  if (s.includes("/providers/microsoft.management/managementgroups/")) return "ManagementGroup";
  if (s.includes("/resourcegroups/")) return "ResourceGroup";
  return "Subscription";
}

/** Último segmento del ARM ID: el nombre del management group, sub o RG. */
export function deriveScopeName(scopeId: unknown, subscriptionNames: Map<string, string> = new Map()): string {
  const s = String(scopeId || "");
  if (!s) return "—";
  const type = deriveScopeType(s);
  if (type === "Subscription") {
    const guid = s.split("/subscriptions/")[1]?.split("/")[0] || "";
    // Sin nombre ni GUID no hay nada que traducir: el guion evita meter una
    // palabra en un solo idioma dentro del payload.
    return subscriptionNames.get(guid.toLowerCase()) || guid || "—";
  }
  const parts = s.split("/").filter(Boolean);
  return parts[parts.length - 1] || s;
}

/**
 * `microsoft.compute/virtualmachines` → `Virtual Machines`.
 * Se agrupa por el segundo segmento porque el proveedor solo (microsoft.compute)
 * mezclaría VMs, discos y snapshots en una misma barra.
 */
export function toCategoryDisplayName(resourceType: unknown): string {
  const original = String(resourceType || "").trim();
  if (!original) return "Otros";
  // La búsqueda en el diccionario va en minúsculas, pero el fallback usa la
  // cadena original: bajar todo primero borra los límites de palabra del
  // camelCase que trae ARG (`virtualMachines` → `virtualmachines`) y deja
  // nombres pegados como "Algoraro" para cualquier tipo no catalogado.
  const raw = original.toLowerCase();
  const sub = raw.includes("/") ? raw.split("/").slice(1).join("/") : raw;
  const subOriginal = original.includes("/") ? original.split("/").slice(1).join("/") : original;
  const KNOWN: Record<string, string> = {
    virtualmachines: "Virtual Machines",
    networkinterfaces: "Network Interfaces",
    storageaccounts: "Storage Accounts",
    publicipaddresses: "Public IP Addresses",
    virtualnetworks: "Virtual Networks",
    disks: "Managed Disks",
    "servers/databases": "SQL Databases",
    vaults: "Key Vaults",
    sites: "App Services",
    serverfarms: "App Service Plans",
    accounts: "Accounts / Other",
  };
  if (KNOWN[sub]) return KNOWN[sub];
  // camelCase → palabras, y capitalización por palabra.
  return subOriginal
    .split("/")
    .pop()!
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function calcCompliancePercentage(compliant: number, total: number): number {
  if (total <= 0) return 0;
  return new Decimal(Math.max(0, compliant)).div(total).times(100).toDecimalPlaces(1).toNumber();
}

export function deriveInitiativeStatus(compliancePercentage: number): InitiativeStatus {
  if (compliancePercentage >= INITIATIVE_HEALTHY_THRESHOLD) return "HEALTHY";
  if (compliancePercentage >= INITIATIVE_CRITICAL_THRESHOLD) return "NEEDS_ATTENTION";
  return "CRITICAL";
}

export function isRemediable(effect: PolicyEffectType): boolean {
  return REMEDIABLE_EFFECTS.includes(effect);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregación de estados de política
// ─────────────────────────────────────────────────────────────────────────────

/** Fila cruda de `policyresources | where type == 'microsoft.policyinsights/policystates'`. */
export interface RawPolicyState {
  resourceId?: unknown;
  resourceName?: unknown;
  resourceType?: unknown;
  resourceGroup?: unknown;
  subscriptionId?: unknown;
  complianceState?: unknown;
  policyAssignmentId?: unknown;
  policyAssignmentName?: unknown;
  /** Solo en demo: clave i18n del nombre de la asignacion. */
  policyAssignmentNameKey?: unknown;
  policyDefinitionId?: unknown;
  policySetDefinitionId?: unknown;
  policySetDefinitionName?: unknown;
  policyDefinitionAction?: unknown;
  policyDefinitionCategory?: unknown;
}

function isCompliant(state: unknown): boolean {
  return String(state || "").toLowerCase() === "compliant";
}

function isEvaluated(state: unknown): boolean {
  const s = String(state || "").toLowerCase();
  // `exempt` y `unknown` no son ni conformes ni infracciones: contarlos como no
  // conformes inventaría infracciones que Azure no reporta.
  return s === "compliant" || s === "noncompliant";
}

export function buildCategoryCompliance(states: RawPolicyState[]): CategoryComplianceItem[] {
  const byCategory = new Map<string, { total: number; compliant: number }>();
  for (const s of states) {
    if (!isEvaluated(s.complianceState)) continue;
    const key = toCategoryDisplayName(s.resourceType);
    const entry = byCategory.get(key) || { total: 0, compliant: 0 };
    entry.total++;
    if (isCompliant(s.complianceState)) entry.compliant++;
    byCategory.set(key, entry);
  }
  return Array.from(byCategory.entries())
    .map(([name, v]) => ({
      categoryKey: name.toLowerCase().replace(/\W+/g, "-"),
      categoryDisplayName: name,
      totalResources: v.total,
      compliantResources: v.compliant,
      compliancePercentage: calcCompliancePercentage(v.compliant, v.total),
    }))
    .sort((a, b) => b.totalResources - a.totalResources);
}

export function buildInitiativeCompliance(states: RawPolicyState[]): InitiativeComplianceItem[] {
  const byInitiative = new Map<
    string,
    { name: string; category: string; policies: Set<string>; resources: Set<string>; total: number; compliant: number }
  >();

  for (const s of states) {
    if (!isEvaluated(s.complianceState)) continue;
    const setId = String(s.policySetDefinitionId || "").trim();
    // Una política suelta (sin iniciativa) no pertenece a ningún set: se omite
    // del grid de iniciativas en vez de crear una falsa "Sin iniciativa" que
    // competiría en el ranking con las reales.
    if (!setId) continue;
    const entry =
      byInitiative.get(setId) ||
      {
        name: String(s.policySetDefinitionName || setId.split("/").pop() || "Iniciativa"),
        category: String(s.policyDefinitionCategory || "General"),
        policies: new Set<string>(),
        resources: new Set<string>(),
        total: 0,
        compliant: 0,
      };
    entry.policies.add(String(s.policyDefinitionId || ""));
    entry.resources.add(String(s.resourceId || ""));
    entry.total++;
    if (isCompliant(s.complianceState)) entry.compliant++;
    byInitiative.set(setId, entry);
  }

  return Array.from(byInitiative.entries())
    .map(([id, v]) => {
      const pct = calcCompliancePercentage(v.compliant, v.total);
      return {
        id,
        name: v.name,
        displayName: v.name,
        category: v.category,
        totalPoliciesCount: v.policies.size,
        totalEvaluatedResources: v.resources.size,
        compliancePercentage: pct,
        status: deriveInitiativeStatus(pct),
      };
    })
    .sort((a, b) => a.compliancePercentage - b.compliancePercentage);
}

/** Conteos de conformes / no conformes por asignación. */
export function countByAssignment(states: RawPolicyState[]): Map<string, { compliant: number; nonCompliant: number }> {
  const out = new Map<string, { compliant: number; nonCompliant: number }>();
  for (const s of states) {
    if (!isEvaluated(s.complianceState)) continue;
    const key = String(s.policyAssignmentId || "").toLowerCase();
    if (!key) continue;
    const entry = out.get(key) || { compliant: 0, nonCompliant: 0 };
    if (isCompliant(s.complianceState)) entry.compliant++;
    else entry.nonCompliant++;
    out.set(key, entry);
  }
  return out;
}

export function buildNonCompliantResources(
  states: RawPolicyState[],
  subscriptionNames: Map<string, string> = new Map(),
  limit = 500
): NonCompliantResourceItem[] {
  const out: NonCompliantResourceItem[] = [];
  for (const s of states) {
    if (String(s.complianceState || "").toLowerCase() !== "noncompliant") continue;
    const subId = String(s.subscriptionId || "");
    const effect = normalizeEffect(s.policyDefinitionAction);
    out.push({
      resourceId: String(s.resourceId || ""),
      resourceName: String(s.resourceName || "").trim() || String(s.resourceId || "").split("/").pop() || "—",
      resourceType: toCategoryDisplayName(s.resourceType),
      resourceGroup: String(s.resourceGroup || ""),
      subscriptionName: subscriptionNames.get(subId.toLowerCase()) || subId,
      violatedPolicyName: String(s.policyAssignmentName || s.policyDefinitionId || "").split("/").pop() || "—",
      ...(s.policyAssignmentNameKey ? { violatedPolicyNameKey: String(s.policyAssignmentNameKey) } : {}),
      policyEffect: effect,
      // Clave, no la frase: el payload sirve a los tres idiomas.
      reasonKey:
        effect === "Deny"
          ? "reasonDeny"
          : effect === "Modify" || effect === "DeployIfNotExists"
            ? "reasonModify"
            : "reasonAudit",
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function buildAutoBlockSummary(input: {
  states: RawPolicyState[];
  assignments: PolicyAssignmentItem[];
}): AutoBlockSummaryMetrics {
  const evaluated = input.states.filter((s) => isEvaluated(s.complianceState));
  const compliant = evaluated.filter((s) => isCompliant(s.complianceState)).length;
  const nonCompliant = evaluated.length - compliant;

  return {
    overallCompliancePercentage: calcCompliancePercentage(compliant, evaluated.length),
    totalCompliantCount: compliant,
    totalNonCompliantCount: nonCompliant,
    activeAssignmentsCount: input.assignments.length,
    initiatives: buildInitiativeCompliance(input.states),
    categoryCompliance: buildCategoryCompliance(input.states),
    activeAssignments: [...input.assignments].sort(
      (a, b) => b.nonCompliantResourcesCount - a.nonCompliantResourcesCount
    ),
  };
}

/** Fila cruda de `policyresources | where type == 'microsoft.authorization/policyassignments'`. */
export interface RawPolicyAssignment {
  id?: unknown;
  name?: unknown;
  properties?: {
    displayName?: unknown;
    description?: unknown;
    scope?: unknown;
    policyDefinitionId?: unknown;
    enforcementMode?: unknown;
    parameters?: Record<string, { value?: unknown }>;
    metadata?: { createdOn?: unknown };
  };
}

export function mapAssignment(
  row: RawPolicyAssignment,
  counts: Map<string, { compliant: number; nonCompliant: number }>,
  subscriptionNames: Map<string, string> = new Map()
): PolicyAssignmentItem {
  const id = String(row.id || "");
  const props = row.properties || {};
  const scopeId = String(props.scope || id.split("/providers/Microsoft.Authorization/policyAssignments/")[0] || "");
  const count = counts.get(id.toLowerCase()) || { compliant: 0, nonCompliant: 0 };
  const name = String(row.name || id.split("/").pop() || "");
  return {
    id,
    name,
    displayName: String(props.displayName || name),
    // Vacio: el panel pone el texto de respaldo, que depende del idioma.
    description: String(props.description || ""),
    scopeId,
    scopeDisplayName: deriveScopeName(scopeId, subscriptionNames),
    scopeType: deriveScopeType(scopeId),
    policyDefinitionId: String(props.policyDefinitionId || ""),
    effect: normalizeEffect(props.parameters?.effect?.value),
    nonCompliantResourcesCount: count.nonCompliant,
    compliantResourcesCount: count.compliant,
    // enforcementMode ausente equivale a `Default`, que sí aplica el efecto.
    isEnforced: String(props.enforcementMode || "Default").toLowerCase() !== "donotenforce",
    createdAt: props.metadata?.createdOn ? String(props.metadata.createdOn) : undefined,
  };
}

export function assembleLiveAutoBlock(input: {
  states: RawPolicyState[];
  assignments: PolicyAssignmentItem[];
  availableScopes: PolicyScopeOption[];
  subscriptionNames?: Map<string, string>;
}): AutoBlockPayload {
  try {
    return {
      summary: buildAutoBlockSummary({ states: input.states, assignments: input.assignments }),
      nonCompliantResources: buildNonCompliantResources(input.states, input.subscriptionNames),
      availableScopes: input.availableScopes,
      definitionTemplates: BUILT_IN_TEMPLATES,
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[azureAutoBlockPolicies] assembleLiveAutoBlock:", errorMessage(error));
    return {
      summary: buildAutoBlockSummary({ states: [], assignments: [] }),
      nonCompliantResources: [],
      availableScopes: [],
      definitionTemplates: BUILT_IN_TEMPLATES,
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset demo
// ─────────────────────────────────────────────────────────────────────────────

function tierOf(tenantId: string): "Professional" | "Business" | "Enterprise" {
  if (tenantId.includes("4444") || tenantId.includes("enterprise")) return "Enterprise";
  if (tenantId.includes("2222") || tenantId.includes("business")) return "Business";
  return "Professional";
}

const DEMO_MG = "/providers/Microsoft.Management/managementGroups";
const DEMO_SUB = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e";

const DEMO_SCOPES: PolicyScopeOption[] = [
  { id: `${DEMO_MG}/tenant-root-group`, displayName: "Tenant Root Group", type: "ManagementGroup" },
  { id: `${DEMO_MG}/operaciones`, displayName: "Operaciones", type: "ManagementGroup" },
  { id: `${DEMO_MG}/testing-cl`, displayName: "Testing CL", type: "ManagementGroup" },
  { id: DEMO_SUB, displayName: "CSCS-LandingZone", type: "Subscription" },
  { id: "/subscriptions/7b1f9a22-4c31-4d55-b0aa-9e2d6f118c40", displayName: "Produccion_RPA365", type: "Subscription" },
];

interface DemoAssignmentSeed {
  name: string;
  displayNameKey: string;
  descriptionKey: string;
  scope: number;
  effect: PolicyEffectType;
  nonCompliant: number;
  compliant: number;
  enforced?: boolean;
}

const DEMO_ASSIGNMENTS: DemoAssignmentSeed[] = [
  {
    name: "deny-vm-skus-costosas", displayNameKey: "mockPolicy_deny_vm_skus_costosas_name",
    descriptionKey: "mockPolicy_deny_vm_skus_costosas_desc",
    scope: 0, effect: "Deny", nonCompliant: 7, compliant: 41,
  },
  {
    name: "modify-heredar-costcenter", displayNameKey: "mockPolicy_modify_heredar_costcenter_name",
    descriptionKey: "mockPolicy_modify_heredar_costcenter_desc",
    scope: 0, effect: "Modify", nonCompliant: 12, compliant: 88,
  },
  {
    name: "deny-ip-publica-sandbox", displayNameKey: "mockPolicy_deny_ip_publica_sandbox_name",
    descriptionKey: "mockPolicy_deny_ip_publica_sandbox_desc",
    scope: 2, effect: "Deny", nonCompliant: 4, compliant: 16,
  },
  {
    name: "audit-storage-https", displayNameKey: "mockPolicy_audit_storage_https_name",
    descriptionKey: "mockPolicy_audit_storage_https_desc",
    scope: 0, effect: "Audit", nonCompliant: 5, compliant: 15,
  },
  {
    name: "dine-diagnosticos-law", displayNameKey: "mockPolicy_dine_diagnosticos_law_name",
    descriptionKey: "mockPolicy_dine_diagnosticos_law_desc",
    scope: 1, effect: "DeployIfNotExists", nonCompliant: 9, compliant: 33,
  },
  {
    name: "deny-regiones-no-homologadas", displayNameKey: "mockPolicy_deny_regiones_no_homologadas_name",
    descriptionKey: "mockPolicy_deny_regiones_no_homologadas_desc",
    scope: 0, effect: "Deny", nonCompliant: 2, compliant: 46,
  },
  {
    name: "audit-tags-obligatorias", displayNameKey: "mockPolicy_audit_tags_obligatorias_name",
    descriptionKey: "mockPolicy_audit_tags_obligatorias_desc",
    scope: 4, effect: "Audit", nonCompliant: 6, compliant: 12, enforced: false,
  },
];

const DEMO_INITIATIVES = [
  { id: `${DEMO_MG}/initiatives/cost-management-governance`, name: "Cost Management Governance", category: "Cost Management" },
  { id: `${DEMO_MG}/initiatives/azure-security-benchmark`, name: "Azure Security Benchmark", category: "Security Center" },
  { id: `${DEMO_MG}/initiatives/environment-tagging-standards`, name: "Environment & Tagging Standards", category: "Tags" },
  { id: `${DEMO_MG}/initiatives/operational-excellence`, name: "Operational Excellence", category: "Monitoring" },
];

const DEMO_RESOURCE_TYPES = [
  "microsoft.compute/virtualmachines",
  "microsoft.network/networkinterfaces",
  "microsoft.storage/storageaccounts",
  "microsoft.network/publicipaddresses",
  "microsoft.network/virtualnetworks",
  "microsoft.keyvault/vaults",
];

/**
 * Genera estados de política sintéticos deterministas. Se construyen los
 * `policystates` uno por uno (en vez de fabricar los agregados directamente)
 * para que la demo ejercite el mismo camino de agregación que el tenant real.
 */
export function getMockAutoBlockPayload(tenantId: string): AutoBlockPayload {
  const tier = tierOf(tenantId);
  const seedCount = tier === "Enterprise" ? 7 : tier === "Business" ? 5 : 3;
  const seeds = DEMO_ASSIGNMENTS.slice(0, seedCount);

  const states: RawPolicyState[] = [];
  let counter = 0;

  seeds.forEach((seed, seedIdx) => {
    const scope = DEMO_SCOPES[seed.scope];
    const assignmentId = `${scope.id}/providers/Microsoft.Authorization/policyAssignments/${seed.name}`;
    const initiative = DEMO_INITIATIVES[seedIdx % DEMO_INITIATIVES.length];
    const total = seed.compliant + seed.nonCompliant;

    for (let i = 0; i < total; i++) {
      counter++;
      const type = DEMO_RESOURCE_TYPES[(seedIdx + i) % DEMO_RESOURCE_TYPES.length];
      const subId = scope.type === "Subscription" ? scope.id.split("/").pop()! : "ec03e8ce-ceee-4638-b303-64ae431d5b1e";
      states.push({
        resourceId: `/subscriptions/${subId}/resourceGroups/rg-demo-${(i % 4) + 1}/providers/${type}/res-${counter}`,
        resourceName: `${type.split("/")[1].slice(0, 3)}-demo-${counter}`,
        resourceType: type,
        resourceGroup: `rg-demo-${(i % 4) + 1}`,
        subscriptionId: subId,
        complianceState: i < seed.nonCompliant ? "NonCompliant" : "Compliant",
        policyAssignmentId: assignmentId,
        policyAssignmentName: seed.name,
        policyAssignmentNameKey: seed.displayNameKey,
        policyDefinitionId: `/providers/Microsoft.Authorization/policyDefinitions/${seed.name}`,
        policySetDefinitionId: initiative.id,
        policySetDefinitionName: initiative.name,
        policyDefinitionAction: seed.effect,
        policyDefinitionCategory: initiative.category,
      });
    }
  });

  const counts = countByAssignment(states);
  const subNames = new Map(
    DEMO_SCOPES.filter((s) => s.type === "Subscription").map((s) => [
      s.id.split("/").pop()!.toLowerCase(),
      s.displayName,
    ])
  );

  const assignments: PolicyAssignmentItem[] = seeds.map((seed) => {
    const scope = DEMO_SCOPES[seed.scope];
    const id = `${scope.id}/providers/Microsoft.Authorization/policyAssignments/${seed.name}`;
    // El demo no tiene nombres de Azure: pasa las claves i18n y el panel las
    // traduce, igual que el resto del dataset de demostracion.
    return {
      ...mapAssignment(
        {
          id,
          name: seed.name,
          properties: {
            displayName: seed.name,
            description: "",
            scope: scope.id,
            policyDefinitionId: `/providers/Microsoft.Authorization/policyDefinitions/${seed.name}`,
            enforcementMode: seed.enforced === false ? "DoNotEnforce" : "Default",
            parameters: { effect: { value: seed.effect } },
            metadata: { createdOn: "2026-06-14T11:20:00Z" },
          },
        },
        counts,
        subNames
      ),
      displayNameKey: seed.displayNameKey,
      descriptionKey: seed.descriptionKey,
    };
  });

  return {
    summary: buildAutoBlockSummary({ states, assignments }),
    nonCompliantResources: buildNonCompliantResources(states, subNames),
    availableScopes: DEMO_SCOPES,
    definitionTemplates: BUILT_IN_TEMPLATES,
    source: "mock",
    lastUpdated: "2026-08-22T09:00:00.000Z",
  };
}
