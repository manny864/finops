"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useRouter } from 'next/navigation';
import { isSuperAdmin } from '@/lib/authGuard';
import { toast } from 'sonner';
import { 
    Activity, Server, Database, Clock, RefreshCw, CheckCircle, 
    AlertTriangle, ShieldAlert, FileText, Settings, RefreshCw as RefreshIcon
} from 'lucide-react';

interface TenantHealth {
    id: string;
    name: string;
    client_id: string;
    status: string;
    last_sync_at: string | null;
    sync_status: 'OK' | 'ERROR';
    last_error_message: string | null;
}

interface DiagnosticsData {
    status: 'HEALTHY' | 'DEGRADED';
    database: {
        status: 'OK' | 'ERROR';
        error: string | null;
    };
    environment: {
        status: 'OK' | 'MISSING_VARS';
        variables: Record<string, string>;
    };
    system: {
        uptimeSeconds: number;
        uptimeFormatted: string;
        nodeVersion: string;
        platform: string;
    };
}

export default function SuperAdminHealthPage() {
    const { accounts, instance } = useMsal();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    
    // System Diagnostics state
    const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
    // Tenants state
    const [tenants, setTenants] = useState<TenantHealth[]>([]);
    const [checkingTenantId, setCheckingTenantId] = useState<string | null>(null);

    useEffect(() => {
        if (accounts.length > 0) {
            const email = accounts[0].username;
            if (!isSuperAdmin(email)) {
                toast.error("No tienes permisos de SuperAdmin para ver esta página.");
                router.replace('/');
                return;
            }
            loadAllData();
        }
    }, [accounts, router]);

    const getAuthHeader = async (): Promise<Record<string, string>> => {
        if (accounts.length === 0) return {};
        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: accounts[0]
        });
        return { 'Authorization': `Bearer ${tokenResponse.idToken}` };
    };

    const loadAllData = async () => {
        setLoading(true);
        try {
            const headers = await getAuthHeader();
            const [diagRes, tenantsRes] = await Promise.all([
                fetch('/api/system/diagnostics', { headers }),
                fetch('/api/system/diagnostics/tenants', { headers })
            ]);

            if (diagRes.ok) {
                const diagJson = await diagRes.json();
                setDiagnostics(diagJson);
            }
            if (tenantsRes.ok) {
                const tenantsJson = await tenantsRes.json();
                setTenants(tenantsJson.tenants || []);
            }
        } catch (error) {
            console.error("Error loading diagnostics or tenants", error);
            toast.error("Error al cargar los datos de salud del sistema.");
        } finally {
            setLoading(false);
        }
    };

    const handleRefreshDiagnostics = async () => {
        setRefreshing(true);
        try {
            const headers = await getAuthHeader();
            const diagRes = await fetch('/api/system/diagnostics', { headers });
            if (diagRes.ok) {
                const diagJson = await diagRes.json();
                setDiagnostics(diagJson);
                toast.success("Diagnóstico del sistema actualizado.");
            }
        } catch (e) {
            toast.error("Error al actualizar diagnóstico.");
        } finally {
            setRefreshing(false);
        }
    };

    const handleCheckTenantHealth = async (tenantId: string) => {
        setCheckingTenantId(tenantId);
        try {
            const headers = await getAuthHeader();
            const res = await fetch('/api/system/diagnostics/tenants', {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tenantId })
            });

            const json = await res.json();
            if (res.ok && json.success) {
                toast.success("Verificación de credenciales completada.");
                // Refresh list
                const tenantsRes = await fetch('/api/system/diagnostics/tenants', { headers });
                if (tenantsRes.ok) {
                    const tenantsJson = await tenantsRes.json();
                    setTenants(tenantsJson.tenants || []);
                }
            } else {
                toast.error(json.error || "Fallo al verificar credenciales.");
            }
        } catch (error) {
            toast.error("Error de conexión durante la verificación.");
        } finally {
            setCheckingTenantId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-gray-400">
                <RefreshIcon className="w-8 h-8 animate-spin text-indigo-600 mb-2" />
                <p className="font-semibold">Cargando Salud del Sistema...</p>
            </div>
        );
    }

    return (
        <div className="max-w-[1400px] mx-auto p-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-gray-200 dark:border-slate-800 pb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center">
                        <Activity className="w-8 h-8 mr-3 text-emerald-500" />
                        Diagnósticos y Heartbeat de Inquilinos
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">
                        Super Admin: Estado de la infraestructura, base de datos y validez de las credenciales de Azure por Tenant.
                    </p>
                </div>
                <button 
                    onClick={loadAllData}
                    className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm transition-colors"
                >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Actualizar Todo
                </button>
            </div>

            {/* Diagnostics Cards */}
            {diagnostics && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    {/* Status card */}
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Estado Global</span>
                            <Server className="w-5 h-5 text-indigo-500" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`w-3.5 h-3.5 rounded-full ${diagnostics.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                            <span className="text-xl font-extrabold text-gray-800 dark:text-white">{diagnostics.status}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">Uptime: {diagnostics.system.uptimeFormatted}</p>
                    </div>

                    {/* MySQL Card */}
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Base de Datos</span>
                            <Database className="w-5 h-5 text-blue-500" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`w-3.5 h-3.5 rounded-full ${diagnostics.database.status === 'OK' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                            <span className="text-xl font-extrabold text-gray-800 dark:text-white">MySQL: {diagnostics.database.status}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-2 truncate">
                            {diagnostics.database.error ? diagnostics.database.error : 'Conexión activa'}
                        </p>
                    </div>

                    {/* Env Vars Card */}
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Variables de Entorno</span>
                            <Settings className="w-5 h-5 text-amber-500" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`w-3.5 h-3.5 rounded-full ${diagnostics.environment.status === 'OK' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                            <span className="text-xl font-extrabold text-gray-800 dark:text-white">{diagnostics.environment.status}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                            {Object.values(diagnostics.environment.variables).filter(v => v === 'missing').length} faltantes
                        </p>
                    </div>

                    {/* Server Spec Card */}
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Servidor</span>
                            <Clock className="w-5 h-5 text-gray-500" />
                        </div>
                        <div className="text-lg font-extrabold text-gray-800 dark:text-white">Node {diagnostics.system.nodeVersion}</div>
                        <p className="text-xs text-gray-400 mt-2">Plataforma: {diagnostics.system.platform}</p>
                    </div>
                </div>
            )}

            {/* Tenant Health Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-gray-50/50 dark:bg-slate-900/50">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800 dark:text-white">Credenciales y Sincronización de Azure</h2>
                        <p className="text-xs text-gray-400 mt-1">Sincronización y estado de validez de secretos OAuth2 por inquilino.</p>
                    </div>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-100/75 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-800 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                                <th className="p-4 pl-6">Organización / ID</th>
                                <th className="p-4">Azure Client ID</th>
                                <th className="p-4">Estado Heartbeat</th>
                                <th className="p-4">Última Verificación</th>
                                <th className="p-4">Último Error / Detalle</th>
                                <th className="p-4 pr-6 text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800/80">
                            {tenants.length > 0 ? (
                                tenants.map((tenant) => (
                                    <tr key={tenant.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/20 transition-colors">
                                        <td className="p-4 pl-6">
                                            <div className="font-bold text-sm text-gray-800 dark:text-white">{tenant.name}</div>
                                            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-0.5">{tenant.id}</div>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-xs font-mono bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded text-gray-600 dark:text-gray-300">
                                                {tenant.client_id ? `${tenant.client_id.substring(0, 8)}...` : 'No configurado'}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold shadow-sm ${
                                                tenant.sync_status === 'OK' 
                                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-400' 
                                                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/35 dark:text-rose-400'
                                            }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${tenant.sync_status === 'OK' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                                                {tenant.sync_status}
                                            </span>
                                        </td>
                                        <td className="p-4 text-xs text-gray-500 dark:text-gray-400 font-medium">
                                            {tenant.last_sync_at ? new Date(tenant.last_sync_at).toLocaleString() : 'Nunca verificado'}
                                        </td>
                                        <td className="p-4 max-w-xs">
                                            {tenant.sync_status === 'ERROR' ? (
                                                <div className="flex items-start text-xs text-rose-600 dark:text-rose-400 font-medium gap-1.5">
                                                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                                                    <span className="line-clamp-2" title={tenant.last_error_message || ''}>{tenant.last_error_message}</span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400">Verificación correcta</span>
                                            )}
                                        </td>
                                        <td className="p-4 pr-6 text-right">
                                            <button
                                                onClick={() => handleCheckTenantHealth(tenant.id)}
                                                disabled={checkingTenantId === tenant.id}
                                                className="inline-flex items-center px-3 py-1.5 bg-gray-100 hover:bg-indigo-50 border border-gray-200 dark:border-slate-800 dark:bg-slate-800 hover:dark:bg-indigo-950/40 text-gray-700 dark:text-gray-300 hover:text-indigo-600 hover:dark:text-indigo-400 text-xs font-bold rounded-lg shadow-sm transition-all disabled:opacity-50"
                                            >
                                                {checkingTenantId === tenant.id ? (
                                                    <>
                                                        <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                                                        Verificando
                                                    </>
                                                ) : (
                                                    <>
                                                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                                        Verificar
                                                    </>
                                                )}
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-gray-400 font-medium">
                                        No hay inquilinos activos registrados en la plataforma.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
