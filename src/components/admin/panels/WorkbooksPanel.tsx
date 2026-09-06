"use client";

import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import {
    IconBook,
    IconPackage,
    IconCloudUpload,
    IconCopy,
    IconCheck,
    IconPlus,
    IconAlertCircle,
    IconLoader2,
    IconBrandAzure,
    IconFolder,
    IconSparkles,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import MockBanner from '@/components/MockBanner';
import CreateResourceGroupModal from '@/components/CreateResourceGroupModal';
import { isMockTenant } from '@/lib/mockData';
import FeatureGuard from '@/components/FeatureGuard';
import InfoTooltip from '@/components/InfoTooltip';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';

const DEMO_SUBSCRIPTIONS = [
    { id: 'sub-demo-finops-prod', name: 'CSCS-LandingZone (Producción)' },
    { id: 'sub-demo-finops-stage', name: 'CSCS-Staging-Zone (Pre-Producción)' },
];

const DEMO_RGS: Record<string, { name: string; location: string }[]> = {
    'sub-demo-finops-prod': [
        { name: 'rg-finops-workbooks-prod', location: 'eastus2' },
        { name: 'rg-cscs-monitoring', location: 'eastus2' },
        { name: 'rg-cscs-governance', location: 'brazilsouth' },
    ],
    'sub-demo-finops-stage': [
        { name: 'rg-finops-workbooks-stg', location: 'eastus2' },
        { name: 'rg-cscs-stage-monitoring', location: 'eastus2' },
    ],
};

export default function WorkbooksPanel() {
    const t = useTranslations('Workbooks');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || '';
    const isMock = isMockTenant(tenantId);

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

    const [copiedCli, setCopiedCli] = useState(false);

    useEffect(() => {
        if (!tenantId || tenantId === 'default') return;

        if (isMock) {
            setSubscriptions(DEMO_SUBSCRIPTIONS);
            return;
        }

        if (accounts.length === 0) return;

        const fetchSubs = async () => {
            setLoadingSubs(true);
            try {
                const token = await getFreshIdToken(instance, accounts[0]);
                const res = await fetch(`/api/subscriptions?tenantId=${tenantId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const json = await res.json();
                if (json.subscriptions) setSubscriptions(json.subscriptions);
            } catch (e) {
                console.error('[WorkbooksPanel] Error fetching subscriptions:', e);
            } finally {
                setLoadingSubs(false);
            }
        };

        fetchSubs();
    }, [accounts, instance, tenantId, isMock]);

    const fetchRgs = async (subId: string) => {
        setRgs([]);
        if (!subId) return;

        if (isMock) {
            setRgs(DEMO_RGS[subId] || [
                { name: 'rg-default-workbooks', location: 'eastus2' },
                { name: 'rg-finops-monitoring', location: 'eastus' },
            ]);
            return;
        }

        if (accounts.length === 0) return;

        setLoadingRgs(true);
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(`/api/resourcegroups?tenantId=${tenantId}&subscriptionId=${subId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (json.resourceGroups) setRgs(json.resourceGroups);
        } catch (e) {
            console.error('[WorkbooksPanel] Error fetching resource groups:', e);
        } finally {
            setLoadingRgs(false);
        }
    };

    const handleSubChange = (val: string, setter: (s: string) => void, isCost: boolean) => {
        setter(val);
        if (isCost) {
            setRgCost('');
        } else {
            setRgZombie('');
        }
        fetchRgs(val);
    };

    const handleCopyCli = () => {
        navigator.clipboard.writeText('az provider register --namespace microsoft.insights');
        setCopiedCli(true);
        toast.success('Comando copiado al portapapeles');
        setTimeout(() => setCopiedCli(false), 2500);
    };

    const handleDeploy = async (
        type: string,
        subscriptionId: string,
        resourceGroupName: string,
        setLoading: (s: boolean) => void
    ) => {
        if (!subscriptionId || !resourceGroupName) {
            toast.error(t('rgRequired'));
            return;
        }

        if (isMock) {
            setLoading(true);
            setTimeout(() => {
                setLoading(false);
                toast.success(t('deploySuccess', { rg: resourceGroupName }));
            }, 1200);
            return;
        }

        if (accounts.length === 0) {
            toast.error('Inicia sesión para desplegar en Azure');
            return;
        }

        const workbookType = type === 'cost' ? 'cost-optimization' : 'zombie-resources';

        setLoading(true);
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(`/api/admin/workbooks`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ subscriptionId, resourceGroupName, workbookType }),
            });

            const json = await res.json();
            if (res.ok && json.success) {
                toast.success(t('deploySuccess', { rg: resourceGroupName }));
            } else {
                toast.error(json.error || t('deployError'));
            }
        } catch (e) {
            console.error('[WorkbooksPanel] Deploy error:', e);
            toast.error(t('deployUnexpected'));
        } finally {
            setLoading(false);
        }
    };

    if (tenantId === 'default' || !tenantId) {
        return (
            <div className="w-full max-w-full flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-[#0078D4] mb-4 shadow-inner">
                    <IconBook size={28} stroke={1.5} />
                </div>
                <h2 className="text-lg font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: 'Montserrat, "Montserrat Fallback", sans-serif' }}>
                    {t('selectTenantTitle')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                    {t('selectTenantDesc')}
                </p>
            </div>
        );
    }

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6 animate-in fade-in duration-300">
            <MockBanner />

            {/* 1. HEADER PRINCIPAL (ANCHO 100%) */}
            <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                    <div className="flex items-center gap-2">
                        <IconBook size={26} stroke={1.75} className="text-[#0078D4]" />
                        <h1
                            className="text-2xl font-bold tracking-tight text-[#1B2A41] dark:text-white flex items-center gap-1.5"
                            style={{ fontFamily: 'Montserrat, "Montserrat Fallback", sans-serif' }}
                        >
                            {t('pageTitle')}
                            <InfoTooltip content="Required Roles (Enterprise): Monitoring Contributor (workbooks/write) + Custom Role con Microsoft.Resources/subscriptions/resourceGroups/write (para crear RGs desde la UI). El onboarding script Enterprise los asigna automáticamente." />
                        </h1>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-3xl leading-relaxed">
                        {t('pageSubtitle')}
                    </p>
                </div>
            </div>

            {/* 2. BANNER INFORMATIVO "AVISO: PROVIDER 'MICROSOFT.INSIGHTS'" (ANCHO 100%) */}
            <div className="w-full bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-5 rounded-2xl shadow-sm mb-6">
                <div className="flex items-start gap-3">
                    <IconAlertCircle size={20} className="text-[#0078D4] shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <h2 className="text-sm font-bold text-[#1B2A41] dark:text-blue-200 flex items-center gap-1.5">
                            Aviso: Resource Provider &apos;microsoft.insights&apos; (Azure Monitor)
                        </h2>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                            {t("providerRetryNote")}
                        </p>

                        {/* Bloque de Código CLI Interactivo */}
                        <div className="mt-3 bg-slate-900 text-slate-100 font-mono text-xs p-3 rounded-lg flex items-center justify-between shadow-inner">
                            <span className="select-all text-blue-300">az provider register --namespace microsoft.insights</span>
                            <button
                                type="button"
                                onClick={handleCopyCli}
                                className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded border border-slate-700 transition-all cursor-pointer shrink-0 ml-3"
                                title="Copiar comando al portapapeles"
                            >
                                {copiedCli ? (
                                    <>
                                        <IconCheck size={14} className="text-emerald-400" />
                                        <span className="text-emerald-400 font-sans font-medium">Copiado</span>
                                    </>
                                ) : (
                                    <>
                                        <IconCopy size={14} className="text-slate-400" />
                                        <span className="font-sans font-medium">Copiar Comando</span>
                                    </>
                                )}
                            </button>
                        </div>

                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                            {t('provider_alert_retry')}
                        </p>
                    </div>
                </div>
            </div>

            {/* 3. SECCIÓN "ARTEFACTOS DISPONIBLES" */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <IconPackage size={20} className="text-[#0078D4]" />
                    <h2
                        className="text-lg font-bold text-[#1B2A41] dark:text-white"
                        style={{ fontFamily: 'Montserrat, "Montserrat Fallback", sans-serif' }}
                    >
                        {t('availableArtifacts')}
                    </h2>
                </div>

                <FeatureGuard featureName="Custom Workbooks" requiredTier="Enterprise">
                    <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* TARJETA 1: FINOPS COST OPTIMIZATION WORKBOOK */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 hover:border-[#0078D4]/50 transition-all overflow-hidden flex flex-col border-t-4 border-t-[#0078D4]">
                            <div className="p-6 flex-1 flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <h3
                                            className="text-base font-bold text-[#1B2A41] dark:text-white"
                                            style={{ fontFamily: 'Montserrat, "Montserrat Fallback", sans-serif' }}
                                        >
                                            FinOps Cost Optimization Workbook
                                        </h3>
                                        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-[#0078D4] dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                                            Azure Monitor Ready
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
                                        {t('costDesc')}
                                    </p>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                                <IconBrandAzure size={14} className="inline mr-1 text-[#0078D4]" />
                                                {t('subscription')}
                                            </label>
                                            <select
                                                value={subIdCost}
                                                onChange={(e) => handleSubChange(e.target.value, setSubIdCost, true)}
                                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg text-xs focus:ring-1 focus:ring-[#0078D4] focus:outline-none shadow-sm"
                                            >
                                                <option value="">{loadingSubs ? 'Cargando suscripciones...' : t('selectSubscription')}</option>
                                                {subscriptions.map((s: any) => (
                                                    <option key={s.id} value={s.id}>
                                                        {s.name || s.displayName || s.id}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                    <IconFolder size={14} className="inline mr-1 text-[#0078D4]" />
                                                    {t('targetRg')}
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setTargetSubForModal(subIdCost);
                                                        setIsRgModalOpen(true);
                                                    }}
                                                    disabled={!subIdCost}
                                                    className="text-xs font-semibold text-[#0078D4] hover:text-[#0060AA] flex items-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                >
                                                    <IconPlus size={13} className="inline text-[#0078D4]" />
                                                    <span>{t('createRg')}</span>
                                                </button>
                                            </div>
                                            <select
                                                value={rgCost}
                                                onChange={(e) => setRgCost(e.target.value)}
                                                disabled={!subIdCost || loadingRgs}
                                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg text-xs focus:ring-1 focus:ring-[#0078D4] focus:outline-none shadow-sm disabled:opacity-60"
                                            >
                                                <option value="">{loadingRgs ? t('loadingRgs') : t('selectRg')}</option>
                                                {rgs.map((r: any) => (
                                                    <option key={r.name} value={r.name}>
                                                        {r.name} ({r.location})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 mt-6 border-t border-slate-100 dark:border-slate-800">
                                    <button
                                        type="button"
                                        onClick={() => handleDeploy('cost', subIdCost, rgCost, setLoadingCost)}
                                        disabled={loadingCost || !subIdCost || !rgCost}
                                        className="bg-[#0078D4] text-white hover:bg-[#0060AA] w-full py-2.5 rounded-lg font-semibold text-xs flex items-center justify-center shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {loadingCost ? (
                                            <>
                                                <IconLoader2 size={16} className="animate-spin mr-2" />
                                                <span>{t('deploying')}</span>
                                            </>
                                        ) : (
                                            <>
                                                <IconCloudUpload size={16} stroke={1.5} className="mr-1.5" />
                                                <span>{t('deployAzure')}</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* TARJETA 2: ZOMBIE RESOURCES TRACKER (FONDO NEUTRO Y AZUL CORPORATIVO) */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 hover:border-[#0078D4]/50 transition-all overflow-hidden flex flex-col border-t-4 border-t-blue-600">
                            <div className="p-6 flex-1 flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <h3
                                            className="text-base font-bold text-[#1B2A41] dark:text-white"
                                            style={{ fontFamily: 'Montserrat, "Montserrat Fallback", sans-serif' }}
                                        >
                                            Zombie Resources Tracker
                                        </h3>
                                        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                                            FinOps Cleanup
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
                                        {t('zombieDesc')}
                                    </p>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                                <IconBrandAzure size={14} className="inline mr-1 text-[#0078D4]" />
                                                {t('subscription')}
                                            </label>
                                            <select
                                                value={subIdZombie}
                                                onChange={(e) => handleSubChange(e.target.value, setSubIdZombie, false)}
                                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg text-xs focus:ring-1 focus:ring-[#0078D4] focus:outline-none shadow-sm"
                                            >
                                                <option value="">{loadingSubs ? 'Cargando suscripciones...' : t('selectSubscription')}</option>
                                                {subscriptions.map((s: any) => (
                                                    <option key={s.id} value={s.id}>
                                                        {s.name || s.displayName || s.id}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                    <IconFolder size={14} className="inline mr-1 text-[#0078D4]" />
                                                    {t('targetRg')}
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setTargetSubForModal(subIdZombie);
                                                        setIsRgModalOpen(true);
                                                    }}
                                                    disabled={!subIdZombie}
                                                    className="text-xs font-semibold text-[#0078D4] hover:text-[#0060AA] flex items-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                >
                                                    <IconPlus size={13} className="inline text-[#0078D4]" />
                                                    <span>{t('createRg')}</span>
                                                </button>
                                            </div>
                                            <select
                                                value={rgZombie}
                                                onChange={(e) => setRgZombie(e.target.value)}
                                                disabled={!subIdZombie || loadingRgs}
                                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg text-xs focus:ring-1 focus:ring-[#0078D4] focus:outline-none shadow-sm disabled:opacity-60"
                                            >
                                                <option value="">{loadingRgs ? t('loadingRgs') : t('selectRg')}</option>
                                                {rgs.map((r: any) => (
                                                    <option key={r.name} value={r.name}>
                                                        {r.name} ({r.location})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 mt-6 border-t border-slate-100 dark:border-slate-800">
                                    <button
                                        type="button"
                                        onClick={() => handleDeploy('zombie', subIdZombie, rgZombie, setLoadingZombie)}
                                        disabled={loadingZombie || !subIdZombie || !rgZombie}
                                        className="bg-[#0078D4] text-white hover:bg-[#0060AA] w-full py-2.5 rounded-lg font-semibold text-xs flex items-center justify-center shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {loadingZombie ? (
                                            <>
                                                <IconLoader2 size={16} className="animate-spin mr-2" />
                                                <span>{t('deploying')}</span>
                                            </>
                                        ) : (
                                            <>
                                                <IconCloudUpload size={16} stroke={1.5} className="mr-1.5" />
                                                <span>{t('deployAzure')}</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </FeatureGuard>
            </div>

            {/* 4. MODAL CREAR NUEVO RESOURCE GROUP (Z-[100]) */}
            <CreateResourceGroupModal
                isOpen={isRgModalOpen}
                onClose={() => setIsRgModalOpen(false)}
                tenantId={tenantId}
                subscriptionId={targetSubForModal}
                onSuccess={() => {
                    fetchRgs(targetSubForModal);
                }}
            />
        </div>
    );
}
