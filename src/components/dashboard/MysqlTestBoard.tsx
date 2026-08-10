'use client';

import { useEffect, useState } from 'react';
import { Database, Zap, Activity, Cpu, Server, HardDrive, Percent, LogOut, Key, AlertCircle, RefreshCw, DollarSign, Share2, Layers, Network } from 'lucide-react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { isMockTenant } from '@/lib/mockData';
import { useCurrency } from '@/components/CurrencyProvider';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    Legend
} from 'recharts';

interface MetricPoint {
    timestamp: string;
    cpu_percent: number;
    memory_percent: number;
    active_connections: number;
    connections_failed: number;
    storage_percent: number;
    io_consumption_percent: number;
    network_bytes_ingress: number;
    network_bytes_egress: number;
}

interface MysqlInstanceMetrics {
    id: string;
    name: string;
    region: string;
    sku: string;
    monthlyCostUsd: number;
    history: MetricPoint[];
}

// Formateadores de datos
const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
};

export default function MysqlTestBoard() {
    const { selectedTenant } = useTenant();
    const { instance, accounts: msalAccounts } = useMsal();
    const { format } = useCurrency();
    const [instances, setInstances] = useState<MysqlInstanceMetrics[]>([]);
    const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const activeInstance = instances.find(inst => inst.id === selectedInstanceId) || instances[0];

    const fetchMetrics = async (bustCache = false) => {
        if (!selectedTenant?.id || selectedTenant.id === 'default') {
            setLoading(false);
            return;
        }

        if (bustCache) setRefreshing(true);
        else setLoading(true);

        setErrorMsg(null);

        try {
            const headers: HeadersInit = {};
            const isMock = isMockTenant(selectedTenant.id);
            if (!isMock && msalAccounts.length > 0) {
                const idToken = await getFreshIdToken(instance, msalAccounts[0]);
                headers.Authorization = 'Bearer ' + idToken;
            }

            const bustParam = bustCache ? '&bust=1' : '';
            const res = await fetch(`/api/intelligence/databases/mysql-metrics?tenantId=${selectedTenant.id}${bustParam}`, { headers });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || data.error || 'Error desconocido al consultar métricas MySQL');
            }

            if (data.instances && data.instances.length > 0) {
                setInstances(data.instances);
                if (!selectedInstanceId || !data.instances.some((inst: any) => inst.id === selectedInstanceId)) {
                    setSelectedInstanceId(data.instances[0].id);
                }
            } else {
                setInstances([]);
                setErrorMsg(data.message || 'No se encontraron instancias de Azure Database for MySQL.');
            }
        } catch (err: any) {
            console.error('Error fetching MySQL metrics:', err);
            setErrorMsg(err.message || 'Error al conectar con la API de telemetría MySQL.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchMetrics();
    }, [selectedTenant?.id]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
                <div className="w-10 h-10 border-4 border-[#0054A6]/20 border-t-[#0054A6] rounded-full animate-spin"></div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Consultando telemetría MySQL de Azure Monitor...</p>
            </div>
        );
    }

    if (errorMsg && instances.length === 0) {
        return (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-2xl p-6 text-center max-w-xl mx-auto my-12 shadow-sm">
                <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">Error de Telemetría</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">{errorMsg}</p>
                <button
                    onClick={() => fetchMetrics(true)}
                    className="px-5 py-2.5 bg-[#0054A6] hover:bg-[#004080] text-white text-sm font-medium rounded-xl transition-all shadow-sm"
                >
                    Reintentar Conexión
                </button>
            </div>
        );
    }

    if (!activeInstance) {
        return (
            <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center max-w-xl mx-auto my-12">
                <Database className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">Sin Recursos MySQL</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">No se encontraron bases de datos Azure Database for MySQL configuradas para este tenant.</p>
            </div>
        );
    }

    const history = activeInstance.history || [];

    // Calcular promedios matemáticos seguros
    const count = history.length || 1;
    const avgCpu = history.reduce((sum, p) => sum + (p.cpu_percent || 0), 0) / count;
    const avgMemory = history.reduce((sum, p) => sum + (p.memory_percent || 0), 0) / count;
    const avgConnections = history.reduce((sum, p) => sum + (p.active_connections || 0), 0) / count;
    const avgStorage = history.reduce((sum, p) => sum + (p.storage_percent || 0), 0) / count;

    return (
        <div className="space-y-6">
            {/* Header del Board */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl text-emerald-600">
                        <Database className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            MySQL Telemetry Board <span className="text-xs px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 rounded font-normal">Real-time</span>
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Gráficas de área agregadas por promedio (Average) en intervalos por hora (últimas 24h)
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-auto">
                    {instances.length > 1 && (
                        <select
                            value={selectedInstanceId}
                            onChange={(e) => setSelectedInstanceId(e.target.value)}
                            className="flex-1 sm:flex-none bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
                        >
                            {instances.map(inst => (
                                <option key={inst.id} value={inst.id}>{inst.name}</option>
                            ))}
                        </select>
                    )}

                    <span className="text-xs font-semibold text-slate-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 px-3 py-2 rounded-lg border border-emerald-100 dark:border-emerald-950">
                        {activeInstance.sku}
                    </span>

                    <button
                        onClick={() => fetchMetrics(true)}
                        disabled={refreshing}
                        className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                        title="Actualizar datos"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {history.length === 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-xl p-4 text-amber-800 dark:text-amber-300 text-sm flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 text-amber-500" />
                    <span>
                        El recurso de Azure Database for MySQL se ha detectado correctamente, pero no hay datos de telemetría reales disponibles en Azure Monitor en las últimas 24 horas. Los gráficos se muestran vacíos debido al cumplimiento estricto de no mocks en producción.
                    </span>
                </div>
            )}

            {/* Tarjetas de Resumen de Métricas */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 p-5 rounded-xl border border-blue-100/50 dark:border-blue-900/30 shadow-sm">
                    <div className="flex justify-between items-start">
                        <span className="text-sm font-medium text-blue-700 dark:text-blue-400">Promedio CPU</span>
                        <Cpu className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="mt-2 text-3xl font-bold text-slate-800 dark:text-slate-100">
                        {avgCpu.toFixed(2)}%
                    </div>
                    <p className="text-xs text-blue-600 dark:text-blue-400/80 mt-1">Uso de CPU del Servidor</p>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 p-5 rounded-xl border border-purple-100/50 dark:border-purple-900/30 shadow-sm">
                    <div className="flex justify-between items-start">
                        <span className="text-sm font-medium text-purple-700 dark:text-purple-400">Promedio Memoria</span>
                        <HardDrive className="w-5 h-5 text-purple-600" />
                    </div>
                    <div className="mt-2 text-3xl font-bold text-slate-800 dark:text-slate-100">
                        {avgMemory.toFixed(2)}%
                    </div>
                    <p className="text-xs text-purple-600 dark:text-purple-400/80 mt-1">Porcentaje de memoria RAM</p>
                </div>

                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 p-5 rounded-xl border border-emerald-100/50 dark:border-emerald-900/30 shadow-sm">
                    <div className="flex justify-between items-start">
                        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Conexiones</span>
                        <Activity className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="mt-2 text-3xl font-bold text-slate-800 dark:text-slate-100">
                        {avgConnections.toFixed(0)}
                    </div>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400/80 mt-1">Conexiones activas promedio</p>
                </div>

                <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 p-5 rounded-xl border border-amber-100/50 dark:border-amber-900/30 shadow-sm">
                    <div className="flex justify-between items-start">
                        <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Uso Storage</span>
                        <Layers className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="mt-2 text-3xl font-bold text-slate-800 dark:text-slate-100">
                        {avgStorage.toFixed(2)}%
                    </div>
                    <p className="text-xs text-amber-600 dark:text-amber-400/80 mt-1">Porcentaje de disco consumido</p>
                </div>

                <div className="bg-gradient-to-br from-rose-50 to-red-50 dark:from-rose-950/20 dark:to-red-950/20 p-5 rounded-xl border border-rose-100/50 dark:border-rose-900/30 shadow-sm">
                    <div className="flex justify-between items-start">
                        <span className="text-sm font-medium text-rose-700 dark:text-rose-400">Costo Mensual</span>
                        <DollarSign className="w-5 h-5 text-rose-600" />
                    </div>
                    <div className="mt-2 text-3xl font-bold text-slate-800 dark:text-slate-100">
                        {format(activeInstance.monthlyCostUsd)}
                    </div>
                    <p className="text-xs text-rose-600 dark:text-rose-400/80 mt-1">Facturación acumulada</p>
                </div>
            </div>

            {/* Grid de Gráficos de Área */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {/* 1. CPU Usage */}
                <MetricChartCard
                    title="1. CPU Usage"
                    dataKey="cpu_percent"
                    data={history}
                    color="#3B82F6"
                    unit="%"
                    description="Average CPU utilization of the MySQL Server instance."
                />

                {/* 2. Memory Percent */}
                <MetricChartCard
                    title="2. Memory Usage"
                    dataKey="memory_percent"
                    data={history}
                    color="#8B5CF6"
                    unit="%"
                    description="Memory percentage consumption of the database engine."
                />

                {/* 3. Active Connections */}
                <MetricChartCard
                    title="3. Active Connections"
                    dataKey="active_connections"
                    data={history}
                    color="#10B981"
                    unit=""
                    description="The number of active sessions connected to the server."
                />

                {/* 4. Failed Connections */}
                <MetricChartCard
                    title="4. Failed Connections"
                    dataKey="connections_failed"
                    data={history}
                    color="#EF4444"
                    unit=""
                    description="The count of aborted or failed connection attempts."
                />

                {/* 5. Storage Percentage */}
                <MetricChartCard
                    title="5. Storage Utilization"
                    dataKey="storage_percent"
                    data={history}
                    color="#F59E0B"
                    unit="%"
                    description="Percentage of disk storage consumed relative to provisioning limits."
                />

                {/* 6. IO Consumption Percent */}
                <MetricChartCard
                    title="6. I/O Utilization"
                    dataKey="io_consumption_percent"
                    data={history}
                    color="#06B6D4"
                    unit="%"
                    description="Input/Output operations consumption percent."
                />

                {/* 7. Network Ingress & Egress */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex justify-between items-start">
                            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">7. Network Throughput</h4>
                            <Network className="w-4 h-4 text-slate-400" />
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400/80 mt-1">
                            Ingress and Egress database traffic comparison.
                        </p>
                    </div>
                    <div className="h-48 w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorIngress" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/>
                                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                                    </linearGradient>
                                    <linearGradient id="colorEgress" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                                        <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(200,200,200,0.15)"/>
                                <XAxis dataKey="timestamp" tickLine={false} axisLine={false} style={{ fontSize: '10px', fill: '#64748B' }} />
                                <YAxis tickLine={false} axisLine={false} tickFormatter={(val) => formatBytes(val)} style={{ fontSize: '10px', fill: '#64748B' }} />
                                <RechartsTooltip
                                    contentStyle={{ backgroundColor: 'rgba(30, 41, 59, 0.95)', border: 'none', borderRadius: '8px' }}
                                    labelStyle={{ color: '#F1F5F9', fontWeight: '600', fontSize: '11px' }}
                                    itemStyle={{ color: '#94A3B8', fontSize: '11px' }}
                                    formatter={(value: any, name: any) => [formatBytes(value), name === 'network_bytes_ingress' ? 'Ingress' : 'Egress']}
                                />
                                <Legend iconSize={8} wrapperStyle={{ fontSize: '11px', bottom: -10 }} />
                                <Area type="monotone" name="network_bytes_ingress" dataKey="network_bytes_ingress" stroke="#3B82F6" strokeWidth={2} fillOpacity={1} fill="url(#colorIngress)" />
                                <Area type="monotone" name="network_bytes_egress" dataKey="network_bytes_egress" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#colorEgress)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Sub-componente de tarjetas individuales para graficar métricas
function MetricChartCard({
    title,
    dataKey,
    data,
    color,
    unit = '',
    description
}: {
    title: string;
    dataKey: keyof MetricPoint;
    data: MetricPoint[];
    color: string;
    unit?: string;
    description: string;
}) {
    const gradientId = `gradient-${dataKey}`;
    return (
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col justify-between">
            <div>
                <div className="flex justify-between items-start">
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</h4>
                    <Activity className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400/80 mt-1">
                    {description}
                </p>
            </div>
            <div className="h-48 w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={color} stopOpacity={0.2}/>
                                <stop offset="95%" stopColor={color} stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(200,200,200,0.15)"/>
                        <XAxis dataKey="timestamp" tickLine={false} axisLine={false} style={{ fontSize: '10px', fill: '#64748B' }} />
                        <YAxis tickLine={false} axisLine={false} unit={unit} style={{ fontSize: '10px', fill: '#64748B' }} />
                        <RechartsTooltip
                            contentStyle={{ backgroundColor: 'rgba(30, 41, 59, 0.95)', border: 'none', borderRadius: '8px' }}
                            labelStyle={{ color: '#F1F5F9', fontWeight: '600', fontSize: '11px' }}
                            itemStyle={{ color: '#94A3B8', fontSize: '11px' }}
                            formatter={(value: any) => [typeof value === 'number' ? value.toFixed(1) + unit : value + unit, 'Average']}
                        />
                        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fillOpacity={1} fill={`url(#${gradientId})`} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
