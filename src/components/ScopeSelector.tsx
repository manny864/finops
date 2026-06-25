"use client";

import React from 'react';
import { useSubscription } from './SubscriptionProvider';
import { useTenant } from './TenantProvider';
import { useTranslations } from 'next-intl';

export default function ScopeSelector() {
    const { selectedSubscription, setSelectedSubscription, subscriptions, loading } = useSubscription();
    const { selectedTenant, setSelectedTenant, tenants, isAdmin, userScope } = useTenant();
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

    return (
        <div className="flex items-center gap-[9px] bg-surface border border-line-strong rounded-[10px] p-[6px_9px_6px_12px] shadow-sm">
            <label className="text-[10px] tracking-[1px] uppercase text-grey font-bold hidden md:block">
                {tc('scope')}
            </label>
            <select
                value={currentValue}
                onChange={handleChange}
                disabled={loading}
                className="border-0 bg-transparent font-heading font-bold text-[13px] text-brand-deep cursor-pointer outline-none w-[180px] md:w-[280px] truncate dark:bg-slate-800 dark:border-slate-700 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            >
                {isAdmin ? (
                    tenants.map(t => (
                        <optgroup key={t.id} label={`☁ Tenant — ${t.name}`}>
                            <option value={`${t.id}|All`}>▦ {t.name} (todo)</option>
                            {/* Only render the subscriptions under the currently active tenant in the tree 
                                because we only fetch subscriptions for the active tenant */}
                            {t.id === selectedTenant.id && subscriptions.map(s => (
                                <option key={s.id} value={`${t.id}|${s.id}`}>
                                    　◈ {s.name}
                                </option>
                            ))}
                        </optgroup>
                    ))
                ) : (
                    <optgroup label={`☁ Tenant — ${selectedTenant.name}`}>
                        <option value={`${selectedTenant.id}|All`}>▦ {selectedTenant.name} (todo)</option>
                        {subscriptions.map(s => (
                            <option key={s.id} value={`${selectedTenant.id}|${s.id}`}>
                                　◈ {s.name}
                            </option>
                        ))}
                    </optgroup>
                )}
            </select>
            {userScope && (
                <div className="ml-2 px-2 py-0.5 bg-brand-soft text-brand-deep text-[10px] font-bold rounded flex items-center gap-1">
                    👥 Team Scope: {userScope.resourceGroup || userScope.tags?.Team || 'Restringido'}
                </div>
            )}
        </div>
    );
}
