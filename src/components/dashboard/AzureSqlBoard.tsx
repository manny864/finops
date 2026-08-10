'use client';

import { useEffect, useState } from 'react';
import { Database, Cpu, AlertCircle } from 'lucide-react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { isMockTenant } from '@/lib/mockData';

interface SqlDatabase {
    id: string;
    name: string;
    edition: string;
    cpuPercent: number;
    usedStorageGB: number;
    maxStorageGB: number;
    vCores?: number;
}

interface SqlServer {
    id: string;
    name: string;
    region: string;
    databases: SqlDatabase[];
    monthlyCostUsd: number;
}

export function AzureSqlBoard() {
    const [servers, setServers] = useState<SqlServer[]>([]);
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

        async function fetchData() {
            try {
                const tenantId = selectedTenant.id;
                const headers: HeadersInit = {};
                if (!isMockTenant(tenantId) && msalAccounts.length > 0) {
                    const idToken = await getFreshIdToken(instance, msalAccounts[0]);
                    headers.Authorization = 'Bearer ' + idToken;
                }
                const res = await fetch(`/api/intelligence/databases/sql-diagnostics?tenantId=${tenantId}`, {
                    headers,
                });
                const data = await res.json();
                if (cancelled) return;
                if (!res.ok) {
                    setServers([]);
                    setEmptyMessage(data?.message || data?.error || 'No se encontraron servidores Azure SQL en el tenant.');
                    return;
                }
                setServers(data.servers || []);
                setEmptyMessage(data.message || null);
            } catch (err) {
                if (!cancelled) {
                    setServers([]);
                    setEmptyMessage('No se encontraron servidores Azure SQL en el tenant.');
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
            {servers.map((server) => (
                <div key={server.id} className="border border-gray-200 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Database className="w-5 h-5 text-[#0054A6]" />
                            {server.name}
                        </h3>
                        <span className="text-sm text-gray-600">{server.region}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-blue-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <Cpu className="w-4 h-4" />
                                Monthly Cost
                            </div>
                            <div className="text-2xl font-bold text-blue-700">
                                ${server.monthlyCostUsd}
                            </div>
                        </div>
                        <div className="bg-green-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Databases</div>
                            <div className="text-2xl font-bold text-green-700">
                                {server.databases.length}
                            </div>
                        </div>
                        <div className="bg-purple-50 p-4 rounded">
                            <div className="text-sm text-gray-600">Avg CPU Usage</div>
                            <div className="text-2xl font-bold text-purple-700">
                                {(
                                    server.databases.reduce((sum, db) => sum + db.cpuPercent, 0) /
                                    Math.max(server.databases.length, 1)
                                ).toFixed(1)}
                                %
                            </div>
                        </div>
                    </div>

                    <div className="border-t pt-4">
                        <h4 className="font-semibold text-sm mb-3">Databases</h4>
                        <div className="space-y-3">
                            {server.databases.map((db) => (
                                <div key={db.id} className="bg-gray-50 p-3 rounded border border-gray-100">
                                    <div className="flex items-center justify-between mb-2">
                                        <div>
                                            <div className="font-medium text-sm">{db.name}</div>
                                            <div className="text-xs text-gray-500">{db.edition}</div>
                                        </div>
                                        {db.cpuPercent > 80 && (
                                            <AlertCircle className="w-4 h-4 text-red-600" />
                                        )}
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                        <div>
                                            <div className="text-gray-600">CPU</div>
                                            <div className="font-semibold">{db.cpuPercent}%</div>
                                        </div>
                                        <div>
                                            <div className="text-gray-600">Storage</div>
                                            <div className="font-semibold">
                                                {db.usedStorageGB}GB / {db.maxStorageGB}GB
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-gray-600">vCores</div>
                                            <div className="font-semibold">{db.vCores || 0}</div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ))}

            {servers.length === 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white px-8 py-12 text-center shadow-sm">
                    <p className="text-lg font-semibold text-gray-900">Sin servidores Azure SQL</p>
                    <p className="mt-2 text-gray-500">
                        {emptyMessage || 'No se encontraron servidores Azure SQL en el tenant.'}
                    </p>
                </div>
            )}
        </div>
    );
}
