import os
import re

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_kql():
    path = os.path.join(base_dir, "src/lib/kqlCatalog.ts")
    with open(path, "r") as f:
        content = f.read()

    if "devVirtualMachines" not in content:
        injection = "  devVirtualMachines: `Resources | where type =~ 'microsoft.compute/virtualmachines' | where tags.Environment =~ 'Dev' or tags.Environment =~ 'Test' | project id, name, location, resourceGroup, subscriptionId, tags`,"
        # Insert after the first brace
        content = content.replace("export const kqlCatalog: Record<string, string> = {", f"export const kqlCatalog: Record<string, string> = {{\\n{injection}")
        with open(path, "w") as f:
            f.write(content)
        print("KQL Catalog updated.")

def update_remediation():
    path = os.path.join(base_dir, "src/services/remediationService.ts")
    with open(path, "r") as f:
        content = f.read()

    if "deallocateVirtualMachine" not in content:
        code = """
export async function deallocateVirtualMachine(tenantId: string, subscriptionId: string, resourceGroup: string, vmName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ComputeManagementClient(credential, subscriptionId);
    return await client.virtualMachines.beginDeallocate(resourceGroup, vmName);
}

export async function startVirtualMachine(tenantId: string, subscriptionId: string, resourceGroup: string, vmName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ComputeManagementClient(credential, subscriptionId);
    return await client.virtualMachines.beginStart(resourceGroup, vmName);
}
"""
        with open(path, "a") as f:
            f.write(code)
        print("remediationService updated.")

def create_power_api():
    api_dir = os.path.join(base_dir, "src/app/api/power")
    os.makedirs(api_dir, exist_ok=True)
    path = os.path.join(api_dir, "route.ts")

    code = """import { NextRequest, NextResponse } from "next/server";
import { deallocateVirtualMachine, startVirtualMachine } from "@/services/remediationService";
import jwt from "jsonwebtoken";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, action, vms } = body;

        if (!tenantId || !action || !vms || !Array.isArray(vms)) {
            return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
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

        // Ejecutar las acciones asíncronamente (sin await individual bloqueante)
        const promises = vms.map(async (vm: any) => {
            try {
                if (action === 'stop') {
                    await deallocateVirtualMachine(tenantId, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                } else if (action === 'start') {
                    await startVirtualMachine(tenantId, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                }
            } catch (err) {
                console.error(`Fallo al ${action} VM ${vm.resourceName}:`, err);
            }
        });

        // Esperamos a que los comandos 'begin' se disparen, no esperamos a que termine el apagado físico.
        await Promise.all(promises);

        return NextResponse.json({ success: true, message: `Comando ${action} enviado a ${vms.length} VMs.` });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("Power API created.")

def create_widget():
    comp_dir = os.path.join(base_dir, "src/components/dashboard")
    os.makedirs(comp_dir, exist_ok=True)
    path = os.path.join(comp_dir, "PowerSchedules.tsx")

    code = """"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';

