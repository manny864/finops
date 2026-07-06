/**
 * governanceReportingService — Reporting de gobernanza (3 vistas):
 *   1. Cumplimiento de Azure Policy (PolicyInsights summarize REST, rol Reader).
 *   2. Inventario de recursos (Resource Graph: por tipo y por región).
 *   3. Inventario de identidades/roles (Resource Graph authorizationresources).
 *
 * Todo read-only con roles ya presentes en el tier Essential (Reader). Ninguna
 * de las tres consultas muta nada.
 */
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";

async function rg(client: ResourceGraphClient, query: string, subscriptions: string[]): Promise<any[]> {
    try {
        const res: any = await client.resources({ query, subscriptions });
        return (res?.data as any[]) || [];
    } catch (e: any) {
        console.warn("[governanceReporting] RG query failed:", e?.message);
        return [];
    }
}

export interface PolicyComplianceDetail {
    nonCompliantResources: Array<{ resourceId: string; name: string; type: string; policyName: string; assignmentName: string }>;
    nonCompliantPolicies: Array<{ name: string; count: number }>;
    assignments: Array<{ name: string; scope: string; nonCompliantCount: number }>;
}

export interface GovernanceReport {
    success: true;
    mock: false;
    subscriptionsEvaluated: number;
    policyCompliance: { nonCompliantResources: number; nonCompliantPolicies: number; policyAssignments: number; available: boolean; detail?: PolicyComplianceDetail };
    resourceInventory: { total: number; byType: Array<{ type: string; count: number }>; byLocation: Array<{ location: string; count: number }> };
    identities: { totalAssignments: number; byPrincipalType: Array<{ principalType: string; count: number }> };
}

/**
 * Detalle del cumplimiento de Azure Policy vía Resource Graph
 * (`policyresources`, read-only, rol Reader): estados NonCompliant a nivel
 * recurso, agregado por definición de política y lista de asignaciones con su
 * conteo de no conformes. Los GUIDs de definiciones/asignaciones se resuelven
 * a displayName con dos queries adicionales y join en memoria.
 */
async function getPolicyComplianceDetail(client: ResourceGraphClient, subs: string[]): Promise<PolicyComplianceDetail> {
    const states = await rg(
        client,
        `policyresources
         | where type =~ 'microsoft.policyinsights/policystates'
         | where tostring(properties.complianceState) =~ 'NonCompliant'
         | project resourceId = tostring(properties.resourceId),
                   resourceType = tostring(properties.resourceType),
                   policyDefId = tolower(tostring(properties.policyDefinitionId)),
                   assignmentId = tolower(tostring(properties.policyAssignmentId))
         | limit 400`,
        subs
    );

    const definitions = await rg(
        client,
        `policyresources
         | where type =~ 'microsoft.authorization/policydefinitions'
         | project id = tolower(id), displayName = tostring(properties.displayName)
         | limit 1000`,
        subs
    );
    const assignments = await rg(
        client,
        `policyresources
         | where type =~ 'microsoft.authorization/policyassignments'
         | project id = tolower(id), displayName = tostring(properties.displayName), scope = tostring(properties.scope)
         | limit 500`,
        subs
    );

    const defName = new Map<string, string>(definitions.map(d => [String(d.id), String(d.displayName || "")]));
    const asgMeta = new Map<string, { name: string; scope: string }>(
        assignments.map(a => [String(a.id), { name: String(a.displayName || a.id.split("/").pop() || ""), scope: String(a.scope || "") }])
    );

    const lastSegment = (id: string) => id.split("/").pop() || id;

    const nonCompliantResources = states.slice(0, 200).map(s => ({
        resourceId: String(s.resourceId || ""),
        name: lastSegment(String(s.resourceId || "")),
        type: String(s.resourceType || "unknown"),
        policyName: defName.get(String(s.policyDefId)) || lastSegment(String(s.policyDefId || "")),
        assignmentName: asgMeta.get(String(s.assignmentId))?.name || lastSegment(String(s.assignmentId || "")),
    }));

    const byPolicy = new Map<string, number>();
    const byAssignment = new Map<string, number>();
    for (const s of states) {
        const p = defName.get(String(s.policyDefId)) || lastSegment(String(s.policyDefId || ""));
        byPolicy.set(p, (byPolicy.get(p) || 0) + 1);
        byAssignment.set(String(s.assignmentId), (byAssignment.get(String(s.assignmentId)) || 0) + 1);
    }

    const nonCompliantPolicies = Array.from(byPolicy.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 100);

    const assignmentList = assignments.map(a => ({
        name: String(a.displayName || lastSegment(String(a.id))),
        scope: String(a.scope || ""),
        nonCompliantCount: byAssignment.get(String(a.id)) || 0,
    })).sort((a, b) => b.nonCompliantCount - a.nonCompliantCount).slice(0, 100);

    return { nonCompliantResources, nonCompliantPolicies, assignments: assignmentList };
}

