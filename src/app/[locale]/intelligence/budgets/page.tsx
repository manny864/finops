"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { Target, Loader2, Plus, AlertCircle } from 'lucide-react';
import CreateBudgetModal from '@/components/CreateBudgetModal';

export default function BudgetsPage() {
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const { instance, accounts } = useMsal();
    
    const [budgets, setBudgets] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    
    // Modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [azureModalOpen, setAzureModalOpen] = useState(false);
    const [costCenter, setCostCenter] = useState('');
    const [monthlyLimit, setMonthlyLimit] = useState('');
    const [saving, setSaving] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || accounts.length === 0) return;
        
        const fetchBudgets = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const res = await fetch(`/api/budgets?tenantId=${selectedTenant.id}&subscriptionId=${selectedSubscription}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (res.ok && json.budgets) {
                    setBudgets(json.budgets);
                } else {
                    toast.error(json.error || "Error al cargar presupuestos");
                }
            } catch (e) {
                console.error("Error fetching budgets:", e);
                toast.error("Error al conectar con el servidor.");
            }
            setLoading(false);
        };
        fetchBudgets();
    }, [selectedTenant.id, selectedSubscription, accounts, instance, refreshKey]);

    const handleSaveBudget = async () => {
        if (!costCenter || !monthlyLimit) {
            toast.error("Por favor complete todos los campos.");
            return;
        }

        setSaving(true);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });

            const res = await fetch('/api/budgets', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    costCenter,
                    monthlyLimit: parseFloat(monthlyLimit),
                    alertThreshold: 80.0
                })
            });

            if (res.ok) {
                toast.success("Presupuesto configurado exitosamente.");
                setModalOpen(false);
                setCostCenter('');
                setMonthlyLimit('');
                // Refetch
                const resBudgets = await fetch(`/api/budgets?tenantId=${selectedTenant.id}&subscriptionId=${selectedSubscription}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await resBudgets.json();
                if (json.budgets) setBudgets(json.budgets);
            } else {
                toast.error("Error al guardar el presupuesto.");
            }
        } catch (e) {
            console.error("Error saving budget:", e);
            toast.error("Error al conectar con el servidor.");
        }
        setSaving(false);
    };

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 shadow-sm">
                <span className="text-4xl mb-4">🏢</span>
                <h2 className="text-xl font-bold text-gray-700">Selecciona un Tenant</h2>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto p-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center">
                        <Target className="w-8 h-8 mr-3 text-indigo-600" /> Seguimiento de Presupuestos
                    </h1>
                    <p className="text-sm text-gray-500 mt-2">Monitorea el consumo mes a mes filtrado por Centro de Costos.</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => setModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg shadow-sm transition-colors text-sm font-bold"
                    >
                        <Plus className="w-5 h-5" /> Presupuesto Local
                    </button>
                    <button
                        onClick={() => setAzureModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-colors text-sm font-bold"
                    >
                        <Plus className="w-5 h-5" /> Crear en Azure
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center h-64">
                    <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
                    <span className="text-gray-500 font-medium">Calculando gastos acumulados...</span>
                </div>
            ) : budgets.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 rounded-xl p-12 text-center shadow-sm">
                    <Target className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-bold text-gray-700">Sin Presupuestos Activos</h3>
                    <p className="text-gray-500 text-sm mt-2 mb-6">No has definido ningún límite de gasto por centro de costo.</p>
                    <div className="flex justify-center gap-3">
                        <button
                            onClick={() => setModalOpen(true)}
                            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                        >
                            Crear Límite Local
                        </button>
                        <button
                            onClick={() => setAzureModalOpen(true)}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold"
                        >
                            Crear en Azure
                        </button>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {budgets.map(b => {
                        const pct = Math.min(b.utilization, 100);
                        const isDanger = pct >= b.alertThreshold;
                        return (
                            <div key={b.id} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col transition-all hover:shadow-md relative overflow-hidden">
                                {isDanger && (
                                    <div className="absolute top-0 right-0 p-2 text-red-500 bg-red-50 rounded-bl-lg">
                                        <AlertCircle className="w-5 h-5" />
                                    </div>
                                )}
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Centro de Costos</h4>
                                <h3 className="text-xl font-bold text-gray-800 mb-4">{b.costCenter}</h3>
                                
                                <div className="flex justify-between items-end mb-2">
                                    <span className="text-3xl font-extrabold text-gray-900">
                                        ${b.currentSpend.toFixed(2)}
                                    </span>
                                    <span className="text-sm font-semibold text-gray-500 mb-1">
                                        / ${b.monthlyLimit.toFixed(2)}
                                    </span>
                                </div>
                                
                                <div className="w-full bg-gray-100 rounded-full h-3 mt-2">
                                    <div 
                                        className={`h-3 rounded-full ${isDanger ? 'bg-red-500' : 'bg-green-500'} transition-all duration-1000`} 
                                        style={{ width: `${pct}%` }}
                                    ></div>
                                </div>
                                <div className="mt-2 text-right">
                                    <span className={`text-xs font-bold ${isDanger ? 'text-red-600' : 'text-gray-500'}`}>
                                        {b.utilization.toFixed(1)}% Consumido
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal */}
            {modalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95">
                        <div className="px-6 py-4 border-b border-gray-200">
                            <h2 className="text-lg font-bold text-gray-900">Establecer Límite Mensual</h2>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Valor Etiqueta (CostCenter)</label>
                                <input 
                                    type="text" 
                                    value={costCenter}
                                    onChange={(e) => setCostCenter(e.target.value)}
                                    placeholder="Ej. Marketing, IT, R&D"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Límite Mensual (USD)</label>
                                <input 
                                    type="number" 
                                    value={monthlyLimit}
                                    onChange={(e) => setMonthlyLimit(e.target.value)}
                                    placeholder="Ej. 5000"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
                            <button 
                                onClick={() => setModalOpen(false)}
                                className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-md"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={handleSaveBudget}
                                disabled={saving}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-md disabled:opacity-50"
                            >
                                {saving ? 'Guardando...' : 'Guardar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <CreateBudgetModal 
                isOpen={azureModalOpen}
                onClose={() => setAzureModalOpen(false)}
                onSuccess={() => setRefreshKey(prev => prev + 1)}
                subscriptionId={selectedSubscription}
                tenantId={selectedTenant.id}
            />
        </div>
    );
}
