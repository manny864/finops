"use client";
import { useEffect, useState } from "react";
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { Building2, Plus, ShieldAlert, Link2, Copy, Check } from "lucide-react";
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

    // Cobro Enterprise vía Paddle: Price custom creado a mano en el dashboard
    // de Paddle para el deal negociado (ver instrucciones más abajo, en el
    // bloque "Cobrar vía Paddle" de la tabla). En vez de abrir el checkout
    // acá mismo, generamos un link hosteado por Paddle (Transactions API)
    // para mandárselo al cliente y que lo complete cuando quiera, eligiendo
    // su propio medio de pago. `custom_data: {tenant_id, tier}` viaja en la
    // transacción para que el webhook (/api/webhooks/paddle) sepa a qué
    // tenant/tier aplicar la suscripción al completarse el pago, sin
    // depender del mapeo fijo de priceId (los precios custom son
    // distintos por cliente).
    const [chargePriceId, setChargePriceId] = useState<Record<string, string>>({});
    const [generatingLink, setGeneratingLink] = useState<Record<string, boolean>>({});
    const [checkoutLinks, setCheckoutLinks] = useState<Record<string, string>>({});
    const [copiedTenantId, setCopiedTenantId] = useState<string | null>(null);

    const isSuperAdmin = systemRole === 'SUPERADMIN';

    const handleGenerateCheckoutLink = async (tenantId: string, tier: string) => {
        const priceId = (chargePriceId[tenantId] || '').trim();
        if (!priceId) {
            toast.error("Ingresá el Price ID de Paddle para este deal.");
            return;
        }
        setGeneratingLink(prev => ({ ...prev, [tenantId]: true }));
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const res = await fetch('/api/admin/tenants/paddle-checkout-link', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tenantId, tier, priceId }),
            });
            const json = await res.json();
            if (res.ok && json.checkoutUrl) {
                setCheckoutLinks(prev => ({ ...prev, [tenantId]: json.checkoutUrl }));
                toast.success("Link de checkout generado.");
            } else {
                toast.error(json.error || "Error al generar el link de checkout.");
            }
        } catch (e) {
            console.error("Error generating Paddle checkout link:", e);
            toast.error("Error de conexión.");
        }
        setGeneratingLink(prev => ({ ...prev, [tenantId]: false }));
    };

    const handleCopyLink = async (tenantId: string) => {
        const url = checkoutLinks[tenantId];
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopiedTenantId(tenantId);
            setTimeout(() => setCopiedTenantId(null), 2000);
        } catch {
            toast.error("No se pudo copiar el link. Copialo manualmente.");
        }
    };

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

    const handleSubscriptionStatusChange = async (tenantId: string, newStatus: string) => {
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
                    subscriptionStatus: newStatus
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success("Estado de suscripción actualizado exitosamente.");
                loadTenants();
            } else {
                toast.error(json.error || "Error al actualizar el estado de suscripción.");
            }
        } catch (e) {
            console.error("Error updating subscription status:", e);
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

            <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 rounded-xl p-5 mb-8 text-sm text-blue-900 dark:text-blue-200">
                <div className="flex items-center gap-2 font-bold mb-2">
                    <Link2 className="w-4 h-4" />
                    Cómo cobrar un deal Enterprise vía Paddle
                </div>
                <ol className="list-decimal list-inside space-y-1 leading-relaxed">
                    <li><strong>En Paddle</strong> (dashboard, una vez por deal): Catalog → Products → producto "Enterprise" → agregá un <strong>Price</strong> nuevo con el monto negociado con ese cliente. Configurá ahí el trial period si aplica. Copiá el <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">Price ID</code> (<code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">pri_...</code>).</li>
                    <li><strong>Acá abajo:</strong> si el tenant no existe, creálo con el formulario de "Registrar Tenant Manual". Buscá su fila en la tabla, pegá el Price ID en "Cobrar vía Paddle" y hacé clic en <strong>Generar link</strong>.</li>
                    <li>Copiá el link generado y mandáselo al cliente (email, WhatsApp, lo que uses). Es un checkout hosteado por Paddle: el cliente elige su medio de pago y paga cuando quiera — no hace falta que vos lo completes.</li>
                    <li><strong>Automático:</strong> al pagar, Paddle dispara el webhook (<code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">subscription.created</code>) que activa el tenant como Enterprise/ACTIVE con su <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">paddle_subscription_id</code> real. Renovaciones, vencimientos y cancelaciones los gestiona Paddle solo, igual que los demás planes.</li>
                </ol>
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
                        <div className="overflow-x-auto custom-scrollbar pb-2">
                            <table className="min-w-full table-fixed divide-y divide-gray-200 dark:divide-slate-700">
                                <thead className="bg-gray-50 dark:bg-slate-900">
                                    <tr>
                                        <th scope="col" className="w-40 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Empresa</th>
                                        <th scope="col" className="w-44 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tenant ID</th>
                                        <th scope="col" className="w-32 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Suscripción</th>
                                        <th scope="col" className="w-32 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tier Actual</th>
                                        <th scope="col" className="w-72 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cobrar vía Paddle</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                                    {tenants.map((t) => (
                                        <tr key={t.id}>
                                            <td className="px-6 py-4 break-words text-sm font-medium text-gray-900 dark:text-gray-100">{t.name || '-'}</td>
                                            <td className="px-6 py-4 break-all text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">{t.id}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                <select
                                                    value={t.subscription_status || 'ACTIVE'}
                                                    onChange={(e) => handleSubscriptionStatusChange(t.id, e.target.value)}
                                                    className="px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-sm font-medium"
                                                >
                                                    <option value="TRIAL">TRIAL</option>
                                                    <option value="ACTIVE">ACTIVE</option>
                                                    <option value="PAST_DUE">PAST_DUE</option>
                                                    <option value="CANCELED">CANCELED</option>
                                                    <option value="EXPIRED">EXPIRED</option>
                                                </select>
                                            </td>
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
                                            <td className="px-6 py-4 text-sm">
                                                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5">
                                                    <input
                                                        type="text"
                                                        placeholder="pri_..."
                                                        value={chargePriceId[t.id] || ''}
                                                        onChange={(e) => setChargePriceId(prev => ({ ...prev, [t.id]: e.target.value }))}
                                                        className="w-full sm:flex-1 min-w-0 px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-xs font-mono"
                                                    />
                                                    <button
                                                        onClick={() => handleGenerateCheckoutLink(t.id, t.tier || 'Enterprise')}
                                                        disabled={generatingLink[t.id]}
                                                        title="Genera un link de checkout de Paddle (customData: tenant_id + tier) para mandarle al cliente"
                                                        className="flex items-center justify-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 shrink-0 whitespace-nowrap"
                                                    >
                                                        <Link2 className="w-3.5 h-3.5 shrink-0" />
                                                        {generatingLink[t.id] ? 'Generando...' : 'Generar link'}
                                                    </button>
                                                </div>
                                                {checkoutLinks[t.id] && (
                                                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 mt-1.5">
                                                        <input
                                                            type="text"
                                                            readOnly
                                                            value={checkoutLinks[t.id]}
                                                            onFocus={(e) => e.target.select()}
                                                            className="w-full sm:flex-1 min-w-0 px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-gray-50 dark:bg-slate-900 text-xs font-mono text-gray-600 dark:text-gray-300"
                                                        />
                                                        <button
                                                            onClick={() => handleCopyLink(t.id)}
                                                            title="Copiar link"
                                                            className="flex items-center justify-center gap-1 px-2 py-1 border border-gray-300 dark:border-slate-700 rounded text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 shrink-0"
                                                        >
                                                            {copiedTenantId === t.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                                        </button>
                                                    </div>
                                                )}
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
