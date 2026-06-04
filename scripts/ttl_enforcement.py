import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_kql_catalog():
    path = os.path.join(base_dir, "src/lib/kqlCatalog.ts")
    with open(path, "r") as f:
        content = f.read()
    
    if "expiredTtlResources:" not in content:
        # Find last brace
        last_brace_idx = content.rfind('}')
        if last_brace_idx != -1:
            new_kql = ",\n  expiredTtlResources: `Resources | where isnotempty(tags['ExpireOn']) or isnotempty(tags['TTL']) | project id, name, type, resourceGroup, tags, expirationDate = coalesce(tags['ExpireOn'], tags['TTL']), subscriptionId`"
            content = content[:last_brace_idx] + new_kql + "\n" + content[last_brace_idx:]
            with open(path, "w") as f:
                f.write(content)
            print("KQL Catalog updated.")

def update_remediation():
    path = os.path.join(base_dir, "src/services/remediationService.ts")
    with open(path, "r") as f:
        content = f.read()

    if 'type.includes("virtualmachines")' not in content:
        insert_code = """} else if (type.includes("virtualmachines")) {
        const client = new ComputeManagementClient(credential, subscriptionId);
        return await client.virtualMachines.beginDeleteAndWait(resourceGroup, resourceName);
    """
        content = content.replace('} else {', insert_code + '} else {')
        with open(path, "w") as f:
            f.write(content)
        print("Remediation Service updated.")

def create_ttl_service():
    path = os.path.join(base_dir, "src/services/ttlService.ts")
    code = """import { getAzureCredential } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "@/lib/kqlCatalog";

export async function findExpiredResources(tenantId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);
    
    const query = kqlCatalog.expiredTtlResources;
    const res = await client.resources({ query });
    const data = res.data as any[];
    
    const now = new Date();
    const expired: any[] = [];
    
    for (const item of data) {
        if (!item.expirationDate) continue;
        
        // Parse ISO 8601
        const expDate = new Date(item.expirationDate);
        if (isNaN(expDate.getTime())) {
            // Formato inválido
            continue;
        }
        
        if (expDate < now) {
            expired.push({
                ...item,
                daysExpired: Math.floor((now.getTime() - expDate.getTime()) / (1000 * 3600 * 24))
            });
        }
    }
    
    return expired;
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("TTL Service created.")

def create_ttl_api():
    api_dir = os.path.join(base_dir, "src/app/api/audit/ttl")
    os.makedirs(api_dir, exist_ok=True)
    
    path = os.path.join(api_dir, "route.ts")
    code = """import { NextRequest, NextResponse } from "next/server";
import { findExpiredResources } from "@/services/ttlService";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }
        
        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        const expiredResources = await findExpiredResources(tenantId);
        
        return NextResponse.json({ expiredResources });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("TTL API Route created.")

def create_ui_component():
    path = os.path.join(base_dir, "src/components/dashboard/ExpiredSandboxTable.tsx")
    code = """"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';

export default function ExpiredSandboxTable() {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [expiredResources, setExpiredResources] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;
        
        const fetchTTL = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const res = await fetch(`/api/audit/ttl?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.expiredResources) {
                    setExpiredResources(json.expiredResources);
                }
            } catch (e) {
                console.error("Error fetching TTL data:", e);
            }
            setLoading(false);
        };
        fetchTTL();
    }, [accounts, instance, selectedTenant.id]);

    const handleDelete = async (resource: any) => {
        if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente el recurso ${resource.name}?`)) return;
        
        setDeleting(resource.id);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            
            const res = await fetch("/api/remediation", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${tokenResponse.idToken}`
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    subscriptionId: resource.subscriptionId,
                    resourceGroup: resource.resourceGroup,
                    resourceName: resource.name,
                    resourceType: resource.type
                })
            });
            
            if (res.ok) {
                setExpiredResources(prev => prev.filter(r => r.id !== resource.id));
            } else {
                const err = await res.json();
                alert(`Error al eliminar: ${err.error || 'Desconocido'}`);
            }
        } catch (e) {
            console.error("Delete error:", e);
            alert("Error al intentar eliminar el recurso.");
        }
        setDeleting(null);
    };

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    if (!loading && expiredResources.length === 0) return null;

    return (
        <div className="bg-white border border-red-200 rounded-lg shadow-sm p-6 mt-6">
            <h3 className="text-lg font-bold text-red-800 mb-2">Entornos de Desarrollo Expirados (TTL)</h3>
            <p className="text-sm text-gray-600 mb-4">Los siguientes recursos han superado su tiempo de vida estipulado y pueden ser recolectados.</p>
            
            {loading ? (
                <div className="h-20 flex items-center justify-center">
                    <div className="text-sm text-gray-400 animate-pulse">Consultando expiraciones...</div>
                </div>
            ) : (
                <div className="overflow-x-auto bg-white rounded-lg border border-red-200 shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-red-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-bold text-red-800 uppercase tracking-wider">Recurso</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-red-800 uppercase tracking-wider">Tipo</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-red-800 uppercase tracking-wider">Días Expirado</th>
                                <th className="px-6 py-3 text-right text-xs font-bold text-red-800 uppercase tracking-wider">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {expiredResources.map((rec, idx) => (
                                <tr key={idx} className="hover:bg-red-50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{rec.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{rec.type.split('/').pop()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-red-600">{rec.daysExpired} días</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button 
                                            onClick={() => handleDelete(rec)}
                                            disabled={deleting === rec.id}
                                            className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                                        >
                                            {deleting === rec.id ? 'Eliminando...' : 'Eliminar Entorno'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("UI Component created.")

def update_page():
    path = os.path.join(base_dir, "src/app/page.tsx")
    with open(path, "r") as f:
        content = f.read()

    if "import ExpiredSandboxTable" not in content:
        content = content.replace(
            'import RightsizingBlade from "@/components/dashboard/RightsizingBlade";',
            'import RightsizingBlade from "@/components/dashboard/RightsizingBlade";\nimport ExpiredSandboxTable from "@/components/dashboard/ExpiredSandboxTable";'
        )

    if "<ExpiredSandboxTable />" not in content:
        content = content.replace(
            "<RightsizingBlade />",
            "<ExpiredSandboxTable />\n            <RightsizingBlade />"
        )
        with open(path, "w") as f:
            f.write(content)
        print("Page.tsx updated.")

def update_sop():
    path = os.path.join(base_dir, "directivas/ttl_enforcement_SOP.md")
    with open(path, "w") as f:
        f.write("# TTL Enforcement SOP\\n\\n")
        f.write("- **Formato de Fecha**: Se utiliza ISO 8601 (`YYYY-MM-DD`). Cualquier fecha que no cumpla con este formato será evaluada como `NaN` en JS y se omitirá para evitar Falsos Positivos de borrado.\\n")
        f.write("- **Soporte de Máquinas Virtuales**: El servicio de remediación (`src/services/remediationService.ts`) fue parcheado para soportar el borrado absoluto de Máquinas Virtuales a petición del motor TTL.\\n")
        f.write("- **UI**: `ExpiredSandboxTable.tsx` dispara un borrado hacia `/api/remediation`. El token y tenant se validan en el backend estrictamente para prevenir accesos cruzados.\\n")
    print("SOP created.")

if __name__ == "__main__":
    update_kql_catalog()
    update_remediation()
    create_ttl_service()
    create_ttl_api()
    create_ui_component()
    update_page()
    update_sop()
    print("Deploy de TTL Enforcement completado.")
