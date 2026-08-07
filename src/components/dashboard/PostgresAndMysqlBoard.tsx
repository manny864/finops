'use client';

import { useEffect, useState } from 'react';
import { Database, HardDrive, Cpu, TrendingUp } from 'lucide-react';

interface PostgresServer {
    id: string;
    name: string;
    region: string;
    version: string;
    tier: string;
    vCores: number;
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
    version: string;
    tier: string;
    vCores: number;
    cpuPercent: number;
    memoryPercent: number;
    storagePercent: number;
    usedStorageGB: number;
    maxStorageGB: number;
    activeConnections: number;
    maxConnections: number;
    queriesPerSecond: number;
    innodbBufferPoolHitRate: number;
    monthlyCostUsd: number;
}

export function PostgresBoard() {
    const [servers, setServers] = useState<PostgresServer[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchData() {
            try {
                const tenantId = localStorage.getItem('tenantId') || 'demo';
                const res = await fetch(
                    `/api/intelligence/databases/postgres-diagnostics?tenantId=${tenantId}`
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
                <div className="text-center py-12 text-gray-500">
                    No PostgreSQL servers found
                </div>
            )}
        </div>
    );
}

export function MysqlBoard() {
    const [servers, setServers] = useState<MysqlServer[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchData() {
            try {
                const tenantId = localStorage.getItem('tenantId') || 'demo';
                const res = await fetch(
                    `/api/intelligence/databases/mysql-diagnostics?tenantId=${tenantId}`
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
                            <Database className="w-5 h-5 text-orange-600" />
                            {server.name}
                        </h3>
                        <span className="text-xs text-gray-600 bg-orange-50 px-2 py-1 rounded">
                            MySQL {server.version}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-orange-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <Cpu className="w-4 h-4" />
                                CPU
                            </div>
                            <div className="text-2xl font-bold text-orange-700">{server.cpuPercent}%</div>
                        </div>

                        <div className="bg-green-50 p-4 rounded">
                            <div className="text-sm text-gray-600">QPS</div>
                            <div className="text-2xl font-bold text-green-700">
                                {server.queriesPerSecond.toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500">queries/sec</div>
                        </div>

                        <div className="bg-purple-50 p-4 rounded">
                            <div className="text-sm text-gray-600 flex items-center gap-1">
                                <TrendingUp className="w-4 h-4" />
                                Buffer Hit
                            </div>
                            <div className="text-2xl font-bold text-purple-700">
                                {(server.innodbBufferPoolHitRate * 100).toFixed(1)}%
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
                                <div
                                    className="bg-orange-600 h-2 rounded-full"
                                    style={{ width: `${server.storagePercent}%` }}
                                />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {server.usedStorageGB}GB / {server.maxStorageGB}GB
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-600 mb-2">Connections</div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                    className="bg-blue-600 h-2 rounded-full"
                                    style={{
                                        width: `${(server.activeConnections / server.maxConnections) * 100}%`,
                                    }}
                                />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {server.activeConnections} / {server.maxConnections}
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            {servers.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    No MySQL servers found
                </div>
            )}
        </div>
    );
}
