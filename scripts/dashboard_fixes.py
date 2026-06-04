import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    
    # 1. Update /api/tenants/route.ts
    tenants_route = os.path.join(base_dir, "src/app/api/tenants/route.ts")
    with open(tenants_route, "r") as f:
        content = f.read()
    
    content = content.replace(
        "SELECT tenant_id as id, company_name, primary_domain FROM Tenants",
        "SELECT tenant_id as id, company_name as name FROM Tenants"
    )
    content = content.replace(
        "const mapped = (rows as any[]).map((r: any) => ({ id: r.id, name: r.company_name || r.primary_domain || 'Organización Desconocida' }));\n        return NextResponse.json({ success: true, tenants: mapped });",
        "return NextResponse.json({ success: true, tenants: rows });"
    )
    with open(tenants_route, "w") as f:
        f.write(content)

    # 2. Update Dashboard page.tsx (Widget logic)
    page_route = os.path.join(base_dir, "src/app/page.tsx")
    with open(page_route, "r") as f:
        page_content = f.read()

    target_widget = """                 <p className="text-xs text-gray-400 mt-2 text-center px-8">
                     {complianceScore === -1 ? 'Añade reglas en Gestión de Etiquetas.' : 'Basado en las reglas de etiquetado activas.'}
                 </p>
             </div>"""
    
    replacement_widget = """                 <p className="text-xs text-gray-400 mt-2 text-center px-8">
                     {complianceScore === -1 ? 'Añade reglas en Gestión de Etiquetas.' : 'Basado en las reglas de etiquetado activas.'}
                 </p>
                 {complianceScore === -1 && (
                     <button 
                         onClick={() => setActiveTab('tags')} 
                         className="mt-4 px-4 py-2 bg-[#0054A6] text-white text-xs font-semibold rounded shadow-sm hover:bg-blue-800 transition-colors"
                     >
                         Configurar Políticas
                     </button>
                 )}
             </div>"""
    
    page_content = page_content.replace(target_widget, replacement_widget)
    with open(page_route, "w") as f:
        f.write(page_content)

    # 3. Update auditService.ts
    audit_route = os.path.join(base_dir, "src/services/auditService.ts")
    with open(audit_route, "r") as f:
        audit_content = f.read()

    new_audit_content = """import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../lib/kqlCatalog";

async function runInBatches(client: ResourceGraphClient, queries: {key: string, query: string}[], batchSize = 5, subscriptions: string[] = []) {
    const getQuery = (query: string) => ({
        subscriptions,
        query
    });

    const results: any = {};
    for (let i = 0; i < queries.length; i += batchSize) {
        const batch = queries.slice(i, i + batchSize);
        const batchPromises = batch.map(async (q) => {
            try {
                const res = await client.resources(getQuery(q.query));
                return { key: q.key, data: res.data };
            } catch (e) {
                console.warn(`Query ${q.key} failed:`, e);
                return { key: q.key, data: [] };
            }
        });
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(r => results[r.key] = r.data);
        
        if (i + batchSize < queries.length) {
            await new Promise(resolve => setTimeout(resolve, 800)); // 800ms delay to prevent 429
        }
    }
    return results;
}

export async function runGraphAudits(client: ResourceGraphClient, subscriptionId?: string) {
    let subs: string[] = [];
    if (subscriptionId) {
        subs = [subscriptionId];
    } else {
        try {
            const subRes = await client.resources({
                query: "ResourceContainers | where type == 'microsoft.resources/subscriptions' | project subscriptionId"
            });
            subs = subRes.data.map((row: any) => row.subscriptionId);
        } catch (e) {
            console.error("Failed to query subscriptions", e);
        }
    }

    if (subs.length === 0) {
        throw new Error("No hay suscripciones disponibles o no se tienen permisos");
    }

    const queryList = Object.keys(kqlCatalog).map(key => ({
        key,
        query: kqlCatalog[key]
    }));

    const results = await runInBatches(client, queryList, 5, subs);
    return results;
}

export async function runMonitorAudits() {
    return [];
}

export async function runM365Audits() {
    return [];
}
"""
    with open(audit_route, "w") as f:
        f.write(new_audit_content)

    print("Ejecución del script completada.")

if __name__ == "__main__":
    main()
