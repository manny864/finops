import { NextRequest, NextResponse } from "next/server";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { getAzureCredential } from "@/lib/azure";
import { getWithCache } from "@/lib/cache";
import { redis } from "@/lib/redis";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";

async function tenantTier(tenantId: string): Promise<string> {
    const [rows] = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
    return (Array.isArray(rows) && rows.length > 0 ? (rows[0] as { tier?: string }).tier : null) || 'Essential';
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

                // 2. Fetch Subscriptions to map names
                const subRes = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', { headers });
                const subMap: Record<string, string> = {};
                if (subRes.ok) {
                    const subData = await subRes.json();
                    subData.value?.forEach((sub: any) => {
                        subMap[sub.subscriptionId] = sub.displayName;
                    });
                }

                // 3. Fetch Policy Assignments via Azure Resource Graph (cross-scope) joined with policy definitions to resolve displayName
                let assignments = [];
                const argRes = await fetch('https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01', {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
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
                        `.trim()
                    })
                });

                if (argRes.ok) {
                    const argData = await argRes.json();
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

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, policyId, displayName, action, targetMg, parameters, nonComplianceMessages, identity, location } = body;

        if (!tenantId || !policyId || !action) {
            return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        if (isMockTenant(tenantId)) {
            // Simular delay de inyección de políticas ARM
            await new Promise(r => setTimeout(r, 1000));
            return NextResponse.json({ success: true, message: `Política ${action === 'Activate' ? 'Activada' : 'Desactivada'} exitosamente (Mock)` });
        }

        // Implementation for Real Azure Policy Assignment via ARM SDK
        const credential = await getAzureCredential(tenantId);
        const token = await credential.getToken("https://management.azure.com/.default");
        
        // Target Scope
        const scope = targetMg ? `/providers/Microsoft.Management/managementGroups/${targetMg}` : `/providers/Microsoft.Management/managementGroups/TenantRootGroup`;
        
        if (action === 'Activate' || action === 'Assign') {
            // Assumes policyId is the full resource ID of the policy definition
            const assignmentName = `finops-${Date.now()}`;
            const putUrl = `https://management.azure.com${scope}/providers/Microsoft.Authorization/policyAssignments/${assignmentName}?api-version=2024-04-01`;
            
            const payload: any = {
                properties: {
                    displayName: displayName || `Asignación de Política: ${policyId.split('/').pop()}`,
                    policyDefinitionId: policyId,
                    enforcementMode: 'Default',
                }
            };

            if (parameters && Object.keys(parameters).length > 0) {
                payload.properties.parameters = {};
                for (const [key, val] of Object.entries(parameters)) {
                    payload.properties.parameters[key] = { value: val };
                }
            }

            if (nonComplianceMessages && nonComplianceMessages.length > 0) {
                payload.properties.nonComplianceMessages = nonComplianceMessages.map((msg: string) => ({ message: msg }));
            }

            if (identity) {
                payload.identity = { type: "SystemAssigned" };
                payload.location = location || "eastus";
            }
            
            const putRes = await fetch(putUrl, {
                method: 'PUT',
                headers: { 
                    'Authorization': `Bearer ${token.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!putRes.ok) {
                const errTxt = await putRes.text();
                console.error(`Azure policy assign ${putRes.status} for tenant ${tenantId}:`, errTxt);
                throw new Error(`Azure API error ${putRes.status}`);
            }
            
            // Invalidate cache
            if (redis) {
                await redis.del(`governance-policies:v2:${tenantId}`);
            }
            
            return NextResponse.json({ success: true, message: `Política asignada exitosamente en el entorno.` });
        } else if (action === 'Deactivate' || action === 'Delete') {
            // Delete assignment
            // If policyId is a full resource path, use it directly. Otherwise construct it.
            const delUrl = policyId.startsWith('/') 
                ? `https://management.azure.com${policyId}?api-version=2024-04-01`
                : `https://management.azure.com${scope}/providers/Microsoft.Authorization/policyAssignments/${policyId}?api-version=2024-04-01`;
            const delRes = await fetch(delUrl, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token.token}` }
            });
            if (!delRes.ok) {
                const errTxt = await delRes.text();
                console.error(`Azure policy delete ${delRes.status} for tenant ${tenantId}:`, errTxt);
                throw new Error(`Azure API error ${delRes.status}`);
            }
            
            if (redis) {
                await redis.del(`governance-policies:v2:${tenantId}`);
            }
            
            return NextResponse.json({ success: true, message: `Asignación de política removida en el entorno.` });
        } else {
            return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
        }
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('governance-policies POST error:', error);
        return NextResponse.json({ error: "Fallo al aplicar la política" }, { status: 500 });
    }
}
