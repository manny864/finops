import os
import subprocess

def run_cmd(cmd):
    print(f"Running: {cmd}")
    subprocess.run(cmd, shell=True, check=True)

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    os.chdir(base_dir)

    print("1. Instalando dependencias de Azure...")
    run_cmd("npm install @azure/arm-resources")

    print("2. Creando backend para Tags SDK...")
    route_dir = os.path.join(base_dir, "src/app/api/tags/apply")
    os.makedirs(route_dir, exist_ok=True)
    
    route_content = """import { NextRequest, NextResponse } from "next/server";
import { ResourceManagementClient } from "@azure/arm-resources";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, resourceId, tags } = body;

    if (!tenantId || !resourceId || !tags) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as { tid?: string } | null;
    if (!decoded || decoded.tid !== tenantId) {
      return NextResponse.json({ error: "Acceso denegado. Tenant ID inválido." }, { status: 403 });
    }

    const credential = await getAzureCredential(tenantId);
    
    // Extraer subscriptionId
    const match = resourceId.match(/subscriptions\\/([^\\/]+)/i);
    const subId = match ? match[1] : "00000000-0000-0000-0000-000000000000";

    const client = new ResourceManagementClient(credential, subId);
    
    console.log(`[Tags API] Updating tags for ${resourceId}`);
    
    const poller = await client.tags.beginUpdateAtScope(resourceId, {
        operation: "Merge",
        properties: { tags }
    });
    
    await poller.pollUntilDone();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || String(error) || "Error desconocido";
    const errorCode = error?.code || error?.name || "";
    
    console.error(`[Tags API] ERROR:`, { code: errorCode, message: errorMessage });

    if (errorMessage.includes("AADSTS7000215") || errorMessage.includes("invalid_client")) {
      return NextResponse.json({ error: "INVALID_CLIENT_SECRET", details: "Client Secret inválido." }, { status: 401 });
    }

    if (errorCode === "AuthorizationFailed" || errorMessage.includes("AuthorizationFailed") || errorMessage.includes("AccessDenied")) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "Permisos insuficientes para modificar etiquetas." }, { status: 403 });
    }

    return NextResponse.json({ error: "Error al actualizar etiquetas", details: errorMessage }, { status: 500 });
  }
}
"""
    with open(os.path.join(route_dir, "route.ts"), "w") as f:
        f.write(route_content)

    print("3. Modificando Auditoría UI...")
    zombie_path = os.path.join(base_dir, "src/components/ZombieResourcesTable.tsx")
    with open(zombie_path, "r") as f:
        zombie_code = f.read()

    zombie_code = zombie_code.replace(
        "const [deletingId, setDeletingId] = useState<string | null>(null);",
        "const [deletingId, setDeletingId] = useState<string | null>(null);\n  const [filterType, setFilterType] = useState<string>('all');\n  const [filterGroup, setFilterGroup] = useState<string>('all');\n  const [filterIssue, setFilterIssue] = useState<string>('all');"
    )

    old_filters = """        {/* Selector de Suscripciones */}
        <div className="flex items-center space-x-2 w-full sm:w-auto">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Suscripción:</label>
            <select 
                value={selectedSub}
                onChange={(e) => setSelectedSub(e.target.value)}
                className="bg-white border border-gray-300 text-gray-700 text-sm rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] block p-2 shadow-sm w-full sm:w-64"
            >
                <option value="all">Todas las Suscripciones</option>
                {subscriptions.map((sub: any) => (
                    <option key={sub.id} value={sub.id}>{sub.displayName}</option>
                ))}
            </select>
        </div>"""

    new_filters = """        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
            <div className="flex items-center space-x-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Suscripción:</label>
                <select 
                    value={selectedSub}
                    onChange={(e) => setSelectedSub(e.target.value)}
                    className="bg-white border border-gray-300 text-gray-700 text-sm rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] p-2 w-32"
                >
                    <option value="all">Todas</option>
                    {subscriptions.map((sub: any) => (
                        <option key={sub.id} value={sub.id}>{sub.displayName.substring(0,15)}...</option>
                    ))}
                </select>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo:</label>
                <select value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-white border border-gray-300 text-gray-700 text-sm rounded-md p-2 w-32">
                    <option value="all">Todos</option>
                    {Array.from(new Set(data.map(d => d.type))).filter(Boolean).sort().map((t: any) => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Grupo:</label>
                <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} className="bg-white border border-gray-300 text-gray-700 text-sm rounded-md p-2 w-32">
                    <option value="all">Todos</option>
                    {Array.from(new Set(data.map(d => d.resourceGroup))).filter(Boolean).sort().map((g: any) => <option key={g} value={g}>{g}</option>)}
                </select>
            </div>
            <div className="flex items-center space-x-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Severidad:</label>
                <select value={filterIssue} onChange={e => setFilterIssue(e.target.value)} className="bg-white border border-gray-300 text-gray-700 text-sm rounded-md p-2 w-32">
                    <option value="all">Todas</option>
                    <option value="cost">Costo</option>
                    <option value="governance">Gobernanza</option>
                </select>
            </div>
        </div>"""
    
    zombie_code = zombie_code.replace(old_filters, new_filters)

    old_map = "{data.length > 0 ? data.map((item, i) => ("
    new_map = """{data.length > 0 ? data.filter(item => {
                  const matchType = filterType === "all" || item.type === filterType;
                  const matchGroup = filterGroup === "all" || item.resourceGroup === filterGroup;
                  const matchIssue = filterIssue === "all" || item.issueType === filterIssue;
                  return matchType && matchGroup && matchIssue;
              }).map((item, i) => ("""
    zombie_code = zombie_code.replace(old_map, new_map)
    zombie_code = zombie_code.replace(")) : (", "})) : (")

    with open(zombie_path, "w") as f:
        f.write(zombie_code)


    print("4. Modificando Tags UI...")
    tag_path = os.path.join(base_dir, "src/components/TagManager.tsx")
    with open(tag_path, "r") as f:
        tag_code = f.read()

    tag_code = tag_code.replace(
        "const [nonCompliantResources, setNonCompliantResources] = useState<any[]>([]);",
        "const [nonCompliantResources, setNonCompliantResources] = useState<any[]>([]);\n    const [editingResource, setEditingResource] = useState<any>(null);\n    const [tagValues, setTagValues] = useState<Record<string, string>>({});\n    const [isApplying, setIsApplying] = useState(false);"
    )

    apply_fn = """
    const applyTags = async () => {
        if (!editingResource) return;
        setIsApplying(true);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            const payload = {
                tenantId: selectedTenant.id,
                resourceId: editingResource.id,
                tags: tagValues
            };
            const res = await fetch('/api/tags/apply', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenResponse.idToken}` 
                },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!res.ok) {
                alert(`Error: ${json.details || json.error}`);
            } else {
                alert("¡Etiquetas aplicadas correctamente en Azure!");
                setEditingResource(null);
                setTagValues({});
                fetchPolicies(); // Refrescar compliance
            }
        } catch (e: any) {
            alert(`Error al aplicar etiquetas: ${e.message}`);
        }
        setIsApplying(false);
    };
"""
    tag_code = tag_code.replace("const addPolicy = async () => {", apply_fn + "\n    const addPolicy = async () => {")

    old_table_header = """<th className="p-4">Recurso</th>
                                    <th className="p-4">Tipo</th>
                                    <th className="p-4">Etiquetas Faltantes</th>"""
    new_table_header = """<th className="p-4">Recurso</th>
                                    <th className="p-4">Tipo</th>
                                    <th className="p-4">Etiquetas Faltantes</th>
                                    <th className="p-4 text-right">Acciones</th>"""
    tag_code = tag_code.replace(old_table_header, new_table_header)

    old_row_end = """</div>
                                        </td>
                                    </tr>"""
    new_row_end = """</div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <button 
                                                onClick={() => {
                                                    setEditingResource(item);
                                                    const initVals: Record<string,string> = {};
                                                    item.missingTags.forEach((t: string) => initVals[t] = "");
                                                    setTagValues(initVals);
                                                }}
                                                className="px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 rounded text-xs font-semibold transition-colors"
                                            >
                                                Editar Etiquetas
                                            </button>
                                        </td>
                                    </tr>"""
    tag_code = tag_code.replace(old_row_end, new_row_end)

    modal_code = """
            {/* Modal de Edición de Etiquetas */}
            {editingResource && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-gray-200">
                        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                            <h3 className="text-lg font-bold text-gray-800">Aplicar Etiquetas Requeridas</h3>
                            <p className="text-sm text-gray-500 mt-1 truncate">{editingResource.name || editingResource.resourceName}</p>
                        </div>
                        <div className="p-6 space-y-4">
                            {editingResource.missingTags.map((tag: string) => (
                                <div key={tag}>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">{tag}</label>
                                    <input 
                                        type="text" 
                                        value={tagValues[tag] || ''} 
                                        onChange={e => setTagValues({...tagValues, [tag]: e.target.value})}
                                        className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-[#0054A6] focus:border-[#0054A6]"
                                        placeholder={`Valor para ${tag}`}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end space-x-3">
                            <button 
                                onClick={() => setEditingResource(null)}
                                className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                disabled={isApplying}
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={applyTags}
                                disabled={isApplying || Object.values(tagValues).some(v => !v.trim())}
                                className="px-4 py-2 text-sm font-semibold bg-[#0054A6] text-white hover:bg-blue-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                            >
                                {isApplying ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                        Aplicando en Azure...
                                    </>
                                ) : "Aplicar a Azure"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}"""

    tag_code = tag_code.replace("        </div>\n    );\n}", modal_code)

    with open(tag_path, "w") as f:
        f.write(tag_code)
        
    print("¡Proceso completado exitosamente!")

if __name__ == "__main__":
    main()
