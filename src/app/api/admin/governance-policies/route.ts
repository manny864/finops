import { NextRequest, NextResponse } from "next/server";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { getAzureCredential, getResourceGraphClient, listTenantSubscriptions } from "@/lib/azure";
import { getWithCache } from "@/lib/cache";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";

async function tenantTier(tenantId: string): Promise<string> {
    const [rows] = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
    return (Array.isArray(rows) && rows.length > 0 ? (rows[0] as { tier?: string }).tier : null) || 'Professional';
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);
        const userTier = await tenantTier(tenantId);

        if (!hasAccess(userTier, 'Enterprise')) {
            return NextResponse.json({ error: "Funcionalidad requiere plan Enterprise o superior." }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('governance-policies', tenantId));
        }

        try {
            const cacheKey = `governance-policies:v2:${tenantId}`;
            const realData = await getWithCache(cacheKey, async () => {
                const credential = await getAzureCredential(tenantId);
                const token = await credential.getToken("https://management.azure.com/.default");
                const headers = { 'Authorization': `Bearer ${token.token}` };

                // 1. Fetch Management Groups
                const mgRes = await fetch('https://management.azure.com/providers/Microsoft.Management/managementGroups?api-version=2020-05-01', { headers });
                if (mgRes.status === 403) throw new Error("Faltan permisos de lectura (Reader) a nivel Tenant Root Group");
                if (!mgRes.ok) throw new Error("Error al obtener Management Groups");
                
                const mgData = await mgRes.json();
                const managementGroups = mgData.value?.map((mg: any) => ({
                    id: mg.name,
                    name: mg.properties?.displayName || mg.name
                })) || [];

                // 2. Fetch Subscriptions to map names (sólo las de este
                // directorio: ver listTenantSubscriptions en lib/azure)
                const subMap: Record<string, string> = {};
                for (const sub of await listTenantSubscriptions(tenantId, credential)) {
                    subMap[sub.subscriptionId] = String(sub.displayName || sub.subscriptionId);
                }

                // 3. Fetch Policy Assignments via Azure Resource Graph (cross-scope) joined with policy definitions to resolve displayName.
                // Scope: el MG raíz del tenant. Las asignaciones también viven en los MG, y un
                // scope de suscripciones las dejaría afuera. Si ARG falla, sin asignaciones, como antes.
                let assignments = [];
                const argClient = await getResourceGraphClient(tenantId, credential);
                const argData: any = await argClient
                    .resources({
                        managementGroups: [tenantId],
                        query: `
                            policyresources
                            | where type == 'microsoft.authorization/policyassignments'
                            | extend defId = tolower(tostring(properties.policyDefinitionId))
                            | join kind=leftouter (
                                policyresources
                                | where type in~ ('microsoft.authorization/policydefinitions','microsoft.authorization/policysetdefinitions')
                                | project defId = tolower(id), defDisplayName = tostring(properties.displayName), defDescription = tostring(properties.description)
                            ) on defId
                            | project id, name, properties, defDisplayName, defDescription, defId
                        `.trim(),
                    })
                    .catch((e) => {
                        console.warn('governance-policies: Resource Graph falló:', e?.message ?? e);
                        return null;
                    });

                if (argData) {
                    assignments = argData.data?.map((a: any) => {
                        const isGuid = (s: any) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
                        // Prefer assignment displayName, then linked definition displayName, then last segment of defId, then 'Política sin nombre'
                        const defIdLast = (a.defId || '').split('/').filter(Boolean).pop() || '';
                        const fallbackFromDef = !isGuid(defIdLast) && defIdLast ? defIdLast.replace(/[-_]/g, ' ') : '';
                        let name = a.properties?.displayName || a.defDisplayName || fallbackFromDef || 'Política sin nombre';
                        // Si name sigue siendo el GUID de la asignación, formatea legible
                        if (isGuid(name)) name = a.defDisplayName || fallbackFromDef || `Política ${String(name).slice(0,8)}`;
                        // Regex to find and replace subscription ID with name
                        name = name.replace(/subscription:?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i, (match: string, p1: string) => {
                            return `Suscripción: ${subMap[p1.toLowerCase()] || p1}`;
                        });
                        let targetMg = 'TenantRootGroup';
                        const mgMatch = a.id?.match(/\/managementGroups\/([^\/]+)/i);
                        if (mgMatch) targetMg = mgMatch[1];
                        else {
                            const subMatch = a.id?.match(/\/subscriptions\/([^\/]+)/i);
                            if (subMatch) targetMg = subMatch[1];
                        }

                        return {
                            id: a.id,
                            name: name,
                            description: a.properties?.description || a.defDescription || 'Política de Gobernanza',
                            status: a.properties?.enforcementMode === 'DoNotEnforce' ? 'Inactive' : 'Active',
                            targetMg: targetMg
                        };
                    }) || [];
                }

                const subscriptions = Object.keys(subMap).map(id => ({ id, name: subMap[id] }));

                return { managementGroups, subscriptions, data: assignments };
            }, 300); // 5 min cache

            return NextResponse.json({ success: true, managementGroups: realData.managementGroups, subscriptions: realData.subscriptions, data: realData.data });
        } catch (e) {
            console.error('governance-policies GET azure error:', e);
            return NextResponse.json({ error: "Fallo al consultar Azure" }, { status: 403 });
        }

    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('governance-policies error:', error);
        return NextResponse.json({ error: "Fallo al obtener estado de políticas" }, { status: 500 });
    }
}
