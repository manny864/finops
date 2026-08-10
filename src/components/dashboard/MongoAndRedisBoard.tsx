'use client';

import { useEffect, useState } from 'react';
import { Database, Zap, AlertTriangle } from 'lucide-react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { isMockTenant } from '@/lib/mockData';

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
    usedMemoryMB: number | null;
    maxMemoryMB: number | null;
    cacheHitRate: number | null;
    evictedKeys: number | null;
    cpuPercent: number | null;
    monthlyCostUsd: number;
}

const unavailableTelemetry = 'No disponible';

async function fetchDiagnostics(
    url: string,
    tenantId: string,
    isMock: boolean,
    instance: any,
    msalAccounts: any[],
) {
    const headers: HeadersInit = {};
    if (!isMock && msalAccounts.length > 0) {
        const idToken = await getFreshIdToken(instance, msalAccounts[0]);
        headers.Authorization = 'Bearer ' + idToken;
    }
    const res = await fetch(`${url}?tenantId=${tenantId}`, { headers });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, data };
}

export function MongoDBBoard() {
    const [accounts, setAccounts] = useState<MongoAccount[]>([]);
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
        (async () => {
            try {
                const response = await fetchDiagnostics(
                    '/api/intelligence/databases/mongo-diagnostics',
                    selectedTenant.id,
                    isMockTenant(selectedTenant.id),
                    instance,
                    msalAccounts,
                );
                if (cancelled) return;
                if (!response.ok) {
                    setAccounts([]);
                    setEmptyMessage(
                        response.data?.message ||
                            response.data?.error ||
                            'No se encontraron cuentas MongoDB en el tenant.',
                    );
                    return;
                }
                const json = response.data || {};
                setAccounts(json.accounts || []);
                setEmptyMessage(json.message || null);
            } catch {
                if (!cancelled) {
                    setAccounts([]);
                    setEmptyMessage('No se encontraron cuentas MongoDB en el tenant.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

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
                </div>
            ))}

            {accounts.length === 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white px-8 py-12 text-center shadow-sm">
                    <p className="text-lg font-semibold text-gray-900">Sin cuentas MongoDB</p>
                    <p className="mt-2 text-gray-500">
                        {emptyMessage || 'No se encontraron cuentas MongoDB en el tenant.'}
                    </p>
                </div>
            )}
        </div>
    );
}

export function RedisBoard() {
    const [instances, setInstances] = useState<RedisInstance[]>([]);
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
            setInstances([]);
            setEmptyMessage(null);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const response = await fetchDiagnostics(
                    '/api/intelligence/databases/redis-diagnostics',
                    selectedTenant.id,
                    isMockTenant(selectedTenant.id),
                    instance,
                    msalAccounts,
                );
                if (cancelled) return;
                if (!response.ok) {
                    setInstances([]);
                    setEmptyMessage(
                        response.data?.message ||
                            response.data?.error ||
                            'No se encontraron instancias de Azure Cache for Redis en el tenant.',
                    );
                    return;
                }
                const json = response.data || {};
                setInstances(json.instances || []);
                setEmptyMessage(json.message || null);
            } catch {
                if (!cancelled) {
                    setInstances([]);
                    setEmptyMessage('No se encontraron instancias de Azure Cache for Redis en el tenant.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [selectedTenant?.id, msalAccounts.length, instance]);

    if (loading) return <div className="p-4">Loading...</div>;
    return (
        <div className="space-y-6">
            {instances.map((instanceData) => (
                <div key={instanceData.id} className="border border-gray-200 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Zap className="w-5 h-5 text-red-600" />
                            {instanceData.name}
                        </h3>
                        <span className="text-xs text-gray-600 bg-red-50 px-2 py-1 rounded">
                            {instanceData.sku} {instanceData.size}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-red-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Memory</div>
                            <div className="text-2xl font-bold text-red-700">
                                {instanceData.usedMemoryMB === null || instanceData.maxMemoryMB === null
                                    ? unavailableTelemetry
                                    : `${(instanceData.usedMemoryMB / 1024).toFixed(2)}GB / ${(instanceData.maxMemoryMB / 1024).toFixed(2)}GB`}
                            </div>
                        </div>
                        <div className="bg-green-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Hit Rate</div>
                            <div className="text-2xl font-bold text-green-700">
                                {instanceData.cacheHitRate === null
                                    ? unavailableTelemetry
                                    : `${(instanceData.cacheHitRate * 100).toFixed(1)}%`}
                            </div>
                        </div>
                        <div className="bg-blue-50 p-4 rounded">
                            <div className="text-sm text-gray-600">CPU Usage</div>
                            <div className="text-2xl font-bold text-blue-700">
                                {instanceData.cpuPercent === null
                                    ? unavailableTelemetry
                                    : `${instanceData.cpuPercent}%`}
                            </div>
                        </div>
                        <div className="bg-purple-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Monthly Cost</div>
                            <div className="text-2xl font-bold text-purple-700">
                                ${instanceData.monthlyCostUsd}
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            {instances.length === 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white px-8 py-12 text-center shadow-sm">
                    <p className="text-lg font-semibold text-gray-900">Sin instancias Azure Cache for Redis</p>
                    <p className="mt-2 text-gray-500">
                        {emptyMessage || 'No se encontraron instancias de Azure Cache for Redis en el tenant.'}
                    </p>
                </div>
            )}
        </div>
    );
}
