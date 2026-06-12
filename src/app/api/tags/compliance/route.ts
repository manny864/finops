import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "@/modules/core/kqlCatalog";

const MANDATORY_TAGS = ['Environment', 'CostCenter'];

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');
        if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });

        const credential = await getAzureCredential(tenantId);
        const client = new ResourceGraphClient(credential);

        let subs: string[] = [];
        if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
            subs = [subscriptionId];
        } else {
            subs = await getSubscriptionsForTenant(tenantId, credential);
        }

        if (subs.length === 0) {
            return NextResponse.json({
                success: true,
                data: {
                    complianceScore: 100,
                    violatingResources: []
                }
            });
        }

        // Execute queries concurrently
        const [untaggedResponse, missingTagsResponse, totalRes] = await Promise.all([
            client.resources({ query: kqlCatalog.completelyUntaggedResources, subscriptions: subs }),
            client.resources({ query: kqlCatalog.missingMandatoryTags, subscriptions: subs }),
            client.resources({ query: "Resources | summarize count()", subscriptions: subs })
        ]);

        const untagged = (untaggedResponse.data || []) as any[];
        const missing = (missingTagsResponse.data || []) as any[];
        const totalResources = totalRes.data?.[0]?.count_ || 0;

        const violatingResources: any[] = [];
        const seenIds = new Set<string>();

        // 1. Process completely untagged resources
        for (const r of untagged) {
            const idLower = r.id.toLowerCase();
            if (!seenIds.has(idLower)) {
                seenIds.add(idLower);
                violatingResources.push({
                    resourceId: r.id,
                    id: r.id,
                    name: r.name,
                    type: r.type,
                    resourceGroup: r.resourceGroup,
                    subscriptionId: r.subscriptionId,
                    location: r.location,
                    reason: "Completamente sin etiquetas",
                    missingTags: [...MANDATORY_TAGS]
                });
            }
        }

        // 2. Process resources missing mandatory tags
        for (const r of missing) {
            const idLower = r.id.toLowerCase();
            if (!seenIds.has(idLower)) {
                seenIds.add(idLower);
                const itemTags = r.tags || {};
                
                // Get missing mandatory tags keys
                const missingTags = MANDATORY_TAGS.filter(tag => {
                    const tagKeyLower = tag.toLowerCase();
                    // Match case-insensitive keys
                    const foundKey = Object.keys(itemTags).find(k => k.toLowerCase() === tagKeyLower);
                    return !foundKey || !itemTags[foundKey];
                });

                if (missingTags.length > 0) {
                    violatingResources.push({
                        resourceId: r.id,
                        id: r.id,
                        name: r.name,
                        type: r.type,
                        resourceGroup: r.resourceGroup,
                        subscriptionId: r.subscriptionId,
                        location: r.location,
                        reason: `Faltan etiquetas obligatorias: ${missingTags.join(', ')}`,
                        missingTags
                    });
                }
            }
        }

        // Compute compliance score
        const compliantCount = totalResources - violatingResources.length;
        const complianceScore = totalResources === 0 ? 100 : Math.max(0, Math.round((compliantCount / totalResources) * 100));

        return NextResponse.json({
            success: true,
            data: {
                complianceScore,
                violatingResources
            }
        });

    } catch (e: any) {
        console.error("Tag Compliance API Error:", e);
        return NextResponse.json({ success: false, error: e.message || 'Error del servidor' }, { status: 500 });
    }
}

