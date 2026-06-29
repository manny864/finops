"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import MockBanner from '@/components/MockBanner';
import Pagination, { usePagination } from '@/components/Pagination';

export default function LicensesPage() {
    const { selectedTenant } = useTenant();
    const { subscriptions } = useSubscription();
    const t = useTranslations('Sidebar');
    const [licenses, setLicenses] = useState<any[]>([]);
    const [inactiveUsers, setInactiveUsers] = useState<any[]>([]);
    const [missingAhub, setMissingAhub] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorData, setErrorData] = useState<{message: string, needsConsent?: boolean} | null>(null);
    const [graphError, setGraphError] = useState<{message: string, needsConsent?: boolean} | null>(null);

    const { page: ahubPage, setPage: setAhubPage, pageSize: ahubPageSize, setPageSize: setAhubPageSize, total: ahubTotal, totalPages: ahubTotalPages, paged: pagedMissingAhub } = usePagination(missingAhub);
    const { page: licPage, setPage: setLicPage, pageSize: licPageSize, setPageSize: setLicPageSize, total: licTotal, totalPages: licTotalPages, paged: pagedLicenses } = usePagination(licenses);
    const { page: inactPage, setPage: setInactPage, pageSize: inactPageSize, setPageSize: setInactPageSize, total: inactTotal, totalPages: inactTotalPages, paged: pagedInactiveUsers } = usePagination(inactiveUsers);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default') return;

        const fetchLicenses = async () => {
            setLoading(true);
            setErrorData(null);
            setGraphError(null);
            try {
                const res = await fetch('/api/intelligence/licenses', {
                    headers: { 'x-tenant-id': selectedTenant.id }
                });
                const json = await res.json();
                if (json.success) {
                    setLicenses(json.data.licenses || []);
                    setInactiveUsers(json.data.inactiveUsers || []);
                    setMissingAhub(json.data.missingAhub || []);
                    if (json.data.graphError) {
                        setGraphError({
                            message: json.data.graphError,
                            needsConsent: json.data.needsConsent
                        });
                    }
                } else {
                    setErrorData({
                        message: json.error || 'Error desconocido',
                        needsConsent: json.needsConsent
                    });
                }
            } catch (e: any) {
                console.error("Error fetching licenses", e);
                setErrorData({ message: e.message || 'Error de red' });
            }
            setLoading(false);
        };
        
        fetchLicenses();
    }, [selectedTenant]);

    const total = licenses.reduce((sum, l) => sum + l.total, 0);
    const consumed = licenses.reduce((sum, l) => sum + l.consumed, 0);
    const available = licenses.reduce((sum, l) => sum + l.available, 0);
    const underutilized = licenses.reduce((sum, l) => sum + l.underutilized, 0);
    const ahubSavings = missingAhub.reduce((sum, item) => sum + item.potentialLicenseSavings, 0);

    if (errorData) {
        return (
            <div className="p-8 max-w-[1400px] mx-auto animate-in fade-in duration-500">
                <h1 className="text-2xl font-black text-slate-800 dark:text-white mb-6">License Optimization</h1>
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-8 text-center">
                    <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    </div>
                    <h2 className="text-xl font-bold text-rose-800 mb-2">Error de Conexión</h2>
                    <p className="text-rose-600 mb-4">{errorData.message}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-[1400px] mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <h1 className="text-2xl font-black text-slate-800 dark:text-white mb-2 flex items-center">
                Licencias
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Optimice sus costos de licenciamiento Microsoft 365 y aproveche Azure Hybrid Benefit (AHUB).</p>
            
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-sm font-bold text-slate-500 mb-2">Total Licencias</p>
                    <p className="text-3xl font-black text-slate-800">{loading ? '-' : (graphError ? 'N/A' : total)}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-sm font-bold text-slate-500 mb-2">M365 Asignadas</p>
                    <p className="text-3xl font-black text-blue-600">{loading ? '-' : (graphError ? 'N/A' : consumed)}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-sm font-bold text-slate-500 mb-2">M365 Disponibles</p>
                    <p className="text-3xl font-black text-emerald-600">{loading ? '-' : (graphError ? 'N/A' : available)}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-sm font-bold text-slate-500 mb-2">M365 Subutilizadas</p>
                    <p className="text-3xl font-black text-rose-600">{loading ? '-' : (graphError ? 'N/A' : underutilized)}</p>
                </div>
                <div className="bg-gradient-to-br from-indigo-600 to-violet-700 p-6 rounded-2xl shadow-md border border-indigo-500 text-white relative overflow-hidden">
                    <div className="absolute right-0 bottom-0 opacity-15 pointer-events-none transform translate-x-4 translate-y-4">
                        <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2-2 0-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z" /></svg>
                    </div>
                    <p className="text-sm font-bold text-indigo-100 mb-2">Ahorro Potencial AHUB</p>
                    <p className="text-3xl font-black text-white">{loading ? '-' : `$${ahubSavings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
                    <span className="inline-block mt-2 text-[10px] font-semibold bg-indigo-500/30 text-indigo-100 px-2 py-0.5 rounded-full border border-indigo-400/20">
                        Quick-Win Azure
                    </span>
                </div>
            </div>

            {/* SECCIÓN AZURE HYBRID BENEFIT */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                        Recursos sin Azure Hybrid Benefit (AHUB)
                    </h2>
                    {missingAhub.length > 0 && (
                        <span className="bg-rose-100 text-rose-800 text-xs font-bold px-3 py-1 rounded-full animate-pulse">
                            ¡Quick-Win de Ahorro Detectado!
                        </span>
                    )}
                </div>
                
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                    <th className="p-4 text-xs font-bold text-slate-500 uppercase">Recurso</th>
                                    <th className="p-4 text-xs font-bold text-slate-500 uppercase">Tipo</th>
                                    <th className="p-4 text-xs font-bold text-slate-500 uppercase">Suscripción</th>
                                    <th className="p-4 text-xs font-bold text-slate-500 uppercase">Grupo de Recursos</th>
                                    <th className="p-4 text-xs font-bold text-slate-500 uppercase">Ubicación</th>
                                    <th className="p-4 text-xs font-bold text-slate-500 uppercase">Ahorro Mensual Est.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading && (
                                    <tr><td colSpan={6} className="p-8 text-center text-slate-500">Analizando licencias de recursos Azure...</td></tr>
                                )}
                                {!loading && missingAhub.length === 0 && (
                                    <tr><td colSpan={6} className="p-8 text-center text-slate-500 text-sm">Todos sus recursos de Windows Server y SQL utilizan Azure Hybrid Benefit. ¡Excelente!</td></tr>
                                )}
                                {!loading && pagedMissingAhub.map((item, i) => {
                                    const sub = subscriptions.find(s => s.id === item.subscriptionId);
                                    const subName = sub ? sub.name : item.subscriptionId;
                                    const isSqlPool = item.scope === 'elasticPool';
                                    return (
                                        <tr key={i} className="hover:bg-indigo-50/20 transition-colors">
                                            <td className="p-4 font-bold text-slate-700 dark:text-slate-200 text-sm">
                                                {item.name}
                                                {isSqlPool && (
                                                    <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                                                        Ahorro a nivel pool (no por base individual)
                                                    </div>
                                                )}
                                                {!isSqlPool && item.type === 'microsoft.sql/servers/databases' && item.tier && (
                                                    <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                                                        {item.tier} · {item.vCores} vCore{item.vCores > 1 ? 's' : ''}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <span className={`tag ${item.type === 'microsoft.compute/virtualmachines' ? 'blue' : 'teal'}`}>
                                                    {item.type === 'microsoft.compute/virtualmachines' ? 'Virtual Machine' : (isSqlPool ? 'SQL Elastic Pool' : 'SQL Database')}
                                                </span>
                                            </td>
                                            <td className="p-4 text-slate-600 dark:text-slate-300 text-sm">{subName}</td>
                                            <td className="p-4 text-slate-600 dark:text-slate-300 text-sm">{item.resourceGroup}</td>
                                            <td className="p-4 text-slate-600 dark:text-slate-300 text-sm">
                                                <span className="tag grey">{item.location}</span>
                                            </td>
                                            <td className="p-4 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                                                ${item.potentialLicenseSavings.toFixed(2)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <Pagination page={ahubPage} setPage={setAhubPage} pageSize={ahubPageSize} setPageSize={setAhubPageSize} total={ahubTotal} totalPages={ahubTotalPages} />
                </div>
            </div>

            {/* SECCIÓN MICROSOFT 365 / GRAPH */}
            <div>
                {graphError && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 mb-8">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center shrink-0">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-amber-800 mb-1">M365: Acceso Limitado</h3>
                                <p className="text-amber-700 text-sm mb-3">No se pudieron consultar las licencias de Microsoft 365 debido a permisos de Graph API insuficientes (403).</p>
                                {graphError.needsConsent && (
                                    <div className="bg-white p-4 rounded-xl text-xs text-slate-700 border border-amber-100 shadow-sm max-w-3xl">
                                        <p className="font-bold mb-2">Para habilitar la visualización de licencias de M365:</p>
                                        <ol className="list-decimal pl-5 space-y-1">
                                            <li>Acceda al portal de Azure AD (Entra ID) &gt; App Registrations</li>
                                            <li>Seleccione la aplicación registrada para este inquilino (Tenant).</li>
                                            <li>Navegue a <b>API Permissions</b></li>
                                            <li>Agregue los permisos tipo Application para <b>Microsoft Graph</b>: <b>Organization.Read.All</b> y <b>Reports.Read.All</b></li>
                                            <li className="text-indigo-600 font-bold">Haga clic en el botón "Grant admin consent for Default Directory".</li>
                                        </ol>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {!graphError && (
                    <>
                        <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4">Métricas por SKU</h2>
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-8">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="p-4 text-xs font-bold text-slate-500 uppercase">SKU</th>
                                            <th className="p-4 text-xs font-bold text-slate-500 uppercase">Total</th>
                                            <th className="p-4 text-xs font-bold text-slate-500 uppercase">En Uso</th>
                                            <th className="p-4 text-xs font-bold text-slate-500 uppercase">Disponibles</th>
                                            <th className="p-4 text-xs font-bold text-slate-500 uppercase">Riesgo Subutilización</th>
                                            <th className="p-4 text-xs font-bold text-slate-500 uppercase">Gasto Desperdiciado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {loading && (
                                            <tr><td colSpan={6} className="p-8 text-center text-slate-500">Cargando licencias...</td></tr>
                                        )}
                                        {!loading && licenses.length === 0 && (
                                            <tr><td colSpan={6} className="p-8 text-center text-slate-500 text-sm">No se encontraron licencias.</td></tr>
                                        )}
                                        {!loading && pagedLicenses.map(l => (
                                            <tr key={l.id} className={`hover:bg-slate-50 transition-colors ${l.isSystemSku ? 'opacity-70' : ''}`}>
                                                <td className="p-4 font-bold text-slate-700 text-sm">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        {l.skuPartNumber}
                                                        {l.isSystemSku && (
                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-600">
                                                                Sistema · sin costo
                                                            </span>
                                                        )}
                                                        {l.skuPartNumber === 'Windows_Store' && (
                                                            <span className="relative inline-block group">
                                                                <Info className="w-4 h-4 text-indigo-500 cursor-help shrink-0" />
                                                                <span
                                                                    role="tooltip"
                                                                    className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-72 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-normal leading-snug text-white shadow-xl ring-1 ring-slate-700 group-hover:block dark:bg-slate-800"
                                                                >
                                                                    <strong className="block mb-1 text-indigo-300">¿Qué es Windows_Store?</strong>
                                                                    Es la categoría que Microsoft usa internamente para facturar suscripciones de software a través del <em>Azure Commercial Marketplace</em>.
                                                                    <br /><br />
                                                                    <strong>No</strong> tiene relación con la tienda de aplicaciones de Windows. Incluye licencias corporativas (M365, Copilot, Entra ID Premium, Defender) y herramientas de terceros compradas en el Marketplace.
                                                                    <br /><br />
                                                                    <strong className="text-emerald-300">Es gratuito:</strong> Microsoft lo agrega automáticamente a todos los tenants. No genera costo ni ahorro real.
                                                                    <span className="absolute -top-1 left-1/2 -ml-1 h-2 w-2 rotate-45 bg-slate-900 dark:bg-slate-800"></span>
                                                                </span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-slate-600 text-sm">{l.total}</td>
                                                <td className="p-4 text-slate-600 text-sm">{l.consumed}</td>
                                                <td className="p-4 text-emerald-600 font-semibold text-sm">{l.available}</td>
                                                <td className={`p-4 font-semibold text-sm ${l.isSystemSku ? 'text-slate-400' : 'text-rose-600'}`}>{l.underutilized}</td>
                                                <td className={`p-4 font-bold text-sm ${l.isSystemSku ? 'text-slate-400' : 'text-rose-600'}`}>${l.wastedCost.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <Pagination page={licPage} setPage={setLicPage} pageSize={licPageSize} setPageSize={setLicPageSize} total={licTotal} totalPages={licTotalPages} />
                        </div>

                        <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4">Usuarios Inactivos (Recomendación de Revocación)</h2>
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="p-4 text-xs font-bold text-slate-500 uppercase">User Principal Name</th>
                                            <th className="p-4 text-xs font-bold text-slate-500 uppercase">Productos Asignados</th>
                                            <th className="p-4 text-xs font-bold text-slate-500 uppercase">Última Actividad</th>
                                            <th className="p-4 text-xs font-bold text-slate-500 uppercase">Días Inactivo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {loading && (
                                            <tr><td colSpan={4} className="p-8 text-center text-slate-500">Analizando reportes de uso...</td></tr>
                                        )}
                                        {!loading && inactiveUsers.length === 0 && (
                                            <tr><td colSpan={4} className="p-8 text-center text-slate-500 text-sm">No se encontraron usuarios inactivos. ¡Excelente optimización!</td></tr>
                                        )}
                                        {!loading && pagedInactiveUsers.map((u, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="p-4 font-bold text-slate-700 text-sm">{u.userPrincipalName}</td>
                                                <td className="p-4 text-slate-600 text-sm">{u.assignedProducts}</td>
                                                <td className="p-4 text-slate-600 text-sm">{u.lastActivityDate || 'Nunca'}</td>
                                                <td className="p-4 text-rose-600 font-bold text-sm">{u.daysInactive > 900 ? '+900' : u.daysInactive}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <Pagination page={inactPage} setPage={setInactPage} pageSize={inactPageSize} setPageSize={setInactPageSize} total={inactTotal} totalPages={inactTotalPages} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

