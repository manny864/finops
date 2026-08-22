/**
 * GET /api/governance/reporting — Reporting de Gobernanza.
 *
 * Combina lo que ya recolectaba `governanceReportingService` (Policy Insights
 * summarize + inventario ARG) con las consultas que el Score de Seguridad
 * Financiera necesita: higiene de etiquetas, asignaciones RBAC con detección de
 * SIDs huérfanos y conteo de recursos zombis.
 *
 * RBAC: `isMockTenant` ANTES del guard — la rama mock devuelve literales puros.
 * Antes el guard corría primero y los tenants demo recibían 401.
 * Tier mínimo: Enterprise (`/governance/reporting` en routeTiers.ts).
 * RBAC Azure mínimo: `Reader`. Todo read-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { getGovernanceReport } from "@/services/governanceReportingService";
import {
  assembleLiveGovernanceReport,
  emptyGovernanceReport,
  getMockGovernanceReportPayload,
  isPrivilegedRole,
  isOrphanedPrincipal,
  normalizePrincipalType,
  toResourceTypeLabel,
} from "@/services/azureGovernanceReporting.service";
import type {
  NonCompliantResourceDetail,
  OrphanedAssignmentDetail,
} from "@/types/azureGovernanceReporting.types";
import { errorMessage } from "@/lib/apiErrors";

/** Etiquetas que la gobernanza del tenant considera obligatorias. */
const REQUIRED_TAGS = ["CostCenter", "Environment", "Owner"];

const TAG_HYGIENE_QUERY = `
  Resources
  | extend hasAll = ${REQUIRED_TAGS.map((t) => `isnotempty(tostring(tags['${t}']))`).join(" and ")}
  | summarize tagged = countif(hasAll == true), total = count()
`;

/**
 * Zombis detectables sólo con Resource Graph. Los demás tipos requieren
 * telemetría y se dejan fuera en vez de estimarse.
 */
const ZOMBIE_QUERY = `
  Resources
  | where (type =~ 'microsoft.compute/disks' and tostring(properties.diskState) == 'Unattached')
     or (type =~ 'microsoft.network/networkinterfaces' and isnull(properties.virtualMachine))
     or (type =~ 'microsoft.network/publicipaddresses' and isnull(properties.ipConfiguration))
  | summarize zombies = count()
`;

/**
 * `authorizationresources` trae las asignaciones de rol. El nombre del rol vive
 * en la definición, así que se resuelve con una segunda consulta y join en
 * memoria: el ARM ID del roleDefinition por sí solo no dice si es Owner.
 */
const ROLE_ASSIGNMENTS_QUERY = `
  authorizationresources
  | where type =~ 'microsoft.authorization/roleassignments'
  | project id,
            principalId = tostring(properties.principalId),
            principalType = tostring(properties.principalType),
            roleDefinitionId = tolower(tostring(properties.roleDefinitionId)),
            scope = tostring(properties.scope)
  | limit 3000
`;

