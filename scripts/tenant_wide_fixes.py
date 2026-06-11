import os

def modify_file(filepath, replacements):
    print(f"Modifying {filepath}...")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    original_content = content
    for old_str, new_str in replacements:
        if old_str not in content:
            print(f"WARNING: Could not find exact text match for replacement in {filepath}.")
            print(f"Looking for:\n{old_str[:150]}...")
            continue
        content = content.replace(old_str, new_str)
    
    if content != original_content:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Successfully modified {filepath}.")
    else:
        print(f"No changes made to {filepath}.")

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

    # 1. src/lib/azure.ts - Add getSubscriptionsForTenant helper
    azure_path = os.path.join(base_dir, "src/lib/azure.ts")
    azure_replacements = [
        (
            "export async function getComputeClient(tenantId: string, subscriptionId: string) {",
            "export async function getSubscriptionsForTenant(tenantId: string, credential?: ClientSecretCredential): Promise<string[]> {\n  const cred = credential || await getAzureCredential(tenantId);\n  const subs: string[] = [];\n  try {\n    const tokenResponse = await cred.getToken(\"https://management.azure.com/.default\");\n    const fetchRes = await fetch(\"https://management.azure.com/subscriptions?api-version=2020-01-01\", {\n        headers: { \"Authorization\": `Bearer ${tokenResponse.token}` }\n    });\n    if (fetchRes.ok) {\n        const data = await fetchRes.json();\n        for (const sub of (data.value || [])) {\n            if (sub.subscriptionId) subs.push(sub.subscriptionId);\n        }\n    }\n  } catch (e) {\n    console.error(`[azure] Error fetching subscriptions for tenant ${tenantId}:`, e);\n  }\n  return subs;\n}\n\nexport async function getComputeClient(tenantId: string, subscriptionId: string) {"
        )
    ]
    modify_file(azure_path, azure_replacements)

    # 2. src/services/auditService.ts - Optimize runInBatches and runGraphAudits
    audit_path = os.path.join(base_dir, "src/services/auditService.ts")
    old_run_in_batches = """async function runInBatches(client: ResourceGraphClient, queries: {key: string, query: string}[], batchSize = 2, subscriptions: string[] = []) {
    const getQuery = (query: string) => ({
        subscriptions,
        query
    });

    const results: any = {};
    for (let i = 0; i < queries.length; i += batchSize) {
        const batch = queries.slice(i, i + batchSize);
        const batchPromises = batch.map(async (q) => {
            try {
                let res;
                try {
                    res = await client.resources(getQuery(q.query));
                } catch (e: any) {
                    if (e.statusCode === 429 || (e.code && e.code === 'RateLimiting')) {
                        console.warn(`[Audit] Rate Limited (429) en ${q.key}. Reintentando en 3s...`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        res = await client.resources(getQuery(q.query));
                    } else {
                        throw e;
                    }
                }
                return { key: q.key, data: res.data };
            } catch (e) {
                console.warn(`Query ${q.key} failed:`, e);
                return { key: q.key, data: [] };
            }
        });
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(r => results[r.key] = r.data);
        
        if (i + batchSize < queries.length) {
            await new Promise(resolve => setTimeout(resolve, 1500)); // 1500ms delay to prevent 429
        }
    }
    return results;
}"""

    new_run_in_batches = """async function runInBatches(client: ResourceGraphClient, queries: {key: string, query: string}[], batchSize = 2, subscriptions: string[] = [], delayMs = 1500) {
    const getQuery = (query: string) => ({
        subscriptions,
        query
    });

    const results: any = {};
    for (let i = 0; i < queries.length; i += batchSize) {
        const batch = queries.slice(i, i + batchSize);
        const batchPromises = batch.map(async (q) => {
            let retries = 3;
            let currentDelay = 3000;
            while (retries > 0) {
                try {
                    const res = await client.resources(getQuery(q.query));
                    return { key: q.key, data: res.data };
                } catch (e: any) {
                    const isRateLimit = e.statusCode === 429 || (e.code && e.code === 'RateLimiting');
                    if (isRateLimit && retries > 1) {
                        console.warn(`[Audit] Rate Limited (429) en ${q.key}. Reintentando en ${currentDelay}ms... (Intentos restantes: ${retries - 1})`);
                        await new Promise(resolve => setTimeout(resolve, currentDelay));
                        currentDelay *= 1.5;
                        retries--;
                    } else {
                        console.warn(`Query ${q.key} failed after retries:`, e.message || e);
                        return { key: q.key, data: [] };
                    }
                }
            }
            return { key: q.key, data: [] };
        });
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(r => results[r.key] = r.data);
        
        if (i + batchSize < queries.length) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    return results;
}"""

    audit_replacements = [
        (old_run_in_batches, new_run_in_batches),
        (
            "const results = await runInBatches(client, queryList, 5, subs);",
            "const results = await runInBatches(client, queryList, 12, subs, 4500);"
        )
    ]
    modify_file(audit_path, audit_replacements)

    # 3. src/app/api/tags/compliance/route.ts - Read subscriptionId and filter
    tags_comp_path = os.path.join(base_dir, "src/app/api/tags/compliance/route.ts")
    tags_comp_replacements = [
        (
            "import { getAzureCredential } from \"@/lib/azure\";",
            "import { getAzureCredential, getSubscriptionsForTenant } from \"@/lib/azure\";"
        ),
        (
            "        const tenantId = searchParams.get('tenantId');\n        if (!tenantId) return NextResponse.json({ error: \"Missing tenantId\" }, { status: 400 });\n\n        // Get active policies",
            "        const tenantId = searchParams.get('tenantId');\n        const subscriptionId = searchParams.get('subscriptionId');\n        if (!tenantId) return NextResponse.json({ error: \"Missing tenantId\" }, { status: 400 });\n\n        // Get active policies"
        ),
        (
            "        const credential = await getAzureCredential(tenantId);\n        const client = new ResourceGraphClient(credential);\n\n        let totalResources = 0;\n        let nonCompliant: any[] = [];\n\n        // Get total resources count\n        const totalRes = await client.resources({ query: \"Resources | summarize count()\" });",
            "        const credential = await getAzureCredential(tenantId);\n        const client = new ResourceGraphClient(credential);\n\n        let subs: string[] | undefined = undefined;\n        if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {\n            subs = [subscriptionId];\n        } else {\n            subs = await getSubscriptionsForTenant(tenantId, credential);\n        }\n\n        let totalResources = 0;\n        let nonCompliant: any[] = [];\n\n        // Get total resources count\n        const totalRes = await client.resources({ query: \"Resources | summarize count()\", subscriptions: subs });"
        ),
        (
            "            const ncRes = await client.resources({ query: nonCompliantQuery });",
            "            const ncRes = await client.resources({ query: nonCompliantQuery, subscriptions: subs });"
        )
    ]
    modify_file(tags_comp_path, tags_comp_replacements)

    # 4. src/app/api/recommendations/route.ts - Filter subscriptions
    recs_path = os.path.join(base_dir, "src/app/api/recommendations/route.ts")
    recs_replacements = [
        (
            "import { getResourceGraphClient } from \"@/lib/azure\";",
            "import { getResourceGraphClient, getAzureCredential, getSubscriptionsForTenant } from \"@/lib/azure\";"
        ),
        (
            "    const queryOptions: any = {};\n    if (subscriptionId) {\n        queryOptions.subscriptions = [subscriptionId];\n    }",
            "    const queryOptions: any = {};\n    if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {\n        queryOptions.subscriptions = [subscriptionId];\n    } else {\n        const credential = await getAzureCredential(tenantId);\n        queryOptions.subscriptions = await getSubscriptionsForTenant(tenantId, credential);\n    }"
        )
    ]
    modify_file(recs_path, recs_replacements)

    # 5. src/app/api/intelligence/rightsizing/route.ts - Filter subscriptions
    rightsizing_path = os.path.join(base_dir, "src/app/api/intelligence/rightsizing/route.ts")
    rightsizing_replacements = [
        (
            "import { getResourceGraphClient } from '@/lib/azure';",
            "import { getResourceGraphClient, getAzureCredential, getSubscriptionsForTenant } from '@/lib/azure';"
        ),
        (
            "        const argClient = await getResourceGraphClient(tenantId);",
            "        const argClient = await getResourceGraphClient(tenantId);\n        let subs: string[] | undefined = undefined;\n        if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {\n            subs = [subscriptionId];\n        } else {\n            const credential = await getAzureCredential(tenantId);\n            subs = await getSubscriptionsForTenant(tenantId, credential);\n        }"
        ),
        (
            "        const response = await argClient.resources({ query });",
            "        const response = await argClient.resources({ query, subscriptions: subs });"
        )
    ]
    modify_file(rightsizing_path, rightsizing_replacements)

    # 6. src/app/api/intelligence/sustainability/route.ts - Filter subscriptions
    sustainability_path = os.path.join(base_dir, "src/app/api/intelligence/sustainability/route.ts")
    sustainability_replacements = [
        (
            "import { getAzureCredential } from \"@/lib/azure\";",
            "import { getAzureCredential, getSubscriptionsForTenant } from \"@/lib/azure\";"
        ),
        (
            "        const credential = await getAzureCredential(tenantId);\n        const client = new ResourceGraphClient(credential);",
            "        const credential = await getAzureCredential(tenantId);\n        const client = new ResourceGraphClient(credential);\n        let subs: string[] | undefined = undefined;\n        if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {\n            subs = [subscriptionId];\n        } else {\n            subs = await getSubscriptionsForTenant(tenantId, credential);\n        }"
        ),
        (
            "        const vmResult = await client.resources({ query: vmQuery });",
            "        const vmResult = await client.resources({ query: vmQuery, subscriptions: subs });"
        ),
        (
            "        const diskResult = await client.resources({ query: diskQuery });",
            "        const diskResult = await client.resources({ query: diskQuery, subscriptions: subs });"
        )
    ]
    modify_file(sustainability_path, sustainability_replacements)

    # 7. src/app/[locale]/page.tsx - Filter advisorSavings client-side when specific subscription is active
    page_path = os.path.join(base_dir, "src/app/[locale]/page.tsx")
    old_advisor_reduce = """                      const advisorJson = await advisorRes.value.json();
                      const costRecs = advisorJson?.recommendations?.Cost || [];
                      const savings = costRecs.reduce((acc: number, curr: any) =>
                          acc + parseFloat(curr.extendedProperties?.savingsAmount || '0'), 0);"""
    
    new_advisor_reduce = """                      const advisorJson = await advisorRes.value.json();
                      let costRecs = advisorJson?.recommendations?.Cost || [];
                      if (selectedSubscription && selectedSubscription.toLowerCase() !== 'all') {
                          costRecs = costRecs.filter((r: any) => r.subscriptionId === selectedSubscription);
                      }
                      const savings = costRecs.reduce((acc: number, curr: any) =>
                          acc + parseFloat(curr.extendedProperties?.savingsAmount || '0'), 0);"""
    
    page_replacements = [
        (old_advisor_reduce, new_advisor_reduce)
    ]
    modify_file(page_path, page_replacements)

if __name__ == "__main__":
    main()
