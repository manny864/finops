"use client";
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

    return (
        <div className="card h-full flex flex-col overflow-hidden">
            <div className="card-h shrink-0 border-b-0">
                <div className="flex flex-col">
                    <h3 className="m-0 text-red-600">Entornos de Desarrollo Expirados (TTL)</h3>
                    <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">Los siguientes recursos han superado su tiempo de vida estipulado y pueden ser recolectados.</p>
                </div>
            </div>
            
            <div className="p-[18px] flex-1 overflow-y-auto custom-scrollbar">
                {loading ? (
                    <div className="h-20 flex items-center justify-center">
                        <div className="text-sm text-gray-400 animate-pulse">Consultando expiraciones...</div>
                    </div>
                ) : expiredResources.length === 0 ? (
                    <div className="text-sm text-green-600 bg-green-50 p-4 rounded-[10px] border border-green-100 flex items-center justify-center text-center font-medium">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                        Todo en orden. No hay entornos que hayan superado su Tiempo de Vida (TTL).
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-red-200 rounded-[14px]">
                        <table className="tbl w-full">
                            <thead className="bg-red-50/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-red-800 uppercase tracking-wider border-b border-red-200">Recurso</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-red-800 uppercase tracking-wider border-b border-red-200">Tipo</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-red-800 uppercase tracking-wider border-b border-red-200">Días Expirado</th>
                                    <th className="px-6 py-3 text-right text-xs font-bold text-red-800 uppercase tracking-wider border-b border-red-200">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {expiredResources.map((rec, idx) => (
                                    <tr key={idx} className="hover:bg-red-50/30 transition-colors border-b border-red-100 last:border-0">
                                        <td className="px-6 py-4 whitespace-nowrap text-[13px] font-bold text-ink">{rec.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[13px] text-ink-soft">{rec.type.split('/').pop()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[13px] font-bold text-red-600">{rec.daysExpired} días</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-[13px] font-medium">
                                            <button 
                                                onClick={() => handleDelete(rec)}
                                                disabled={deleting === rec.id}
                                                className="px-3 py-1.5 bg-red-600 text-white font-semibold text-[11px] uppercase tracking-wider rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors shadow-sm"
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
        </div>
    );
}
