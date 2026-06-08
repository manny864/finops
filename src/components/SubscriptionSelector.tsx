import React from 'react';
import { useSubscription } from './SubscriptionProvider';

export default function SubscriptionSelector() {
    const { selectedSubscription, setSelectedSubscription, subscriptions, loading } = useSubscription();

    return (
        <div className="flex flex-col px-2">
            <label htmlFor="sub-select" className="text-[10px] tracking-[1px] uppercase text-grey font-bold mb-1">
                Suscripción
            </label>
            <select
                id="sub-select"
                value={selectedSubscription}
                onChange={(e) => setSelectedSubscription(e.target.value)}
                className="border-0 bg-transparent font-heading font-bold text-[13px] text-brand-deep cursor-pointer focus:outline-none p-0 m-0 w-32 md:w-48 truncate"
                disabled={loading}
            >
                <option value="All" className="text-black bg-white dark:text-white dark:bg-gray-800">Todas (Tenant Scope)</option>
                {subscriptions.map(s => (
                    <option key={s.id} value={s.id} className="text-black bg-white dark:text-white dark:bg-gray-800">{s.name}</option>
                ))}
            </select>
        </div>
    );
}
