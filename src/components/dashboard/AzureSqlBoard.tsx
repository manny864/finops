'use client';

import { useEffect, useState } from 'react';
import { Database, HardDrive, Cpu, AlertCircle } from 'lucide-react';

interface SqlDatabase {
    id: string;
    name: string;
    edition: string;
    cpuPercent: number;
    usedStorageGB: number;
    maxStorageGB: number;
    vCores?: number;
    dtuUsagePercent?: number;
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
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchData() {
            try {
                const tenantId = localStorage.getItem('tenantId') || 'demo_tenant';
                const res = await fetch(
                    `/api/intelligence/databases/sql-diagnostics?tenantId=${tenantId}`
                );
                if (!res.ok) throw new Error(`API error: ${res.status}`);
                const data = await res.json();
                setServers(data.servers || []);
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
                                    server.databases.length
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
                                        {db.vCores && (
                                            <div>
                                                <div className="text-gray-600">vCores</div>
                                                <div className="font-semibold">{db.vCores}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ))}

            {servers.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    No Azure SQL servers found
                </div>
            )}
        </div>
    );
}
