"use client";
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
