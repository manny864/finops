"use client";
/**
 * Motor de facturación de partner (CSP).
 *
 * Refactor visual y funcional profundo alineado a directivas corporativas:
 *   - Paleta corporativa: azul institucional (#0078D4 / #2563EB / #0284C7), fondos limpios y slate neutro.
 *   - Simulación en tiempo real (Optimistic UI) sin números verdes estridentes.
 *   - Tarifa fija de gestión mensual (Fixed Management Fee) + porcentaje de margen global.
 *   - Tabla de reglas de excepción con redimensionamiento interactivo de columnas (ResizableTh),
 *     menú popover de visibilidad de columnas (ColumnMenu) y persistencia en LocalStorage.
 *   - Contenedor full-width (100% ancho de ventana) con soporte de scrollbar nativo para macOS.
 *   - Modal de creación y edición de reglas en z-[100] con backdrop z-50.
 *   - Prevención de error 401 y segregación estricta Demo vs Live (cero fallbacks mock en tenants conectados).
 *   - Protección MFA con enforceMfaIfEnabled / useMfaChallenge('change_billing_config').
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import {
    IconAlertTriangle,
    IconColumns,
    IconCurrencyDollar,
    IconDeviceFloppy,
    IconEdit,
    IconInfoCircle,
    IconLoader2,
    IconPercentage,
    IconPlus,
    IconReceipt2,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import { useMfaChallenge } from "@/hooks/useMfaChallenge";
import { errorMessage } from '@/lib/apiErrors';
import InfoTooltip from '@/components/InfoTooltip';
import ResizableTh from '@/components/ResizableTh';
import Pagination, { usePagination } from '@/components/Pagination';
import { CELL, ColumnMenu, useColumnConfig, type TableColumnConfig } from '@/components/TableColumns';
import type { MarkupOverrideRuleItem, MarkupScopeType } from '@/types/tenantPartnerMarkup.types';
import { isMockTenant } from '@/lib/mockData';

// A nivel de modulo no hay `t`. Se piden desde el componente. De paso salieron
// "Regla", "Alcance", "Margen" y "Acciones", que el escaner de castellano no ve
// (sin acento ni palabra funcional) y que nadie habia reportado.
type T = (k: string, v?: Record<string, string | number>) => string;

const columnasDeReglas = (t: T): TableColumnConfig[] => [
    { id: 'ruleName', label: t("colRuleName"), visible: true },
    { id: 'scopeType', label: t("colScope"), visible: true },
    { id: 'scopeValue', label: t("colTarget"), visible: true },
    { id: 'percentage', label: t("colMargin"), visible: true },
    { id: 'status', label: t("colStatus"), visible: true },
    { id: 'actions', label: t("colActions"), visible: true },
];

const TH = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400";
const TD = "px-3 py-2.5 text-[12.5px] text-slate-700 dark:text-slate-300 align-middle";
const BADGE = "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border";

const BTN_PRIMARY =
    "inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-lg text-sm font-semibold " +
    "bg-[#0078D4] text-white border border-[#0078D4] hover:bg-[#0060AA] hover:border-[#0060AA] " +
    "disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm";

const BTN_SMALL =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold " +
    "bg-[#0078D4] text-white border border-[#0078D4] hover:bg-[#0060AA] hover:border-[#0060AA] " +
    "disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm";

const BTN_NEUTRAL =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium " +
    "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 " +
    "hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors";

const INPUT =
    "w-full px-3.5 py-2.5 rounded-lg text-sm bg-white dark:bg-slate-800 " +
    "border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white " +
    "outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] transition-colors";

const LABEL = "text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

const MACOS_SCROLL_CLASSES =
    "w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
    "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 " +
    "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
    "dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 " +
    "dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const reglasDemo = (t: T): MarkupOverrideRuleItem[] => [
    {
        id: 'demo-rule-1',
        tenantId: 'demo-tenant',
        ruleName: t("marketplacePassthrough"),
        scopeType: 'SERVICE_CATEGORY',
        scopeValue: 'Marketplace',
        overridePercentage: 0,
        isEnabled: true,
        createdAt: new Date().toISOString(),
    },
    {
        id: 'demo-rule-2',
        tenantId: 'demo-tenant',
        ruleName: t("criticalProdSubscription"),
        scopeType: 'SUBSCRIPTION',
        scopeValue: '11111111-2222-3333-4444-555555555555',
        overridePercentage: 5,
        isEnabled: true,
        createdAt: new Date().toISOString(),
    },
];

export default function PartnerMarkup() {
    const t = useTranslations('AdminMarkup');
    const RULE_COLUMNS = useMemo(() => columnasDeReglas(t), [t]);
    const MOCK_DEMO_RULES = useMemo(() => reglasDemo(t), [t]);
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { requestChallenge, mfaModal } = useMfaChallenge();
    const tier = (selectedTenant as any)?.tier || 'Professional';

    const tenantId = selectedTenant?.id || '';
    const isMock = isMockTenant(tenantId);

    const [markup, setMarkup] = useState<number>(15);
    const [fixedFee, setFixedFee] = useState<number>(500);
    const [isSaving, setIsSaving] = useState(false);
    const [rules, setRules] = useState<MarkupOverrideRuleItem[]>([]);
    const [showRuleModal, setShowRuleModal] = useState(false);
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [savingRule, setSavingRule] = useState(false);

    const [ruleForm, setRuleForm] = useState<{
        ruleName: string;
        scopeType: MarkupScopeType;
        scopeValue: string;
        overridePercentage: number;
    }>({
        ruleName: '',
        scopeType: 'SERVICE_CATEGORY',
        scopeValue: '',
        overridePercentage: 0,
    });

    const cols = useColumnConfig(`table_columns_config_markup_overrides_${tenantId}`, RULE_COLUMNS);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock) return {};
        const account = accounts[0];
        if (!account) return {};
        try {
            const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
            return { Authorization: `Bearer ${tokenResponse.idToken}` };
        } catch {
            return {};
        }
    }, [accounts, instance, isMock]);

    const fetcher = async (url: string) => {
        if (isMock) {
            return { success: true, markupPercentage: 15, cspDetected: true };
        }
        const account = accounts[0];
        if (!account) throw new Error(t('errorNoAccount'));

        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: account
        });

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || t('errorLoadingPricing'));
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (!isMock && selectedTenant && selectedTenant.id !== 'default' && accounts.length > 0)
            ? `/api/admin/billing-markup?tenantId=${selectedTenant.id}&tier=${tier}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    useEffect(() => {
        if (isMock) {
            setMarkup(15);
            setFixedFee(500);
            setRules(MOCK_DEMO_RULES);
            return;
        }
        if (data && typeof data.markupPercentage === 'number') {
            setMarkup(data.markupPercentage);
        }
    }, [data, isMock]);

    const loadMarkupConfig = useCallback(async () => {
        if (isMock) {
            setMarkup(15);
            setFixedFee(500);
            setRules(MOCK_DEMO_RULES);
            return;
        }
        if (!tenantId || tenantId === 'default' || accounts.length === 0) return;
        try {
            const res = await fetch(`/api/admin/config/markup?tenantId=${encodeURIComponent(tenantId)}`, {
                headers: await authHeaders(),
            });
            if (!res.ok) return;
            const json = await res.json();
            if (typeof json.settings?.globalMarkupPercentage === 'number') {
                setMarkup(json.settings.globalMarkupPercentage);
            }
            if (typeof json.settings?.fixedManagementFeeUSD === 'number') {
                setFixedFee(json.settings.fixedManagementFeeUSD);
            }
            if (Array.isArray(json.rules)) {
                setRules(json.rules);
            }
        } catch {
            // Silencioso para no romper la navegación si hay intermitencia de red.
        }
    }, [tenantId, accounts.length, authHeaders, isMock]);

    useEffect(() => {
        loadMarkupConfig();
    }, [loadMarkupConfig]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            if (isMock) {
                toast.success(t('saveSuccessToast'));
                setIsSaving(false);
                return;
            }

            // Operación sensible de facturación: solicitar MFA si el usuario tiene 2FA activado.
            const { challengeId, cancelled } = await requestChallenge('change_billing_config', { tenantId: selectedTenant.id });
            if (cancelled) {
                setIsSaving(false);
                return;
            }

            const response = await fetch(`/api/admin/config/markup`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...(await authHeaders()),
                    ...(challengeId ? { 'X-MFA-Challenge-Id': challengeId } : {})
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    globalMarkupPercentage: markup,
                    fixedManagementFeeUSD: fixedFee,
                    isMarkupEnabled: true,
                })
            });

            if (!response.ok) {
                const json = await response.json().catch(() => ({}));
                throw new Error(json.error || t('saveFailedError'));
            }

            toast.success(t('saveSuccessToast'));
            mutate({ success: true, markupPercentage: markup }, false);
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setIsSaving(false);
        }
    };

    const handleOpenCreateModal = () => {
        setEditingRuleId(null);
        setRuleForm({ ruleName: '', scopeType: 'SERVICE_CATEGORY', scopeValue: '', overridePercentage: 0 });
        setShowRuleModal(true);
    };

    const handleOpenEditModal = (rule: MarkupOverrideRuleItem) => {
        setEditingRuleId(rule.id);
        setRuleForm({
            ruleName: rule.ruleName,
            scopeType: rule.scopeType,
            scopeValue: rule.scopeValue,
            overridePercentage: rule.overridePercentage,
        });
        setShowRuleModal(true);
    };

    const handleSaveRule = async () => {
        if (!ruleForm.ruleName.trim() || !ruleForm.scopeValue.trim()) return;
        setSavingRule(true);
        try {
            if (isMock) {
                if (editingRuleId) {
                    setRules((prev) =>
                        prev.map((r) =>
                            r.id === editingRuleId
                                ? { ...r, ...ruleForm, ruleName: ruleForm.ruleName.trim(), scopeValue: ruleForm.scopeValue.trim() }
                                : r
                        )
                    );
                    toast.success(t('rules.updated'));
                } else {
                    const newMockRule: MarkupOverrideRuleItem = {
                        id: `demo-rule-${Date.now()}`,
                        tenantId,
                        ruleName: ruleForm.ruleName.trim(),
                        scopeType: ruleForm.scopeType,
                        scopeValue: ruleForm.scopeValue.trim(),
                        overridePercentage: ruleForm.overridePercentage,
                        isEnabled: true,
                        createdAt: new Date().toISOString(),
                    };
                    setRules((prev) => [newMockRule, ...prev]);
                    toast.success(t('rules.created'));
                }
                setShowRuleModal(false);
                setEditingRuleId(null);
                setRuleForm({ ruleName: '', scopeType: 'SERVICE_CATEGORY', scopeValue: '', overridePercentage: 0 });
                setSavingRule(false);
                return;
            }

            if (editingRuleId) {
                const res = await fetch('/api/admin/config/markup/rules', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
                    body: JSON.stringify({ tenantId, ruleId: editingRuleId, ...ruleForm }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || t('rules.saveFailed'));
                setRules(json.rules || []);
                toast.success(t('rules.updated'));
            } else {
                const res = await fetch('/api/admin/config/markup/rules', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
                    body: JSON.stringify({ tenantId, ...ruleForm }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || t('rules.saveFailed'));
                setRules(json.rules || []);
                toast.success(t('rules.created'));
            }

            setShowRuleModal(false);
            setEditingRuleId(null);
            setRuleForm({ ruleName: '', scopeType: 'SERVICE_CATEGORY', scopeValue: '', overridePercentage: 0 });
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setSavingRule(false);
        }
    };

    const toggleRule = async (rule: MarkupOverrideRuleItem) => {
        const previous = rules;
        setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, isEnabled: !r.isEnabled } : r)));
        if (isMock) return;

        try {
            const res = await fetch('/api/admin/config/markup/rules', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
                body: JSON.stringify({ tenantId, ruleId: rule.id, isEnabled: !rule.isEnabled }),
            });
            if (!res.ok) throw new Error(t('rules.toggleFailed'));
        } catch (err) {
            setRules(previous);
            toast.error(errorMessage(err));
        }
    };

    const deleteRule = async (rule: MarkupOverrideRuleItem) => {
        if (!window.confirm(t('rules.deleteConfirm', { name: rule.ruleName }))) return;

        if (isMock) {
            setRules((prev) => prev.filter((r) => r.id !== rule.id));
            toast.success(t('rules.deleted'));
            return;
        }

        try {
            const res = await fetch(
                `/api/admin/config/markup/rules?tenantId=${encodeURIComponent(tenantId)}&ruleId=${encodeURIComponent(rule.id)}`,
                { method: 'DELETE', headers: await authHeaders() }
            );
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t('rules.deleteFailed'));
            setRules(json.rules || []);
            toast.success(t('rules.deleted'));
        } catch (err) {
            toast.error(errorMessage(err));
        }
    };

    const pg = usePagination(rules, 15);

    // Cálculos de simulación en vivo (Optimistic UI)
    const baseCost = 10000;
    const markupAmount = useMemo(() => (baseCost * (Number(markup) || 0)) / 100, [baseCost, markup]);
    const parsedFixedFee = useMemo(() => Number(fixedFee) || 0, [fixedFee]);
    const totalBilled = useMemo(() => baseCost + markupAmount + parsedFixedFee, [baseCost, markupAmount, parsedFixedFee]);

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (isLoading && !isMock) {
        return (
            <div className="flex flex-col items-center justify-center py-20 w-full">
                <IconLoader2 size={32} stroke={1.5} className="animate-spin text-[#0078D4] mb-4" />
                <p className="text-slate-500 dark:text-slate-400 font-medium">{t('loadingBillingEngine')}</p>
            </div>
        );
    }

    if (error && !isMock) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={tier} featureName={t('tierLockedFeatureName')} />;
        }
        return (
            <div className="w-full bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 p-4 rounded-lg border border-rose-100 dark:border-rose-900/50">
                <p className="text-sm font-bold">{t('errorPrefix', { message: error.message })}</p>
            </div>
        );
    }

    const cspDetected = isMock || data?.cspDetected !== false;
    if (!cspDetected) {
        return (
            <div className="w-full max-w-full">
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-5 flex gap-3">
                    <IconInfoCircle size={20} stroke={1.5} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-900 dark:text-amber-200 space-y-2">
                        <p className="font-bold">{t('cspNotDetectedTitle')}</p>
                        <p>{data?.message || t('cspNotDetectedDefaultMessage')}</p>
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">{t('cspNotDetectedNote')}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-full space-y-6">
            {mfaModal}

            {/* SECCIÓN 1: Tarjeta Principal — Ajuste de Margen Global (Markup) */}
            <div className="w-full max-w-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="p-6 border-b border-slate-200 dark:border-slate-800">
                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                        <IconCurrencyDollar size={20} stroke={1.5} className="text-[#0078D4]" />
                        {t('sectionTitle')}
                        <InfoTooltip content={t('tooltips.section')} />
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                        {t('sectionDescription')}
                    </p>
                </div>

                <div className="p-6 space-y-6">
                    {/* Grid de 2 Columnas: Porcentaje y Tarifa Fija */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="flex flex-col gap-1.5">
                            <label className={`${LABEL} flex items-center gap-1.5`}>
                                {t('markupLabel')}
                                <InfoTooltip content={t('tooltips.markup')} />
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    min="0"
                                    max="999.99"
                                    step="0.1"
                                    value={markup}
                                    onChange={(e) => setMarkup(Number(e.target.value))}
                                    className={`${INPUT} pr-10 font-bold text-base`}
                                    placeholder="15"
                                />
                                <IconPercentage size={18} stroke={1.5} className="text-slate-400 absolute right-3 top-3 pointer-events-none" />
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className={`${LABEL} flex items-center gap-1.5`}>
                                {t('fixedFeeLabel')}
                                <InfoTooltip content={t('tooltips.fixedFee')} />
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    min="0"
                                    step="10"
                                    value={fixedFee}
                                    onChange={(e) => setFixedFee(Number(e.target.value))}
                                    className={`${INPUT} pl-8 font-bold text-base`}
                                    placeholder="500"
                                />
                                <IconCurrencyDollar size={18} stroke={1.5} className="text-slate-400 absolute left-2.5 top-3 pointer-events-none" />
                            </div>
                        </div>
                    </div>

                    {/* Caja de Simulación de Facturación (Full Width, Fondo Slate Claro, Cifras en Paleta Azul Corporativa) */}
                    <div className="w-full bg-slate-50 dark:bg-slate-800/50 p-5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5">
                            {t('simulationTitle')}
                            <InfoTooltip content={t('tooltips.simulation')} />
                        </h4>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-600 dark:text-slate-400">{t('baseCostLabel')}</span>
                                <span className="font-medium text-slate-900 dark:text-white tabular-nums">$10,000.00</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-600 dark:text-slate-400">{t('yourMarkupLabel', { markup })}</span>
                                <span className="font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                                    +${money(markupAmount)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-600 dark:text-slate-400">{t('fixedFeeRowLabel')}</span>
                                <span className="font-semibold text-[#0284C7] dark:text-cyan-400 tabular-nums">
                                    +${money(parsedFixedFee)}
                                </span>
                            </div>
                            <hr className="my-3 border-slate-300 dark:border-slate-600" />
                            <div className="flex items-center justify-between font-bold">
                                <span className="text-[#1B2A41] dark:text-white">{t('finalCostLabel')}</span>
                                <span className="text-[#0078D4] dark:text-blue-400 text-lg tabular-nums font-bold">
                                    ${money(totalBilled)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                    <button onClick={handleSave} disabled={isSaving} className={BTN_PRIMARY}>
                        {isSaving
                            ? <IconLoader2 size={16} stroke={1.5} className="animate-spin" />
                            : <IconDeviceFloppy size={16} stroke={1.5} />}
                        {t('applyButton')}
                    </button>
                </div>
            </div>

            {/* SECCIÓN 2: Tabla de Reglas de Excepción (Overrides) — Estándar CMP */}
            <div className="w-full max-w-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                        <IconReceipt2 size={20} stroke={1.5} className="text-[#0078D4]" />
                        {t('rules.title')}
                        <InfoTooltip content={t('tooltips.rules')} />
                    </h3>
                    <div className="flex items-center gap-2">
                        <ColumnMenu {...cols} label={t('customizeColumns')} />
                        <button onClick={handleOpenCreateModal} className={BTN_SMALL}>
                            <IconPlus size={16} stroke={1.5} />
                            {t('rules.new')}
                        </button>
                    </div>
                </div>

                {rules.length === 0 ? (
                    <div className="p-12 text-center">
                        <IconReceipt2 size={36} stroke={1.2} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('rules.emptyTitle')}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto">{t('rules.emptyHint')}</p>
                    </div>
                ) : (
                    <>
                        <div className={MACOS_SCROLL_CLASSES}>
                            <table className="w-full text-left text-xs border-collapse">
                                <thead className="bg-slate-50 dark:bg-slate-800/50">
                                    <tr>
                                        {RULE_COLUMNS.filter((c) => cols.isVisible(c.id)).map((c) => (
                                            <ResizableTh key={c.id} minWidth={c.id === 'ruleName' ? 200 : 130} className={TH}>
                                                {t(`rules.col_${c.id}`)}
                                                <InfoTooltip content={t(`tooltips.col_${c.id}`)} />
                                            </ResizableTh>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {pg.paged.map((r) => (
                                        <tr key={r.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                            {cols.isVisible('ruleName') && (
                                                <td className={TD}>
                                                    <div className={`${CELL} font-semibold text-[#1B2A41] dark:text-white flex items-center gap-1.5`} title={r.ruleName}>
                                                        <IconReceipt2 size={15} stroke={1.5} className="text-[#0078D4] shrink-0" />
                                                        <span className="truncate">{r.ruleName}</span>
                                                    </div>
                                                </td>
                                            )}
                                            {cols.isVisible('scopeType') && (
                                                <td className={TD}>
                                                    <span className={`${BADGE} bg-blue-50 text-[#0078D4] border-blue-200 dark:bg-blue-950/30 dark:border-blue-900 whitespace-nowrap`}>
                                                        {t(`rules.scope_${r.scopeType}`)}
                                                    </span>
                                                </td>
                                            )}
                                            {cols.isVisible('scopeValue') && (
                                                <td className={TD}>
                                                    <div className={`${CELL} font-mono text-[11.5px]`} title={r.scopeValue}>
                                                        {r.scopeValue}
                                                    </div>
                                                </td>
                                            )}
                                            {cols.isVisible('percentage') && (
                                                <td className={TD}>
                                                    <span className={`${BADGE} bg-blue-50 text-[#0078D4] border-blue-200 dark:bg-blue-950/30 dark:border-blue-900 whitespace-nowrap tabular-nums font-bold`}>
                                                        {r.overridePercentage === 0 ? t('rules.passThrough') : `+${r.overridePercentage}%`}
                                                    </span>
                                                </td>
                                            )}
                                            {cols.isVisible('status') && (
                                                <td className={TD}>
                                                    <button
                                                        type="button"
                                                        role="switch"
                                                        aria-checked={r.isEnabled}
                                                        onClick={() => toggleRule(r)}
                                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                                            r.isEnabled ? 'bg-[#0078D4]' : 'bg-slate-300 dark:bg-slate-700'
                                                        }`}
                                                        title={r.isEnabled ? t('rules.enabled') : t('rules.disabled')}
                                                    >
                                                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                                            r.isEnabled ? 'translate-x-5' : 'translate-x-1'
                                                        }`} />
                                                    </button>
                                                </td>
                                            )}
                                            {cols.isVisible('actions') && (
                                                <td className={TD}>
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => handleOpenEditModal(r)}
                                                            title={t('rules.editAction')}
                                                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                                        >
                                                            <IconEdit size={15} stroke={1.5} className="text-slate-500 hover:text-[#0078D4]" />
                                                        </button>
                                                        <button
                                                            onClick={() => deleteRule(r)}
                                                            title={t('rules.delete')}
                                                            className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                                                        >
                                                            <IconTrash size={15} stroke={1.5} className="text-slate-400 hover:text-rose-600" />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800">
                            <Pagination {...pg} pageSizes={[15, 30, 45, 60]} />
                        </div>
                    </>
                )}
            </div>

            {/* MODAL DE CREACIÓN / EDICIÓN DE REGLA (Z-Index 100) */}
            {showRuleModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50" onClick={() => !savingRule && setShowRuleModal(false)} />
                    <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 z-[100]">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                                <IconReceipt2 size={18} stroke={1.5} className="text-[#0078D4]" />
                                {editingRuleId ? t('rules.modalEditTitle') : t('rules.modalTitle')}
                            </h3>
                            <button onClick={() => setShowRuleModal(false)} disabled={savingRule} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                <IconX size={18} stroke={1.5} />
                            </button>
                        </div>

                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
                            {t('rules.modalHint')}
                        </p>

                        <div className="space-y-4">
                            <div className="flex flex-col gap-1.5">
                                <label className={LABEL}>{t('rules.col_ruleName')}</label>
                                <input
                                    type="text"
                                    value={ruleForm.ruleName}
                                    onChange={(e) => setRuleForm({ ...ruleForm, ruleName: e.target.value })}
                                    placeholder={t('rules.namePlaceholder')}
                                    className={INPUT}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="flex flex-col gap-1.5">
                                    <label className={LABEL}>{t('rules.col_scopeType')}</label>
                                    <select
                                        value={ruleForm.scopeType}
                                        onChange={(e) => setRuleForm({ ...ruleForm, scopeType: e.target.value as MarkupScopeType })}
                                        className={INPUT}
                                    >
                                        <option value="SERVICE_CATEGORY">{t('rules.scope_SERVICE_CATEGORY')}</option>
                                        <option value="SUBSCRIPTION">{t('rules.scope_SUBSCRIPTION')}</option>
                                    </select>
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className={LABEL}>{t('rules.col_percentage')}</label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="999.99"
                                        step="0.1"
                                        value={ruleForm.overridePercentage}
                                        onChange={(e) => setRuleForm({ ...ruleForm, overridePercentage: Number(e.target.value) })}
                                        className={INPUT}
                                        placeholder="0"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label className={LABEL}>{t('rules.col_scopeValue')}</label>
                                <input
                                    type="text"
                                    value={ruleForm.scopeValue}
                                    onChange={(e) => setRuleForm({ ...ruleForm, scopeValue: e.target.value })}
                                    placeholder={ruleForm.scopeType === 'SUBSCRIPTION' ? '00000000-0000-0000-0000-000000000000' : 'Marketplace'}
                                    className={INPUT}
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <button onClick={() => setShowRuleModal(false)} disabled={savingRule} className={BTN_NEUTRAL}>
                                {t('rules.cancel')}
                            </button>
                            <button
                                onClick={handleSaveRule}
                                disabled={savingRule || !ruleForm.ruleName.trim() || !ruleForm.scopeValue.trim()}
                                className={BTN_SMALL}
                            >
                                {savingRule
                                    ? <IconLoader2 size={16} stroke={1.5} className="animate-spin" />
                                    : <IconDeviceFloppy size={16} stroke={1.5} />}
                                {t('rules.save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
