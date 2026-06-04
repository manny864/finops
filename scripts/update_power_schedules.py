import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_ui():
    path = os.path.join(base_dir, "src/components/dashboard/PowerSchedules.tsx")
    code = """"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';

export default function PowerSchedules() {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [vms, setVms] = useState<any[]>([]);
    const [selectedVmIds, setSelectedVmIds] = useState<string[]>([]);
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
                    // Select all by default
                    setSelectedVmIds(json.auditResults.devVirtualMachines.map((vm: any) => vm.id));
                } else {
                    setVms([]);
                    setSelectedVmIds([]);
                }
            } catch (e) {
                console.error("Error fetching VMs:", e);
            }
            setLoading(false);
        };
        fetchVms();
    }, [accounts, instance, selectedTenant.id]);

    const handleAction = async (action: 'start' | 'stop') => {
        const targetVms = vms.filter(vm => selectedVmIds.includes(vm.id));
        if (targetVms.length === 0) return;
        
        setActionLoading(action);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            const payload = targetVms.map(vm => ({
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
            
            alert(`Comando ${action === 'start' ? 'Encender' : 'Apagar'} enviado exitosamente a ${targetVms.length} VMs.`);
        } catch (e) {
            console.error(`Error al ejecutar ${action}:`, e);
            alert("Error al ejecutar la acción.");
        }
        setActionLoading(null);
    };

    const toggleSelection = (id: string) => {
        setSelectedVmIds(prev => 
            prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]
        );
    };

    const toggleAll = () => {
        if (selectedVmIds.length === vms.length) {
            setSelectedVmIds([]);
        } else {
            setSelectedVmIds(vms.map(vm => vm.id));
        }
    };

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 mt-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">R&D Power Schedule</h3>
            <p className="text-sm text-gray-500 mb-4">Controla el encendido y apagado de las VMs de Desarrollo y Pruebas.</p>
            
            {loading ? (
                <div className="text-sm text-gray-400 animate-pulse">Cargando VMs...</div>
            ) : vms.length === 0 ? (
                <div className="text-sm text-gray-500">No se encontraron VMs etiquetadas como Dev o Test.</div>
            ) : (
                <>
                    <div className="flex gap-4 mb-4">
                        <button 
                            onClick={() => handleAction('stop')}
                            disabled={actionLoading !== null || selectedVmIds.length === 0}
                            className="bg-amber-100 hover:bg-amber-200 text-amber-700 px-4 py-2 rounded font-semibold text-sm transition-colors shadow-sm disabled:opacity-50"
                        >
                            {actionLoading === 'stop' ? 'Procesando...' : 'Apagar Selección'}
                        </button>
                        <button 
                            onClick={() => handleAction('start')}
                            disabled={actionLoading !== null || selectedVmIds.length === 0}
                            className="bg-green-100 hover:bg-green-200 text-green-700 px-4 py-2 rounded font-semibold text-sm transition-colors shadow-sm disabled:opacity-50"
                        >
                            {actionLoading === 'start' ? 'Procesando...' : 'Encender Selección'}
                        </button>
                    </div>
                    
                    <div className="overflow-y-auto max-h-48 border border-gray-200 rounded-md">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2 text-left w-12">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedVmIds.length === vms.length && vms.length > 0}
                                            onChange={toggleAll}
                                            className="rounded text-[#0054A6] focus:ring-[#0054A6]"
                                        />
                                    </th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Máquina Virtual</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Resource Group</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {vms.map((vm) => (
                                    <tr key={vm.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-2">
                                            <input 
                                                type="checkbox"
                                                checked={selectedVmIds.includes(vm.id)}
                                                onChange={() => toggleSelection(vm.id)}
                                                className="rounded text-[#0054A6] focus:ring-[#0054A6]"
                                            />
                                        </td>
                                        <td className="px-4 py-2 text-sm text-gray-900">{vm.name}</td>
                                        <td className="px-4 py-2 text-sm text-gray-500">{vm.resourceGroup}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
"""
    with open(path, "w") as f:
        f.write(code)

def update_sop():
    path = os.path.join(base_dir, "directivas/power_schedules_SOP.md")
    with open(path, "a") as f:
        f.write("- **Selección Individual**: `PowerSchedules.tsx` muestra un listado interactivo con checkboxes para encender/apagar de manera granular.\\n")

if __name__ == "__main__":
    update_ui()
    update_sop()
    print("Power Schedules Update completado.")
