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
        <div className="bg-white border border-red-200 rounded-lg shadow-sm p-6 mt-6">
            <h3 className="text-lg font-bold text-red-800 mb-2">Entornos de Desarrollo Expirados (TTL)</h3>
            <p className="text-sm text-gray-600 mb-4">Los siguientes recursos han superado su tiempo de vida estipulado y pueden ser recolectados.</p>
            
            {loading ? (
                <div className="h-20 flex items-center justify-center">
                    <div className="text-sm text-gray-400 animate-pulse">Consultando expiraciones...</div>
                </div>
            ) : expiredResources.length === 0 ? (
                <div className="text-sm text-green-600 bg-green-50 p-4 rounded-md border border-green-100 flex items-center justify-center text-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                    Todo en orden. No hay entornos que hayan superado su Tiempo de Vida (TTL).
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
