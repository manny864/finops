/**
 * GET /api/governance/auto-block
 * Políticas (Auto-Block) — estado de cumplimiento de Azure Policy.
 *
 * Lee `policyresources`: los `policystates` de Policy Insights y las
 * `policyassignments` activas. Reemplaza a
 * /api/governance/policies/compliance-overview, que estimaba el cumplimiento
 * con una heurística fija (25% no conforme) y caía al dataset demo en tres
 * puntos distintos del camino live.
 *
 * RBAC: `isMockTenant` ANTES del guard — la rama mock devuelve literales puros.
 * Tier mínimo: Enterprise (`/governance/policies` en routeTiers.ts).
 * RBAC Azure mínimo: `Reader` (ARG expone policyresources). Sin escritura.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { errorMessage } from "@/lib/apiErrors";
import {
  assembleLiveAutoBlock,
  countByAssignment,
  getMockAutoBlockPayload,
  mapAssignment,
  type RawPolicyAssignment,
  type RawPolicyState,
} from "@/services/azureAutoBlockPolicies.service";
import type { PolicyScopeOption } from "@/types/azureAutoBlockPolicies.types";

/**
 * `policystates` guarda una fila por recurso y política evaluada. Se acota a
 * `latest` (la última evaluación) y se limita el volumen: un tenant grande
 * puede tener millones de filas y sólo se necesitan los agregados más el
 * detalle de las infracciones.
 */
const POLICY_STATES_QUERY = `
  policyresources
  | where type =~ 'microsoft.policyinsights/policystates'
  | project resourceId = tostring(properties.resourceId),
            resourceType = tostring(properties.resourceType),
            complianceState = tostring(properties.complianceState),
            policyAssignmentId = tostring(properties.policyAssignmentId),
            policyAssignmentName = tostring(properties.policyAssignmentName),
            policyDefinitionId = tostring(properties.policyDefinitionId),
            policySetDefinitionId = tostring(properties.policySetDefinitionId),
            policySetDefinitionName = tostring(properties.policySetDefinitionName),
            policyDefinitionAction = tostring(properties.policyDefinitionAction),
            policyDefinitionCategory = tostring(properties.policyDefinitionGroupNames),
            subscriptionId = tostring(properties.subscriptionId),
            resourceGroup = tostring(properties.resourceGroup)
  | extend resourceName = tostring(split(resourceId, '/')[-1])
  | limit 5000
`;

const ASSIGNMENTS_QUERY = `
  policyresources
  | where type =~ 'microsoft.authorization/policyassignments'
  | project id, name, properties
  | limit 500
`;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    if (
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    ) {
      return NextResponse.json(getMockAutoBlockPayload(tenantId));
    }

    await requireTenantTier(request, tenantId, "Enterprise");

    const payload = await getWithStaleWhileRevalidate(
      `auto-block:v1:${tenantId}`,
      async () => {
        const credential = await getAzureCredential(tenantId).catch(() => null);
        if (!credential) {
          // Vacío legítimo, nunca el dataset demo (Directiva 24.1).
          return assembleLiveAutoBlock({ states: [], assignments: [], availableScopes: [] });
        }

        const subscriptions = await getSubscriptionsForTenant(tenantId, credential);
        if (subscriptions.length === 0) {
          return assembleLiveAutoBlock({ states: [], assignments: [], availableScopes: [] });
        }

        const client = await getResourceGraphClient(tenantId);
        const [statesRes, assignmentsRes, subNames] = await Promise.all([
          withArgLimit(() => client.resources({ query: POLICY_STATES_QUERY, subscriptions })).catch((e) => {
            console.warn("[AutoBlock] policystates no disponible:", errorMessage(e));
            return { data: [] };
          }),
          withArgLimit(() => client.resources({ query: ASSIGNMENTS_QUERY, subscriptions })).catch((e) => {
            console.warn("[AutoBlock] policyassignments no disponible:", errorMessage(e));
            return { data: [] };
          }),
          getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>()),
        ]);

        const states = ((statesRes.data || []) as RawPolicyState[]) ?? [];
        const counts = countByAssignment(states);
        const assignments = ((assignmentsRes.data || []) as RawPolicyAssignment[]).map((row) =>
          mapAssignment(row, counts, subNames)
        );

        // Los scopes disponibles para desplegar salen de las asignaciones ya
        // existentes más las suscripciones visibles: no se listan management
        // groups a los que el Service Principal no tenga alcance, porque un
        // deploy contra ellos fallaría con 403 recién al confirmarlo.
        const scopeMap = new Map<string, PolicyScopeOption>();
        for (const a of assignments) {
          if (a.scopeId) {
            scopeMap.set(a.scopeId, {
              id: a.scopeId,
              displayName: a.scopeDisplayName,
              type: a.scopeType,
            });
          }
        }
        for (const sub of subscriptions) {
          const id = `/subscriptions/${sub}`;
          if (!scopeMap.has(id)) {
            scopeMap.set(id, {
              id,
              displayName: subNames.get(sub.toLowerCase()) || sub,
              type: "Subscription",
            });
          }
        }

        return assembleLiveAutoBlock({
          states,
          assignments,
          availableScopes: Array.from(scopeMap.values()),
          subscriptionNames: subNames,
        });
      },
      900,
      300
    );

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API AutoBlock] Error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno procesando el cumplimiento de políticas" }, { status: 500 });
  }
}
