import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { GLOBAL_MANDATORY_TAGS } from "@/lib/tagConfig";
import { isMockTenant } from "@/lib/mockData";
import { errorStatus } from "@/lib/apiErrors";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

function missingMandatoryTags(itemTags: Record<string, unknown>): string[] {
    return GLOBAL_MANDATORY_TAGS.filter((tag) => {
        const tagKeyLower = tag.toLowerCase();
        const foundKey = Object.keys(itemTags).find((k) => k.toLowerCase() === tagKeyLower);
        return !foundKey || !itemTags[foundKey];
    });
}

async function queryWithRetry(client: ResourceGraphClient, query: string, subs: string[], label: string) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await client.resources({ query, subscriptions: subs });
        } catch (err) {
            if (errorStatus(err) === 429 && attempt < MAX_RETRIES - 1) {
                const delay = BASE_DELAY_MS * Math.pow(1.5, attempt);
                console.warn(`[TagCompliance] 429 on "${label}". Retrying in ${delay}ms... (${attempt + 1}/${MAX_RETRIES})`);
                await new Promise((r) => setTimeout(r, delay));
            } else {
                throw err;
            }
        }
    }
}

export interface TagComplianceResult {
    complianceScore: number;
    totalResources: number;
    compliantCount: number;
}

/**
 * Calcula la cobertura real de etiquetado (Tagging Coverage %) para un tenant.
 */
export async function getRealTagCompliance(tenantId: string, subscriptionId: string = "All"): Promise<TagComplianceResult> {
    if (isMockTenant(tenantId)) {
        return { complianceScore: 83.0, totalResources: 144, compliantCount: 120 };
    }

    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);

    let subs: string[] = [];
    if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
        subs = [subscriptionId];
    } else {
        subs = await getSubscriptionsForTenant(tenantId, credential);
    }

    if (subs.length === 0) {
        return { complianceScore: 100, totalResources: 0, compliantCount: 0 };
    }

    const query = `Resources | project id, name, type, resourceGroup, subscriptionId, location, tags`;
    const res = await queryWithRetry(client, query, subs, "allResources");
    const raw = (res?.data || []) as Array<{ tags?: Record<string, unknown> }>;

    const totalResources = raw.length;
    if (totalResources === 0) {
        return { complianceScore: 100, totalResources: 0, compliantCount: 0 };
    }

    let compliantCount = 0;
    for (const r of raw) {
        if (missingMandatoryTags(r.tags || {}).length === 0) {
            compliantCount++;
        }
    }

    const complianceScore = Math.max(0, Math.round((compliantCount / totalResources) * 100));
    return { complianceScore, totalResources, compliantCount };
}
