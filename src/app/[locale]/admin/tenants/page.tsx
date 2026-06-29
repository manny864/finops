"use client";
import { useEffect, useState } from "react";
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { Building2, Plus, ShieldAlert } from "lucide-react";
import { getFreshIdToken } from '@/lib/msalToken';

export default function SuperAdminTenantsPage() {
    const { systemRole } = useTenant();
    const { instance, accounts } = useMsal();
    const [tenants, setTenants] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    
    // New Tenant Form
    const [newTenantId, setNewTenantId] = useState('');
    const [newTenantName, setNewTenantName] = useState('');
    const [newTier, setNewTier] = useState('Essential');
    const [creating, setCreating] = useState(false);

    const isSuperAdmin = systemRole === 'SUPERADMIN';

    const loadTenants = async () => {
        if (!isSuperAdmin || accounts.length === 0) return;
        setLoading(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
            const res = await fetch(`/api/tenants`, {
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
            });
            const json = await res.json();
            if (res.ok && json.tenants) {
                setTenants(json.tenants);
            }
        } catch (e) {
            console.error("Error loading tenants:", e);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadTenants();
    }, [systemRole, accounts, instance]);

    const handleCreateManualTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTenantId || !newTenantName) {
            toast.error("El Tenant ID y el Nombre son obligatorios.");
            return;
        }

        setCreating(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
            const res = await fetch('/api/admin/tenants', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: newTenantId,
                    name: newTenantName,
                    tier: newTier
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success("Tenant creado exitosamente.");
                setNewTenantId('');
                setNewTenantName('');
                setNewTier('Essential');
                loadTenants();
            } else {
                toast.error(json.error || "Error al crear Tenant.");
            }
        } catch (e) {
            console.error("Error creating tenant:", e);
            toast.error("Error de conexión.");
        }
        setCreating(false);
    };

    const handleTierChange = async (tenantId: string, newTierValue: string) => {
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
            const res = await fetch('/api/admin/tenants', {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId,
                    tier: newTierValue
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success("Tier actualizado exitosamente.");
                loadTenants();
            } else {
                toast.error(json.error || "Error al actualizar Tier.");
            }
        } catch (e) {
            console.error("Error updating tier:", e);
            toast.error("Error de conexión.");
        }
    };

    if (!isSuperAdmin) {
        return (
            <div className="p-6 max-w-5xl mx-auto flex flex-col items-center justify-center min-h-[50vh]">
                <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Acceso Denegado</h2>
                <p className="text-gray-500 mt-2">Esta página es exclusiva para Super Administradores.</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <Building2 className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
                    Gestión de Tenants (SuperAdmin)
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    Crea tenants manualmente evadiendo la pasarela de pagos y administra los Tiers asignados.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex items-center gap-2">
                    <Plus className="w-5 h-5 text-gray-500" />
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Registrar Tenant Manual</h3>
                </div>
                <div className="p-6">
                    <form onSubmit={handleCreateManualTenant} className="flex flex-col md:flex-row gap-4 items-end">
                        <div className="flex-1 w-full">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Entra ID del Tenant (Directorio)</label>
                            <input 
                                type="text" 
                                required
                                value={newTenantId}
                                onChange={e => setNewTenantId(e.target.value)}
                                placeholder="00000000-0000-0000-0000-000000000000"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md focus:ring-[#0054A6] bg-white dark:bg-slate-800"
                            />
                        </div>
                        <div className="flex-1 w-full">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre Comercial de la Empresa</label>
                            <input 
                                type="text" 
                                required
                                value={newTenantName}
                                onChange={e => setNewTenantName(e.target.value)}
                                placeholder="Empresa S.A."
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md focus:ring-[#0054A6] bg-white dark:bg-slate-800"
                            />
                        </div>
                        <div className="w-full md:w-48">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tier Inicial</label>
                            <select 
                                value={newTier}
                                onChange={e => setNewTier(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800"
                            >
                                <option value="Essential">Essential</option>
                                <option value="Professional">Professional</option>
                                <option value="Business">Business</option>
                                <option value="Enterprise">Enterprise</option>
                            </select>
                        </div>
                        <button 
                            type="submit"
                            disabled={creating}
                            className="w-full md:w-auto px-6 py-2 bg-[#0054A6] text-white rounded-md font-semibold hover:bg-[#004080] disabled:opacity-50"
                        >
                            {creating ? 'Creando...' : 'Crear Tenant'}
                        </button>
                    </form>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-gray-500" />
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Todos los Tenants ({tenants.length})</h3>
                    </div>
                </div>
                <div className="p-6">
                    {loading ? (
                        <div className="text-sm text-gray-400">Cargando tenants...</div>
                    ) : tenants.length === 0 ? (
                        <div className="text-sm text-gray-500">No hay tenants registrados.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                                <thead className="bg-gray-50 dark:bg-slate-900">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Empresa</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tenant ID</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Suscripción</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tier Actual</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                                    {tenants.map((t) => (
                                        <tr key={t.id}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{t.name || '-'}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">{t.id}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{t.subscription_status}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                <select 
                                                    value={t.tier || 'Essential'}
                                                    onChange={(e) => handleTierChange(t.id, e.target.value)}
                                                    className="px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-sm font-medium"
                                                >
                                                    <option value="Essential">Essential</option>
                                                    <option value="Professional">Professional</option>
                                                    <option value="Business">Business</option>
                                                    <option value="Enterprise">Enterprise</option>
                                                </select>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
