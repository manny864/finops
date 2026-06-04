import os

def fix_route():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    route_path = os.path.join(base_dir, "src/app/api/audit/full/route.ts")
    with open(route_path, "r") as f:
        content = f.read()

    # Import getAzureCredential and ResourceGraphClient
    if "getAzureCredential" not in content:
        content = content.replace(
            'import { getResourceGraphClient } from "@/lib/azure";',
            'import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";\nimport { ResourceGraphClient } from "@azure/arm-resourcegraph";'
        )

    # Change how runGraphAudits is called
    content = content.replace(
        "const resourceGraphClient = await getResourceGraphClient(tenantId);\n\n    // 3. Orquestar Servicios de Auditoría\n    const graphResults = await runGraphAudits(resourceGraphClient, subscriptionId || undefined);",
        "const credential = await getAzureCredential(tenantId);\n    const resourceGraphClient = new ResourceGraphClient(credential);\n\n    // 3. Orquestar Servicios de Auditoría\n    const graphResults = await runGraphAudits(resourceGraphClient, credential, subscriptionId || undefined);"
    )

    with open(route_path, "w") as f:
        f.write(content)

def fix_service():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    service_path = os.path.join(base_dir, "src/services/auditService.ts")
    with open(service_path, "r") as f:
        content = f.read()

    if 'import { SubscriptionClient } from "@azure/arm-subscriptions";' not in content:
        content = 'import { SubscriptionClient } from "@azure/arm-subscriptions";\n' + content

    old_func = "export async function runGraphAudits(client: ResourceGraphClient, subscriptionId?: string) {"
    new_func = "export async function runGraphAudits(client: ResourceGraphClient, credential: any, subscriptionId?: string) {"
    content = content.replace(old_func, new_func)

    old_logic = """        try {
            const subRes = await client.resources({
                query: "ResourceContainers | where type == 'microsoft.resources/subscriptions' | project subscriptionId"
            });
            subs = subRes.data.map((row: any) => row.subscriptionId);
        } catch (e) {
            console.error("Failed to query subscriptions", e);
        }"""
        
    new_logic = """        try {
            const subClient = new SubscriptionClient(credential);
            const subRes = subClient.subscriptions.list();
            for await (const sub of subRes) {
                if (sub.subscriptionId) subs.push(sub.subscriptionId);
            }
        } catch (e) {
            console.error("Failed to query subscriptions with arm-subscriptions", e);
        }"""

    content = content.replace(old_logic, new_logic)

    # Also throw a 403 AccessDenied error properly
    content = content.replace(
        'throw new Error("No hay suscripciones disponibles o no se tienen permisos");',
        'throw Object.assign(new Error("No hay suscripciones disponibles o no se tienen permisos"), { code: "AccessDenied" });'
    )

    with open(service_path, "w") as f:
        f.write(content)

def main():
    fix_route()
    fix_service()

if __name__ == "__main__":
    main()
