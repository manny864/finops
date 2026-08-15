import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { GLOBAL_MANDATORY_TAGS } from "@/lib/tagConfig";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";

/** Etiquetas faltantes de un recurso, comparando sin distinguir mayusculas. */
function missingMandatoryTags(itemTags: Record<string, unknown>): string[] {
    return GLOBAL_MANDATORY_TAGS.filter(tag => {
        const tagKeyLower = tag.toLowerCase();
        const foundKey = Object.keys(itemTags).find(k => k.toLowerCase() === tagKeyLower);
        return !foundKey || !itemTags[foundKey];
    });
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 3000;

async function queryWithRetry(client: ResourceGraphClient, query: string, subs: string[], label: string) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await client.resources({ query, subscriptions: subs });
        } catch (err: any) {
            if (err.statusCode === 429 && attempt < MAX_RETRIES - 1) {
                const delay = BASE_DELAY_MS * Math.pow(1.5, attempt);
                console.warn(`[TagCompliance] 429 on "${label}". Retrying in ${delay}ms... (${attempt + 1}/${MAX_RETRIES})`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw err;
            }
        }
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');
        if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });

        // Auth: validate JWT and assert caller belongs to this tenant.
        // Cumplimiento de Etiquetas es feature Professional (ver Sidebar/routeTiers) —
        // sin gate de tier acá, sólo pertenencia al tenant.
        await requireTenantRole(req, tenantId, ['Admin', 'Owner', 'Reader', 'Colaborador']);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("tags_compliance", tenantId));
        }

        const cacheKey = `tags_compliance_v2_${tenantId}_${subscriptionId || 'all'}`;

        const fetcher = async () => {
            const credential = await getAzureCredential(tenantId);
            const client = new ResourceGraphClient(credential);

            let subs: string[] = [];
            if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
                subs = [subscriptionId];
            } else {
                subs = await getSubscriptionsForTenant(tenantId, credential);
            }

            if (subs.length === 0) {
                return {
                    complianceScore: 100,
                    allResources: [],
                    rgComplianceScore: 100,
                    resourceGroups: [],
                };
            }

            // Fetch ALL resources to evaluate them globally
            const query = `Resources | project id, name, type, resourceGroup, subscriptionId, location, tags`;
            const allResResponse = await queryWithRetry(client, query, subs, 'allResources');
            const allResourcesRaw = (allResResponse?.data || []) as any[];

            const processedResources = allResourcesRaw.map(r => {
                const itemTags = r.tags || {};
                
                const missingTags = missingMandatoryTags(itemTags);

                const isCompliant = missingTags.length === 0;

                return {
                    resourceId: r.id,
                    id: r.id,
                    name: r.name,
                    type: r.type,
                    resourceGroup: r.resourceGroup,
                    subscriptionId: r.subscriptionId,
                    location: r.location,
                    reason: isCompliant ? "Cumple con las políticas" : `Faltan etiquetas obligatorias: ${missingTags.join(', ')}`,
                    missingTags,
                    isCompliant
                };
            });

            const totalResources = processedResources.length;
            const compliantCount = processedResources.filter(r => r.isCompliant).length;
            const complianceScore = totalResources === 0 ? 100 : Math.max(0, Math.round((compliantCount / totalResources) * 100));

            // Fetch resource groups separately (they live in ResourceContainers, not Resources)
            const rgQuery = `ResourceContainers
                | where type =~ 'microsoft.resources/subscriptions/resourcegroups'
                | project id, name, type, subscriptionId, location, tags`;
            const rgResponse = await queryWithRetry(client, rgQuery, subs, 'resourceGroups');
            const rgRaw = (rgResponse?.data || []) as any[];

            const processedRGs = rgRaw.map(r => {
                const itemTags = r.tags || {};
                const missingTags = missingMandatoryTags(itemTags);
                const isCompliant = missingTags.length === 0;
                return {
                    resourceId: r.id,
                    id: r.id,
                    name: r.name,
                    type: r.type,
                    subscriptionId: r.subscriptionId,
                    location: r.location,
                    reason: isCompliant ? "Cumple con las políticas" : `Faltan etiquetas obligatorias: ${missingTags.join(', ')}`,
                    missingTags,
                    isCompliant,
                };
            });

            const totalRGs = processedRGs.length;
            const compliantRGs = processedRGs.filter(r => r.isCompliant).length;
            const rgComplianceScore = totalRGs === 0 ? 100 : Math.max(0, Math.round((compliantRGs / totalRGs) * 100));

            return {
                complianceScore,
                allResources: processedResources,
                rgComplianceScore,
                resourceGroups: processedRGs,
            };
        };

        const data = await getWithStaleWhileRevalidate(cacheKey, fetcher, 3600);

        return NextResponse.json({
            success: true,
            data
        });

    } catch (e: any) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Tag Compliance API Error:", e);
        return NextResponse.json({ success: false, error: e.message || 'Error del servidor' }, { status: 500 });
    }
}