const ROLE_DEFINITIONS_QUERY = `
  authorizationresources
  | where type =~ 'microsoft.authorization/roledefinitions'
  | project defId = tolower(tostring(id)), roleName = tostring(properties.roleName)
  | limit 1000
`;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
    }

    if (
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    ) {
      return NextResponse.json(getMockGovernanceReportPayload(tenantId));
    }

    await requireTenantTier(request, tenantId, "Enterprise");

    const payload = await getWithStaleWhileRevalidate(
      `governance-reporting:v2:${tenantId}`,
      async () => {
        const credential = await getAzureCredential(tenantId).catch(() => null);
        if (!credential) {
          // Vacío legítimo, nunca el dataset demo (Directiva 24.1).
          return emptyGovernanceReport();
        }

        const subscriptions = await getSubscriptionsForTenant(tenantId, credential);
        if (subscriptions.length === 0) return emptyGovernanceReport();

        const client = await getResourceGraphClient(tenantId);
        const [base, tagRes, zombieRes, raRes, rdRes, subNames] = await Promise.all([
          getGovernanceReport(tenantId).catch((e) => {
            console.warn("[GovernanceReporting] informe base no disponible:", errorMessage(e));
            return null;
          }),
          withArgLimit(() => client.resources({ query: TAG_HYGIENE_QUERY, subscriptions })).catch(() => ({ data: [] })),
          withArgLimit(() => client.resources({ query: ZOMBIE_QUERY, subscriptions })).catch(() => ({ data: [] })),
          withArgLimit(() => client.resources({ query: ROLE_ASSIGNMENTS_QUERY, subscriptions })).catch(() => ({ data: [] })),
          withArgLimit(() => client.resources({ query: ROLE_DEFINITIONS_QUERY, subscriptions })).catch(() => ({ data: [] })),
          getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>()),
        ]);

        const tagRow = ((tagRes.data || []) as Array<{ tagged?: number; total?: number }>)[0] || {};
        const zombieRow = ((zombieRes.data || []) as Array<{ zombies?: number }>)[0] || {};

        const roleNames = new Map<string, string>();
        for (const r of (rdRes.data || []) as Array<{ defId?: string; roleName?: string }>) {
          if (r.defId) roleNames.set(String(r.defId), String(r.roleName || ""));
        }

        const rbacAssignments: OrphanedAssignmentDetail[] = (
          (raRes.data || []) as Array<Record<string, unknown>>
        ).map((r) => {
          const scope = String(r.scope || "");
          const subGuid = scope.split("/subscriptions/")[1]?.split("/")[0] || "";
          const roleName = roleNames.get(String(r.roleDefinitionId || "")) || "Rol desconocido";
          return {
            assignmentId: String(r.id || ""),
            principalId: String(r.principalId || ""),
            principalType: normalizePrincipalType(r.principalType),
            roleName,
            scopeDisplayName: subGuid ? subNames.get(subGuid.toLowerCase()) || subGuid : scope || "—",
            isPrivileged: isPrivilegedRole(roleName),
            isOrphaned: isOrphanedPrincipal(r.principalType),
          };
        });

        const totalResources = base?.resourceInventory.total ?? Number(tagRow.total) ?? 0;
        const nonCompliant = base?.policyCompliance.nonCompliantResources ?? 0;
        const policyAvailable = Boolean(base?.policyCompliance.available);

        const nonCompliantResources: NonCompliantResourceDetail[] = (
          base?.policyCompliance.detail?.nonCompliantResources || []
        ).map((r) => {
          const subGuid = String(r.resourceId || "").split("/subscriptions/")[1]?.split("/")[0] || "";
          return {
            resourceId: String(r.resourceId || ""),
            resourceName: String(r.name || "").trim() || String(r.resourceId || "").split("/").pop() || "—",
            resourceType: toResourceTypeLabel(r.type),
            subscriptionName: subNames.get(subGuid.toLowerCase()) || subGuid || "—",
            violatedPolicyName: String(r.policyName || r.assignmentName || "—"),
            // La consulta base no trae el efecto de la definición; no se
            // inventa uno: la UI muestra el guion y el drawer explica que hay
            // que abrir la política en el módulo Auto-Block para verlo.
            policyEffect: "—",
          };
        });

        return assembleLiveGovernanceReport({
          score: {
            compliantResources: Math.max(0, totalResources - nonCompliant),
            nonCompliantResources: nonCompliant,
            policyDataAvailable: policyAvailable,
            taggedResources: Number(tagRow.tagged) || 0,
            totalResources,
            totalRbacAssignments: rbacAssignments.length,
            orphanedSids: rbacAssignments.filter((a) => a.isOrphaned).length,
            zombieResources: Number(zombieRow.zombies) || 0,
          },
          subscriptionsCount: subscriptions.length,
          activePolicyAssignmentsCount: base?.policyCompliance.policyAssignments ?? 0,
          nonCompliantPoliciesCount: base?.policyCompliance.nonCompliantPolicies ?? 0,
          resourceTypeRows: (base?.resourceInventory.byType || []).map((t) => ({ type: t.type, count: t.count })),
          regionRows: (base?.resourceInventory.byLocation || []).map((l) => ({
            location: l.location,
            count: l.count,
          })),
          rbacAssignments,
          nonCompliantResources,
        });
      },
      1800,
      600
    );

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API GovernanceReporting] Error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno generando el reporte de gobernanza" }, { status: 500 });
  }
}
