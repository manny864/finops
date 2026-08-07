'use client';

import { useEffect, useState } from 'react';
import { Database, HardDrive, Zap, AlertTriangle } from 'lucide-react';

interface MongoAccount {
    id: string;
    name: string;
    region: string;
    ruConsumption: {
        consumed: number;
        provisioned: number;
        throttledOperations: number;
        throttledOperationsPercent: number;
    };
    monthlyCostUsd: number;
}

interface RedisInstance {
    id: string;
    name: string;
    sku: string;
    size: string;
    region: string;
    usedMemoryMB: number;
    maxMemoryMB: number;
    cacheHitRate: number;
    evictedKeys: number;
    cpuPercent: number;
    monthlyCostUsd: number;
}

export function MongoDBBoard() {
    const [accounts, setAccounts] = useState<MongoAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchData() {
            try {
                const tenantId = localStorage.getItem('tenantId') || 'demo';
                const res = await fetch(
                    `/api/intelligence/databases/mongo-diagnostics?tenantId=${tenantId}`
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
                            <Database className="w-5 h-5 text-green-600" />
                            {account.name}
                        </h3>
                        <span className="text-sm text-gray-600">{account.region}</span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-green-50 p-4 rounded">
                            <div className="text-sm text-gray-600">RU Consumption</div>
                            <div className="text-2xl font-bold text-green-700">
                                {account.ruConsumption.consumed.toLocaleString()} /
                                {account.ruConsumption.provisioned.toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {(
                                    (account.ruConsumption.consumed /
                                        account.ruConsumption.provisioned) *
                                    100
                                ).toFixed(1)}
                                %
                            </div>
                        </div>

                        <div className="bg-yellow-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <AlertTriangle className="w-4 h-4" />
                                Throttled
                            </div>
                            <div className="text-2xl font-bold text-yellow-700">
                                {account.ruConsumption.throttledOperations}
                            </div>
                            <div className="text-xs text-gray-500">
                                {account.ruConsumption.throttledOperationsPercent.toFixed(2)}%
                            </div>
                        </div>

                        <div className="bg-blue-50 p-4 rounded">
                            <div className="text-sm text-gray-600">API Version</div>
                            <div className="text-2xl font-bold text-blue-700">4.0</div>
                        </div>

                        <div className="bg-purple-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Monthly Cost</div>
                            <div className="text-2xl font-bold text-purple-700">
                                ${account.monthlyCostUsd}
                            </div>
                        </div>
                    </div>

                    <div className="border-t pt-4">
                        <h4 className="font-semibold text-sm mb-3">Shard Distribution</h4>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                            <div className="bg-gray-50 p-2 rounded text-center">
                                <div className="text-gray-600">Shard-0</div>
                                <div className="font-semibold">32%</div>
                            </div>
                            <div className="bg-gray-50 p-2 rounded text-center">
                                <div className="text-gray-600">Shard-1</div>
                                <div className="font-semibold">35%</div>
                            </div>
                            <div className="bg-gray-50 p-2 rounded text-center">
                                <div className="text-gray-600">Shard-2</div>
                                <div className="font-semibold">33%</div>
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            {accounts.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    No MongoDB accounts found
                </div>
            )}
        </div>
    );
}

export function RedisBoard() {
    const [instances, setInstances] = useState<RedisInstance[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchData() {
            try {
                const tenantId = localStorage.getItem('tenantId') || 'demo';
                const res = await fetch(
                    `/api/intelligence/databases/redis-diagnostics?tenantId=${tenantId}`
                );
                if (!res.ok) throw new Error(`API error: ${res.status}`);
                const data = await res.json();
                setInstances(data.instances || []);
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
            {instances.map((instance) => (
                <div key={instance.id} className="border border-gray-200 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Zap className="w-5 h-5 text-red-600" />
                            {instance.name}
                        </h3>
                        <span className="text-xs text-gray-600 bg-red-50 px-2 py-1 rounded">
                            {instance.sku} {instance.size}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-red-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Memory</div>
                            <div className="text-2xl font-bold text-red-700">
                                {(instance.usedMemoryMB / 1024).toFixed(2)}GB /{' '}
                                {(instance.maxMemoryMB / 1024).toFixed(2)}GB
                            </div>
                            <div className="text-xs text-gray-500">
                                {(
                                    (instance.usedMemoryMB / instance.maxMemoryMB) *
                                    100
                                ).toFixed(1)}
                                %
                            </div>
                        </div>

                        <div className="bg-green-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Hit Rate</div>
                            <div className="text-2xl font-bold text-green-700">
                                {(instance.cacheHitRate * 100).toFixed(1)}%
                            </div>
                        </div>

                        <div className="bg-blue-50 p-4 rounded">
                            <div className="text-sm text-gray-600">CPU Usage</div>
                            <div className="text-2xl font-bold text-blue-700">
                                {instance.cpuPercent}%
                            </div>
                        </div>

                        <div className="bg-purple-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Monthly Cost</div>
                            <div className="text-2xl font-bold text-purple-700">
                                ${instance.monthlyCostUsd}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div>
                            <div className="text-sm text-gray-600 mb-2">Memory Usage</div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                    className="bg-red-600 h-2 rounded-full"
                                    style={{
                                        width: `${(instance.usedMemoryMB / instance.maxMemoryMB) * 100}%`,
                                    }}
                                />
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-600 mb-2">Evictions</div>
                            <div className="font-semibold text-yellow-700">
                                {instance.evictedKeys.toLocaleString()} keys
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            {instances.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    No Redis instances found
                </div>
            )}
        </div>
    );
}