export default function PowerSchedules() {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [vms, setVms] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;
        const fetchVms = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                const res = await fetch(`/api/audit/full?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.auditResults && json.auditResults.devVirtualMachines) {
                    setVms(json.auditResults.devVirtualMachines);
                } else {
                    setVms([]);
                }
            } catch (e) {
                console.error("Error fetching VMs:", e);
            }
            setLoading(false);
        };
        fetchVms();
    }, [accounts, instance, selectedTenant.id]);

    const handleAction = async (action: 'start' | 'stop') => {
        if (vms.length === 0) return;
        setActionLoading(action);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            const payload = vms.map(vm => ({
                subscriptionId: vm.subscriptionId,
                resourceGroup: vm.resourceGroup,
                resourceName: vm.name
            }));
            
            await fetch('/api/power', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    action,
                    vms: payload
                })
            });
            
            alert(`Comando ${action === 'start' ? 'Encender' : 'Apagar'} enviado exitosamente.`);
        } catch (e) {
            console.error(`Error al ejecutar ${action}:`, e);
            alert("Error al ejecutar la acción.");
        }
        setActionLoading(null);
    };

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 mt-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">R&D Power Schedule</h3>
            <p className="text-sm text-gray-500 mb-4">Controla el encendido y apagado de las VMs de Desarrollo y Pruebas.</p>
            
            {loading ? (
                <div className="text-sm text-gray-400 animate-pulse">Cargando VMs...</div>
            ) : (
                <>
                    <div className="flex gap-4 mb-4">
                        <button 
                            onClick={() => handleAction('stop')}
                            disabled={actionLoading !== null || vms.length === 0}
                            className="bg-amber-100 hover:bg-amber-200 text-amber-700 px-4 py-2 rounded font-semibold text-sm transition-colors shadow-sm disabled:opacity-50"
                        >
                            {actionLoading === 'stop' ? 'Procesando...' : 'Apagar Entornos Dev'}
                        </button>
                        <button 
                            onClick={() => handleAction('start')}
                            disabled={actionLoading !== null || vms.length === 0}
                            className="bg-green-100 hover:bg-green-200 text-green-700 px-4 py-2 rounded font-semibold text-sm transition-colors shadow-sm disabled:opacity-50"
                        >
                            {actionLoading === 'start' ? 'Procesando...' : 'Encender Entornos Dev'}
                        </button>
                    </div>
                    <div className="text-xs text-gray-500">
                        Se encontraron <strong>{vms.length}</strong> Máquinas Virtuales etiquetadas con 'Environment: Dev' o 'Test'.
                    </div>
                </>
            )}
        </div>
    );
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("Widget created.")

def update_page():
    path = os.path.join(base_dir, "src/app/page.tsx")
    with open(path, "r") as f:
        content = f.read()

    if "import PowerSchedules" not in content:
        content = content.replace(
            'import AdvisorPanel from "../components/AdvisorPanel";',
            'import AdvisorPanel from "../components/AdvisorPanel";\\nimport PowerSchedules from "@/components/dashboard/PowerSchedules";'
        )
        content = content.replace(
            'import AdvisorPanel from "@/components/AdvisorPanel";',
            'import AdvisorPanel from "@/components/AdvisorPanel";\\nimport PowerSchedules from "@/components/dashboard/PowerSchedules";'
        )

    # Wrap the Gobernanza card to include PowerSchedules right below it
    old_html = """<div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
             <h3 className="text-lg font-bold text-gray-800 mb-4">Estado de Gobernanza</h3>"""
    
    new_html = """<div className="flex flex-col">
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
             <h3 className="text-lg font-bold text-gray-800 mb-4">Estado de Gobernanza</h3>"""
    
    # We must close the flex flex-col after the Governance card.
    # The Governance card ends with </div> just before </div></div> for the grid.
    if "PowerSchedules" not in content.split("Estado de Gobernanza")[1]:
        content = content.replace(old_html, new_html)
        # Find where the governance card ends to insert the component and close the div
        # We know it ends with:
        #                  )}
        #              </div>
        #         </div>
        target_close = """                 )}
             </div>
        </div>"""
        new_close = """                 )}
             </div>
        </div>
        <PowerSchedules />
        </div>"""
        content = content.replace(target_close, new_close, 1)

    with open(path, "w") as f:
        f.write(content)
    print("page.tsx updated.")

def update_sop():
    path = os.path.join(base_dir, "directivas/power_schedules_SOP.md")
    with open(path, "w") as f:
        f.write("# R&D Power Schedules SOP\\n\\n")
        f.write("- **Endpoint**: `/api/power` gestiona el array de VMs a afectar.\\n")
        f.write("- **Decisión Arquitectónica**: Las llamadas usan `beginDeallocate` y no `beginDeallocateAndWait` para evadir el timeout de la API al afectar a un grupo grande de máquinas. Dejamos que el plano de control de Azure procese asincrónicamente.\\n")

if __name__ == "__main__":
    update_kql()
    update_remediation()
    create_power_api()
    create_widget()
    update_page()
    update_sop()
    print("All tasks completed successfully.")
