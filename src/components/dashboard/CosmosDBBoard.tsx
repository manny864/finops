'use client';

import { useEffect, useState } from 'react';
import { Database, HardDrive, Zap, AlertTriangle } from 'lucide-react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { isMockTenant } from '@/lib/mockData';

interface CosmosAccount {
    id: string;
    name: string;
    region: string;
    ruConsumption: {
        provisioned: number;
        consumed: number;
        throttled429Count: number;
        avgLatencyMs: number;
    };
    monthlyCostUsd: number;
}

export function CosmosDBBoard() {
    const [accounts, setAccounts] = useState<CosmosAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
    const { selectedTenant } = useTenant();
    const { instance, accounts: msalAccounts } = useMsal();

    useEffect(() => {
        if (
            !selectedTenant?.id ||
            selectedTenant.id === 'default' ||
            (msalAccounts.length === 0 && !isMockTenant(selectedTenant.id))
        ) {
            setLoading(false);
            setAccounts([]);
            setEmptyMessage(null);
            return;
        }

        let cancelled = false;

        async function fetchData() {
            try {
                const tenantId = selectedTenant.id;
                const headers: HeadersInit = {};
                if (!isMockTenant(tenantId) && msalAccounts.length > 0) {
                    const idToken = await getFreshIdToken(instance, msalAccounts[0]);
                    headers.Authorization = 'Bearer ' + idToken;
                }
                const res = await fetch(`/api/intelligence/databases/cosmos-diagnostics?tenantId=${tenantId}`, {
                    headers,
                });
                const data = await res.json();
                if (cancelled) return;
                if (!res.ok) {
                    setAccounts([]);
                    setEmptyMessage(data?.message || data?.error || 'No se encontraron cuentas Cosmos DB en el tenant.');
                    return;
                }
                setAccounts(data.accounts || []);
                setEmptyMessage(data.message || null);
            } catch (err) {
                if (!cancelled) {
                    setAccounts([]);
                    setEmptyMessage('No se encontraron cuentas Cosmos DB en el tenant.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        fetchData();
        return () => {
            cancelled = true;
        };
    }, [selectedTenant?.id, msalAccounts.length, instance]);

    if (loading) return <div className="p-4">Loading...</div>;
    return (
        <div className="space-y-6">
            {accounts.map((account) => (
                <div key={account.id} className="border border-gray-200 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Database className="w-5 h-5 text-[#0054A6]" />
                            {account.name}
                        </h3>
                        <span className="text-sm text-gray-600">{account.region}</span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-blue-50 p-4 rounded">
                            <div className="text-sm text-gray-600">RU Consumption</div>
                            <div className="text-2xl font-bold">
                                {account.ruConsumption.consumed.toLocaleString()} /
                                {account.ruConsumption.provisioned.toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {(
                                    (account.ruConsumption.consumed /
                                        Math.max(account.ruConsumption.provisioned, 1)) *
                                    100
                                ).toFixed(1)}
                                % utilization
                            </div>
                        </div>

                        <div className="bg-yellow-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <AlertTriangle className="w-4 h-4" />
                                Throttled (429)
                            </div>
                            <div className="text-2xl font-bold text-yellow-700">
                                {account.ruConsumption.throttled429Count}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">last 24h</div>
                        </div>

                        <div className="bg-green-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <Zap className="w-4 h-4" />
                                Latency
                            </div>
                            <div className="text-2xl font-bold text-green-700">
                                {account.ruConsumption.avgLatencyMs}ms
                            </div>
                        </div>

                        <div className="bg-purple-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <HardDrive className="w-4 h-4" />
                                Monthly Cost
                            </div>
                            <div className="text-2xl font-bold text-purple-700">
                                ${account.monthlyCostUsd}
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            {accounts.length === 0 && (
                <div className="text-center py-12">
                    <p className="text-lg font-semibold text-gray-700">Sin cuentas Cosmos DB</p>
                    <p className="text-gray-500 mt-1">
                        {emptyMessage || 'No se encontraron cuentas Cosmos DB en el tenant.'}
                    </p>
                </div>
            )}
        </div>
    );
}
