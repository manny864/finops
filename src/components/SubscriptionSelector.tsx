import React from 'react';
import { useSubscription } from './SubscriptionProvider';

export default function SubscriptionSelector() {
    const { selectedSubscription, setSelectedSubscription, subscriptions, loading } = useSubscription();

    return (
        <div className="flex flex-col px-2">
            <label htmlFor="sub-select" className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">
                Suscripción
            </label>
            <select
                id="sub-select"
                value={selectedSubscription}
                onChange={(e) => setSelectedSubscription(e.target.value)}
                className="text-sm font-semibold text-gray-900 bg-white dark:text-white dark:bg-gray-800 border-none outline-none focus:ring-0 cursor-pointer p-0 m-0 w-32 md:w-48 truncate"
                disabled={loading}
            >
                <option value="All" className="text-gray-900 bg-white dark:text-white dark:bg-gray-800">Todas (Tenant Scope)</option>
                {subscriptions.map(s => (
                    <option key={s.id} value={s.id} className="text-gray-900 bg-white dark:text-white dark:bg-gray-800">{s.name}</option>
                ))}
            </select>
        </div>
    );
}
