import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "@/modules/core/kqlCatalog";

const MANDATORY_TAGS = ['Environment', 'CostCenter'];
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

        // Execute queries SEQUENTIALLY with retry to avoid 429 throttling
        const untaggedResponse = await queryWithRetry(client, kqlCatalog.completelyUntaggedResources, subs, 'untagged');
        const missingTagsResponse = await queryWithRetry(client, kqlCatalog.missingMandatoryTags, subs, 'missingTags');
        const totalRes = await queryWithRetry(client, "Resources | summarize count()", subs, 'totalCount');

        const untagged = (untaggedResponse?.data || []) as any[];
        const missing = (missingTagsResponse?.data || []) as any[];
        const totalResources = totalRes?.data?.[0]?.count_ || 0;

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

                const missingTags = MANDATORY_TAGS.filter(tag => {
                    const tagKeyLower = tag.toLowerCase();
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

