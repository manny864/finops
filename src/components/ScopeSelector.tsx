"use client";

import React from 'react';
import { Users, AlertTriangle } from 'lucide-react';
import { useSubscription } from './SubscriptionProvider';
import { useTenant } from './TenantProvider';
import { useTranslations } from 'next-intl';

export default function ScopeSelector({ mobile = false }: { mobile?: boolean }) {
    const { selectedSubscription, setSelectedSubscription, subscriptions, loading, limitInfo } = useSubscription();
    const { selectedTenant, setSelectedTenant, tenants, isAdmin, systemRole, userScope } = useTenant();
    const tc = useTranslations('Common');

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        const [tId, sId] = val.split('|');
        if (tId !== selectedTenant.id) {
            const newT = tenants.find(t => t.id === tId);
            if (newT) {
                setSelectedTenant(newT);
                // When switching tenant, default to 'All'
                setSelectedSubscription('All');
            }
        } else {
            setSelectedSubscription(sId);
        }
    };

    // We combine Tenant ID and Subscription ID into a single value string: "tenantId|subId"
    // For 'All subscriptions', subId is 'All'
    const currentValue = `${selectedTenant.id}|${selectedSubscription}`;
    const canSwitchTenants = isAdmin || systemRole === 'SUPERADMIN' || tenants.length > 1;

    return (
        <div className={mobile
            ? "flex items-center gap-2 bg-surface dark:bg-slate-900 border border-line dark:border-slate-700 rounded-xl px-3 py-1 w-full"
            : "flex items-center gap-[9px] bg-surface border border-line-strong rounded-[10px] p-[6px_9px_6px_12px] shadow-sm min-w-0 max-w-full"}>
            <label className="text-[10px] tracking-[1px] uppercase text-grey font-bold hidden md:block">
                {tc('scope')}
            </label>
            <select
                value={currentValue}
                onChange={handleChange}
                disabled={loading}
                className={mobile
                    ? "border-0 bg-transparent font-heading font-bold text-base text-brand-deep dark:text-brand-sky cursor-pointer outline-none w-full py-2 truncate"
                    // min-w-0 + max-w-full: sin ellos el select no encoge y el
                    // pill empuja los iconos del header fuera del viewport en
                    // anchos intermedios (celular horizontal, tablet angosta).
                    : "border-0 bg-transparent font-heading font-bold text-[13px] text-brand-deep cursor-pointer outline-none w-[180px] lg:w-[280px] min-w-0 max-w-full truncate dark:bg-slate-800 dark:border-slate-700 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"}
            >
                {canSwitchTenants ? (
                    tenants.map(t => (
                        <optgroup key={t.id} label={`☁ Tenant — ${t.name}`}>
                            <option value={`${t.id}|All`}>▦ {t.name} {tc('scope_all')}</option>
                            {/* Only render the subscriptions under the currently active tenant in the tree 
                                because we only fetch subscriptions for the active tenant */}
                            {t.id === selectedTenant.id && subscriptions.map(s => (
                                <option
                                    key={s.id}
                                    value={`${t.id}|${s.id}`}
                                >
                                    　◈ {s.name}
                                </option>
                            ))}
                        </optgroup>
                    ))
                ) : (
                    <optgroup label={`☁ Tenant — ${selectedTenant.name}`}>
                        <option value={`${selectedTenant.id}|All`}>▦ {selectedTenant.name} {tc('scope_all')}</option>
                        {subscriptions.map(s => (
                            <option
                                key={s.id}
                                value={`${selectedTenant.id}|${s.id}`}
                            >
                                　◈ {s.name}
                            </option>
                        ))}
                    </optgroup>
                )}
            </select>
            {userScope && (
                <div className="ml-2 px-2 py-0.5 bg-brand-soft text-brand-deep text-[10px] font-bold rounded flex items-center gap-1">
                    <Users className="w-3 h-3" /> Team Scope: {userScope.resourceGroup || userScope.tags?.Team || 'Restringido'}
                </div>
            )}
            {limitInfo?.limitApplied && (
                <div
                    className="ml-2 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold rounded flex items-center gap-1 cursor-help"
                    title={`Tu plan ${limitInfo.tier} monitorea hasta ${limitInfo.subscriptionLimit} suscripción(es). Hay ${limitInfo.totalAvailable} visibles en Azure — actualizá tu plan para verlas todas.`}
                >
                    <AlertTriangle className="w-3 h-3" /> {limitInfo.subscriptionLimit}/{limitInfo.totalAvailable} suscripciones
                </div>
            )}
        </div>
    );
}
