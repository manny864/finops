"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { BookOpen, Box, Loader2, CloudUpload, Plus } from 'lucide-react';
import { toast } from 'sonner';
import CreateResourceGroupModal from '@/components/CreateResourceGroupModal';
import { isMockTenant } from '@/lib/mockData';
import FeatureGuard from '@/components/FeatureGuard';
import { Info } from 'lucide-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

export default function WorkbooksPage() {
    const t = useTranslations('Workbooks');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    
    const [subscriptions, setSubscriptions] = useState<any[]>([]);
    const [rgs, setRgs] = useState<any[]>([]);
    const [loadingSubs, setLoadingSubs] = useState(false);
    const [loadingRgs, setLoadingRgs] = useState(false);
    
    const [isRgModalOpen, setIsRgModalOpen] = useState(false);
    const [targetSubForModal, setTargetSubForModal] = useState('');

    const [subIdCost, setSubIdCost] = useState('');
    const [rgCost, setRgCost] = useState('');
    const [loadingCost, setLoadingCost] = useState(false);

    const [subIdZombie, setSubIdZombie] = useState('');
    const [rgZombie, setRgZombie] = useState('');
    const [loadingZombie, setLoadingZombie] = useState(false);

    useEffect(() => {
        if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') return;
        
        const fetchSubs = async () => {
            setLoadingSubs(true);
            try {
                const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
                const res = await fetch(`/api/subscriptions?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.subscriptions) setSubscriptions(json.subscriptions);
            } catch(e) {}
            setLoadingSubs(false);
        };
        fetchSubs();
    }, [accounts, instance, selectedTenant.id]);

    const fetchRgs = async (subId: string) => {
        setRgs([]);
        if (!subId) return;
        setLoadingRgs(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const res = await fetch(`/api/resourcegroups?tenantId=${selectedTenant.id}&subscriptionId=${subId}`, {
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
            });
            const json = await res.json();
            if (json.resourceGroups) setRgs(json.resourceGroups);
        } catch(e) {}
        setLoadingRgs(false);
    };

    const handleSubChange = (val: string, setter: any, isCost: boolean) => {
        setter(val);
        if (isCost) {
            setRgCost('');
        } else {
            setRgZombie('');
        }
        fetchRgs(val);
    };

    const handleDeploy = async (type: string, subscriptionId: string, resourceGroupName: string, setLoading: (s: boolean) => void) => {
        if (!subscriptionId || !resourceGroupName) {
            toast.error("Por favor ingresa Subscription ID y Resource Group.");
            return;
        }
        if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || ''))) return;

        const workbookType = type === 'cost' ? 'cost-optimization' : 'zombie-resources';

        setLoading(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const res = await fetch(`/api/admin/workbooks`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ subscriptionId, resourceGroupName, workbookType })
            });
            
            const json = await res.json();
            if (res.ok && json.success) {
                toast.success(`Artefacto desplegado correctamente en ${resourceGroupName}`);
            } else {
                toast.error(json.error || "Error al desplegar el artefacto");
            }
        } catch (e) {
            toast.error("Ocurrió un error inesperado al desplegar.");
        }
        setLoading(false);
    };

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Selecciona un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Debes seleccionar una organización para inyectar artefactos.</p>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-8 border-b border-gray-200 dark:border-slate-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <BookOpen className="w-8 h-8 mr-3 text-[#0054A6]" />
                    Artefactos y Workbooks
                    <span title="Required Roles (Enterprise): Monitoring Contributor (workbooks/write) + Custom Role con Microsoft.Resources/subscriptions/resourceGroups/write (para crear RGs desde la UI). El onboarding script Enterprise los asigna automáticamente.">
                        <Info 
                            className="w-5 h-5 ml-3 text-gray-400 cursor-help" 
                        />
                    </span>
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Inyecta tableros de control y reportes directamente en el entorno de Azure del cliente.</p>
            </div>

            <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 flex items-center">
                    <Box className="w-5 h-5 mr-2 text-gray-500" />
                    Artefactos Disponibles
                </h2>
            </div>

            <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm">
                    <p className="font-semibold text-amber-800 dark:text-amber-300">{t('provider_alert_title')}</p>
                    <p className="text-amber-700 dark:text-amber-400 mt-1">{t('provider_alert_body')}</p>
                    <code className="inline-block mt-2 px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 text-xs font-mono">az provider register --namespace microsoft.insights</code>
                    <p className="text-amber-700 dark:text-amber-400 mt-2 text-xs">{t('provider_alert_retry')}</p>
                </div>
            </div>

            <FeatureGuard featureName="Custom Workbooks" requiredTier="Enterprise">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Cost Optimization */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col">
                        <div className="h-2 bg-[#0054A6]"></div>
                        <div className="p-6 flex-1">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">FinOps Cost Optimization Workbook</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Tablero basado en Azure Monitor para visualizar gastos, anomalías y predicciones.</p>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Suscripción</label>
                                    <select 
                                        value={subIdCost}
                                        onChange={e => handleSubChange(e.target.value, setSubIdCost, true)}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-md shadow-sm focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm placeholder-gray-500 dark:placeholder-gray-400"
                                    >
                                        <option value="">Selecciona una suscripción...</option>
                                        {subscriptions.map((s:any) => <option key={s.id} value={s.id}>{s.name || s.displayName || s.id}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Resource Group de Destino</label>
                                        <button 
                                            onClick={() => { setTargetSubForModal(subIdCost); setIsRgModalOpen(true); }}
                                            disabled={!subIdCost}
                                            className="text-xs font-semibold text-[#0054A6] hover:underline disabled:opacity-50"
                                        >
                                            + Crear Nuevo RG
                                        </button>
                                    </div>
                                    <select 
                                        value={rgCost}
                                        onChange={e => setRgCost(e.target.value)}
                                        disabled={!subIdCost || loadingRgs}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-md shadow-sm sm:text-sm placeholder-gray-500 dark:placeholder-gray-400"
                                    >
                                        <option value="">{loadingRgs ? 'Cargando...' : 'Selecciona un RG...'}</option>
                                        {rgs.map((r:any) => <option key={r.name} value={r.name}>{r.name} ({r.location})</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t">
                            <button 
                                onClick={() => handleDeploy('cost', subIdCost, rgCost, setLoadingCost)}
                                disabled={loadingCost || !subIdCost || !rgCost}
                                className="w-full flex justify-center items-center px-4 py-2 bg-[#0054A6] hover:bg-blue-800 text-white rounded-md shadow-sm text-sm font-semibold transition-colors disabled:opacity-50"
                            >
                                {loadingCost && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {!loadingCost && <CloudUpload className="w-4 h-4 mr-2" />}
                                <span>{loadingCost ? 'Desplegando...' : 'Desplegar en Azure'}</span>
                            </button>
                        </div>
                    </div>

                    {/* Zombie Tracker */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col">
                        <div className="h-2 bg-emerald-500"></div>
                        <div className="p-6 flex-1">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Zombie Resources Tracker</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Herramienta especializada para identificar IPs públicas sin uso y discos huérfanos.</p>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Suscripción</label>
                                    <select 
                                        value={subIdZombie}
                                        onChange={e => handleSubChange(e.target.value, setSubIdZombie, false)}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-md shadow-sm focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm placeholder-gray-500 dark:placeholder-gray-400"
                                    >
                                        <option value="">Selecciona una suscripción...</option>
                                        {subscriptions.map((s:any) => <option key={s.id} value={s.id}>{s.name || s.displayName || s.id}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Resource Group de Destino</label>
                                        <button 
                                            onClick={() => { setTargetSubForModal(subIdZombie); setIsRgModalOpen(true); }}
                                            disabled={!subIdZombie}
                                            className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50"
                                        >
                                            + Crear Nuevo RG
                                        </button>
                                    </div>
                                    <select 
                                        value={rgZombie}
                                        onChange={e => setRgZombie(e.target.value)}
                                        disabled={!subIdZombie || loadingRgs}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-md shadow-sm sm:text-sm placeholder-gray-500 dark:placeholder-gray-400"
                                    >
                                        <option value="">{loadingRgs ? 'Cargando...' : 'Selecciona un RG...'}</option>
                                        {rgs.map((r:any) => <option key={r.name} value={r.name}>{r.name} ({r.location})</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t">
                            <button 
                                onClick={() => handleDeploy('zombie', subIdZombie, rgZombie, setLoadingZombie)}
                                disabled={loadingZombie || !subIdZombie || !rgZombie}
                                className="w-full flex justify-center items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md shadow-sm text-sm font-semibold transition-colors disabled:opacity-50"
                            >
                                {loadingZombie && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {!loadingZombie && <CloudUpload className="w-4 h-4 mr-2" />}
                                <span>{loadingZombie ? 'Desplegando...' : 'Desplegar en Azure'}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </FeatureGuard>

            <CreateResourceGroupModal 
                isOpen={isRgModalOpen}
                onClose={() => setIsRgModalOpen(false)}
                tenantId={selectedTenant.id}
                subscriptionId={targetSubForModal}
                onSuccess={() => {
                    fetchRgs(targetSubForModal);
                }}
            />
        </div>
    );
}