async function getPolicyCompliance(credential: any, subs: string[]): Promise<GovernanceReport["policyCompliance"]> {
    let nonCompliantResources = 0, nonCompliantPolicies = 0, policyAssignments = 0, available = false;
    let token: string | null = null;
    try {
        token = (await credential.getToken("https://management.azure.com/.default"))?.token ?? null;
    } catch { /* sin token */ }
    if (!token) return { nonCompliantResources, nonCompliantPolicies, policyAssignments, available };

    for (const sub of subs) {
        try {
            const url = `https://management.azure.com/subscriptions/${sub}/providers/Microsoft.PolicyInsights/policyStates/latest/summarize?api-version=2019-10-01`;
            const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
            if (!res.ok) continue;
            const json: any = await res.json();
            const results = json?.value?.[0]?.results ?? {};
            nonCompliantResources += Number(results?.nonCompliantResources ?? 0);
            nonCompliantPolicies += Number(results?.nonCompliantPolicies ?? 0);
            policyAssignments += (json?.value?.[0]?.policyAssignments?.length ?? 0);
            available = true;
        } catch (e: any) {
            console.warn(`[governanceReporting] policy summarize failed for ${sub}:`, e?.message);
        }
    }
    return { nonCompliantResources, nonCompliantPolicies, policyAssignments, available };
}

export async function getGovernanceReport(tenantId: string): Promise<GovernanceReport> {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    const client = new ResourceGraphClient(credential);

    // --- Inventario de recursos ---
    const byTypeRows = await rg(client, "Resources | summarize count_ = count() by type | order by count_ desc | limit 15", subs);
    const byLocRows = await rg(client, "Resources | summarize count_ = count() by location | order by count_ desc | limit 10", subs);
    const totalRows = await rg(client, "Resources | summarize count_ = count()", subs);
    const total = Number(totalRows?.[0]?.count_ ?? 0);

    // --- Identidades / roles (asignaciones por tipo de principal) ---
    const idRows = await rg(
        client,
        "authorizationresources | where type =~ 'microsoft.authorization/roleassignments' | extend pType = tostring(properties.principalType) | summarize count_ = count() by pType | order by count_ desc",
        subs
    );
    const totalAssignments = idRows.reduce((s, r) => s + Number(r.count_ ?? 0), 0);

    // --- Cumplimiento de Azure Policy (resumen + detalle) ---
    const policyCompliance = await getPolicyCompliance(credential, subs);
    if (policyCompliance.available) {
        try {
            policyCompliance.detail = await getPolicyComplianceDetail(client, subs);
        } catch (e: any) {
            console.warn("[governanceReporting] policy detail failed:", e?.message);
        }
    }

    return {
        success: true,
        mock: false,
        subscriptionsEvaluated: subs.length,
        policyCompliance,
        resourceInventory: {
            total,
            byType: byTypeRows.map(r => ({ type: String(r.type ?? "unknown"), count: Number(r.count_ ?? 0) })),
            byLocation: byLocRows.map(r => ({ location: String(r.location ?? "unknown"), count: Number(r.count_ ?? 0) })),
        },
        identities: {
            totalAssignments,
            byPrincipalType: idRows.map(r => ({ principalType: String(r.pType || "Unknown"), count: Number(r.count_ ?? 0) })),
        },
    };
}
