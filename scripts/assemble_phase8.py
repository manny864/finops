import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
table_path = os.path.join(base_dir, "src", "components", "ZombieResourcesTable.tsx")

with open(table_path, "r") as f:
    table_code = f.read()

# Update fetch URL
table_code = table_code.replace(
    "let apiUrl = `/api/recommendations?tenantId=${tenantId}`;",
    "let apiUrl = `/api/audit/full?tenantId=${tenantId}`;"
)

# Replace data unpacking logic
old_data_unpacking = """
        const formattedDisks = (json.unattachedDisks || []).map((d: any) => ({
            id: d.id, 
            resourceName: d.name, 
            type: "Disk", 
            issue: "Disco sin asociar", 
            subscriptionId: d.subscriptionId || selectedSub,
            potentialSavings: d.diskSizeGB ? d.diskSizeGB * 0.15 : 10.0
        }));

        const formattedIps = (json.unusedIps || []).map((ip: any) => ({
            id: ip.id, 
            resourceName: ip.name, 
            type: "Public IP", 
            issue: "IP Pública sin asignar", 
            subscriptionId: ip.subscriptionId || selectedSub,
            potentialSavings: 3.5
        }));

        setData([...formattedDisks, ...formattedIps]);
"""

new_data_unpacking = """
        const audit = json.auditResults || {};
        
        const formattedDisks = (audit.unattachedDisks || []).map((d: any) => ({
            id: d.id, 
            resourceName: d.name, 
            type: "Disk", 
            issue: "Disco sin asociar", 
            subscriptionId: d.subscriptionId || selectedSub,
            potentialSavings: d.diskSizeGB ? d.diskSizeGB * 0.15 : 10.0,
            issueType: "cost"
        }));

        const formattedIps = (audit.unusedIps || []).map((ip: any) => ({
            id: ip.id, 
            resourceName: ip.name, 
            type: "Public IP", 
            issue: "IP Pública sin asignar", 
            subscriptionId: ip.subscriptionId || selectedSub,
            potentialSavings: 3.5,
            issueType: "cost"
        }));

        const formattedSnapshots = (audit.staleSnapshots || []).map((s: any) => ({
            id: s.id, 
            resourceName: s.name, 
            type: "Snapshot", 
            issue: "Snapshot Antiguo (>90d)", 
            subscriptionId: s.subscriptionId || selectedSub,
            potentialSavings: s.sizeGB ? s.sizeGB * 0.05 : 5.0,
            issueType: "cost"
        }));

        const formattedTags = (audit.taggingNonCompliance || []).map((r: any) => ({
            id: r.id, 
            resourceName: r.name, 
            type: r.type?.split("/").pop() || "Resource", 
            issue: "Sin Etiquetas FinOps", 
            subscriptionId: r.subscriptionId || selectedSub,
            potentialSavings: 0.0,
            issueType: "governance"
        }));

        setData([...formattedDisks, ...formattedIps, ...formattedSnapshots, ...formattedTags]);
"""

table_code = table_code.replace(old_data_unpacking, new_data_unpacking)

# Update Title
table_code = table_code.replace(
    "{selectedSub === \"all\" ? \"Recursos Zombi (Global)\" : \"Recursos Zombi (Filtrados)\"}",
    "{selectedSub === \"all\" ? \"Auditoría FinOps (Global)\" : \"Auditoría FinOps (Filtrada)\"}"
)

# Update the UI Badge logic for tags
old_badge = """<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">
                      {item.issue}
                    </span>"""

new_badge = """<span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${item.issueType === 'governance' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-100'}`}>
                      {item.issue}
                    </span>"""

table_code = table_code.replace(old_badge, new_badge)

# Update zero money formatting
old_money = "${Number(item.potentialSavings).toFixed(2)}"
new_money = "{item.potentialSavings > 0 ? `$` + Number(item.potentialSavings).toFixed(2) : \"-\"}"
table_code = table_code.replace(old_money, new_money)

# Update text color for zero money (optional but let's keep it green or gray)
old_money_span = "<td className=\"p-4 text-sm font-bold text-green-600 text-right\">{item.potentialSavings > 0"
new_money_span = "<td className={`p-4 text-sm font-bold text-right ${item.potentialSavings > 0 ? 'text-green-600' : 'text-gray-400'}`}>{item.potentialSavings > 0"
table_code = table_code.replace(old_money_span, new_money_span)

# Update Zero message
table_code = table_code.replace(
    "No se detectaron recursos zombie en esta vista. ¡Excelente trabajo!",
    "El entorno está 100% optimizado y bajo políticas de Gobernanza. ¡Excelente trabajo!"
)

with open(table_path, "w") as f:
    f.write(table_code)

print("Componente ZombieResourcesTable.tsx refactorizado a Motor de Auditoría exitosamente.")
