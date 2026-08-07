'use client';

import { useEffect, useState } from 'react';
import { Activity, Database, HardDrive, Zap, AlertTriangle } from 'lucide-react';

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
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchData() {
            try {
                const tenantId = localStorage.getItem('tenantId') || 'demo';
                const res = await fetch(
                    `/api/intelligence/databases/cosmos-diagnostics?tenantId=${tenantId}`
                );
                if (!res.ok) throw new Error(`API error: ${res.status}`);
                const data = await res.json();
                setAccounts(data.accounts || []);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    if (loading) return <div className="p-4">Loading...</div>;
    if (error) return <div className="p-4 text-red-600">Error: {error}</div>;

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
                                        account.ruConsumption.provisioned) *
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
                            <div className="text-xs text-gray-500 mt-1">average</div>
                        </div>

                        <div className="bg-purple-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <HardDrive className="w-4 h-4" />
                                Monthly Cost
                            </div>
                            <div className="text-2xl font-bold text-purple-700">
                                ${account.monthlyCostUsd}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">USD</div>
                        </div>
                    </div>

                    <div className="border-t pt-4">
                        <h4 className="font-semibold text-sm mb-3">Databases & Containers</h4>
                        <div className="space-y-2 text-sm">
                            {account.monthlyCostUsd > 0 && (
                                <div className="text-gray-600">
                                    📊 Cosmos DB instance configured with multiple databases and
                                    containers
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}

            {accounts.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    No Cosmos DB accounts found
                </div>
            )}
        </div>
    );
}
