'use client';

import { useEffect, useState } from 'react';
import { Database, HardDrive, Cpu, TrendingUp } from 'lucide-react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { isMockTenant } from '@/lib/mockData';

interface PostgresServer {
    id: string;
    name: string;
    region: string;
    version: string;
    tier: string;
    cpuPercent: number;
    memoryPercent: number;
    storagePercent: number;
    usedStorageGB: number;
    maxStorageGB: number;
    activeConnections: number;
    maxConnections: number;
    cacheHitRatio: number;
    monthlyCostUsd: number;
}

interface MysqlServer {
    id: string;
    name: string;
    region: string;
    version: string | null;
    tier: string;
    cpuPercent: number | null;
    memoryPercent: number | null;
    storagePercent: number | null;
    usedStorageGB: number | null;
    maxStorageGB: number | null;
    activeConnections: number | null;
    maxConnections: number | null;
    queriesPerSecond: number | null;
    innodbBufferPoolHitRate: number | null;
    monthlyCostUsd: number;
}

const unavailableTelemetry = 'No disponible';

function formatPercent(value: number | null, decimals = 0): string {
    return value === null ? unavailableTelemetry : `${value.toFixed(decimals)}%`;
}

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

export function PostgresBoard() {
    const [servers, setServers] = useState<PostgresServer[]>([]);
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
            setServers([]);
            setEmptyMessage(null);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const response = await fetchDiagnostics(
                    '/api/intelligence/databases/postgres-diagnostics',
                    selectedTenant.id,
                    isMockTenant(selectedTenant.id),
                    instance,
                    msalAccounts,
                );
                if (cancelled) return;
                if (!response.ok) {
                    setServers([]);
                    setEmptyMessage(
                        response.data?.message ||
                            response.data?.error ||
                            'No se encontraron servidores PostgreSQL en el tenant.',
                    );
                    return;
                }
                const json = response.data || {};
                setServers(json.servers || []);
                setEmptyMessage(json.message || null);
            } catch {
                if (!cancelled) {
                    setServers([]);
                    setEmptyMessage('No se encontraron servidores PostgreSQL en el tenant.');
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
            {servers.map((server) => (
                <div key={server.id} className="border border-gray-200 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Database className="w-5 h-5 text-blue-600" />
                            {server.name}
                        </h3>
                        <span className="text-xs text-gray-600 bg-blue-50 px-2 py-1 rounded">
                            PostgreSQL {server.version}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-blue-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <Cpu className="w-4 h-4" />
                                CPU
                            </div>
                            <div className="text-2xl font-bold text-blue-700">{server.cpuPercent}%</div>
                        </div>

                        <div className="bg-green-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <HardDrive className="w-4 h-4" />
                                Storage
                            </div>
                            <div className="text-2xl font-bold text-green-700">
                                {server.storagePercent.toFixed(1)}%
                            </div>
                            <div className="text-xs text-gray-500">
                                {server.usedStorageGB}GB / {server.maxStorageGB}GB
                            </div>
                        </div>

                        <div className="bg-purple-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Connections</div>
                            <div className="text-2xl font-bold text-purple-700">
                                {server.activeConnections}
                            </div>
                            <div className="text-xs text-gray-500">
                                of {server.maxConnections} max
                            </div>
                        </div>

                        <div className="bg-yellow-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <TrendingUp className="w-4 h-4" />
                                Cache Hit
                            </div>
                            <div className="text-2xl font-bold text-yellow-700">
                                {(server.cacheHitRatio * 100).toFixed(1)}%
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div>
                            <div className="text-sm text-gray-600 mb-2">Memory Usage</div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                    className="bg-blue-600 h-2 rounded-full"
                                    style={{ width: `${server.memoryPercent}%` }}
                                />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">{server.memoryPercent}%</div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm text-gray-600">Monthly Cost</div>
                            <div className="text-2xl font-bold text-gray-900">
                                ${server.monthlyCostUsd}
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            {servers.length === 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white px-8 py-12 text-center shadow-sm">
                    <p className="text-lg font-semibold text-gray-900">Sin servidores PostgreSQL</p>
                    <p className="mt-2 text-gray-500">
                        {emptyMessage || 'No se encontraron servidores PostgreSQL en el tenant.'}
                    </p>
                </div>
            )}
        </div>
    );
}

export function MysqlBoard() {
    const [servers, setServers] = useState<MysqlServer[]>([]);
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
            setServers([]);
            setEmptyMessage(null);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const response = await fetchDiagnostics(
                    '/api/intelligence/databases/mysql-diagnostics',
                    selectedTenant.id,
                    isMockTenant(selectedTenant.id),
                    instance,
                    msalAccounts,
                );
                if (cancelled) return;
                if (!response.ok) {
                    setServers([]);
                    setEmptyMessage(
                        response.data?.message ||
                            response.data?.error ||
                            'No se encontraron servidores MySQL en el tenant.',
                    );
                    return;
                }
                const json = response.data || {};
                setServers(json.servers || []);
                setEmptyMessage(json.message || null);
            } catch {
                if (!cancelled) {
                    setServers([]);
                    setEmptyMessage('No se encontraron servidores MySQL en el tenant.');
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
            {servers.map((server) => (
                <div key={server.id} className="border border-gray-200 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Database className="w-5 h-5 text-orange-600" />
                            {server.name}
                        </h3>
                        <span className="text-xs text-gray-600 bg-orange-50 px-2 py-1 rounded">
                            MySQL {server.version ?? unavailableTelemetry}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-orange-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <Cpu className="w-4 h-4" />
                                CPU
                            </div>
                            <div className="text-2xl font-bold text-orange-700">{formatPercent(server.cpuPercent)}</div>
                        </div>

                        <div className="bg-green-50 p-4 rounded">
                            <div className="text-sm text-gray-600">QPS</div>
                            <div className="text-2xl font-bold text-green-700">
                                {server.queriesPerSecond === null
                                    ? unavailableTelemetry
                                    : server.queriesPerSecond.toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500">queries/sec</div>
                        </div>

                        <div className="bg-purple-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <TrendingUp className="w-4 h-4" />
                                Buffer Hit
                            </div>
                            <div className="text-2xl font-bold text-purple-700">
                                {server.innodbBufferPoolHitRate === null
                                    ? unavailableTelemetry
                                    : formatPercent(server.innodbBufferPoolHitRate * 100, 1)}
                            </div>
                        </div>

                        <div className="bg-blue-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Monthly Cost</div>
                            <div className="text-2xl font-bold text-blue-700">
                                ${server.monthlyCostUsd}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div>
                            <div className="text-sm text-gray-600 mb-2">Storage Usage</div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                {server.storagePercent !== null && (
                                    <div
                                        className="bg-orange-600 h-2 rounded-full"
                                        style={{ width: `${server.storagePercent}%` }}
                                    />
                                )}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {server.usedStorageGB === null || server.maxStorageGB === null
                                    ? unavailableTelemetry
                                    : `${server.usedStorageGB}GB / ${server.maxStorageGB}GB`}
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-600 mb-2">Connections</div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                {server.activeConnections !== null && server.maxConnections !== null && (
                                    <div
                                        className="bg-blue-600 h-2 rounded-full"
                                        style={{
                                            width: `${(server.activeConnections / Math.max(server.maxConnections, 1)) * 100}%`,
                                        }}
                                    />
                                )}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {server.activeConnections === null || server.maxConnections === null
                                    ? unavailableTelemetry
                                    : `${server.activeConnections} / ${server.maxConnections}`}
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            {servers.length === 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white px-8 py-12 text-center shadow-sm">
                    <p className="text-lg font-semibold text-gray-900">Sin servidores MySQL</p>
                    <p className="mt-2 text-gray-500">
                        {emptyMessage || 'No se encontraron servidores MySQL en el tenant.'}
                    </p>
                </div>
            )}
        </div>
    );
}
