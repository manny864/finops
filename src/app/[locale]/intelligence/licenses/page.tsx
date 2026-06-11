"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useTranslations } from 'next-intl';

export default function LicensesPage() {
    const { selectedTenant } = useTenant();
    const t = useTranslations('Sidebar');
    const [licenses, setLicenses] = useState<any[]>([]);
    const [inactiveUsers, setInactiveUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorData, setErrorData] = useState<{message: string, needsConsent?: boolean} | null>(null);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default') return;

        const fetchLicenses = async () => {
            setLoading(true);
            setErrorData(null);
            try {
                const res = await fetch('/api/intelligence/licenses', {
                    headers: { 'x-tenant-id': selectedTenant.id }
                });
                const json = await res.json();
                if (json.success) {
                    setLicenses(json.data.licenses || []);
                    setInactiveUsers(json.data.inactiveUsers || []);
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

    if (errorData) {
        return (
            <div className="p-8 max-w-[1400px] mx-auto animate-in fade-in duration-500">
                <h1 className="text-2xl font-black text-slate-800 mb-6">License Optimization</h1>
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-8 text-center">
                    <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    </div>
                    <h2 className="text-xl font-bold text-rose-800 mb-2">Error de Autorización</h2>
                    <p className="text-rose-600 mb-4">{errorData.message}</p>
                    {errorData.needsConsent && (
                        <div className="bg-white p-4 rounded-xl text-left text-sm text-slate-700 max-w-2xl mx-auto border border-rose-100 shadow-sm">
                            <p className="font-bold mb-2">Acción Requerida en Entra ID:</p>
                            <ol className="list-decimal pl-5 space-y-1">
                                <li>Vaya al portal de Azure (Entra ID) &gt; App Registrations</li>
                                <li>Seleccione la aplicación (Service Principal) de este tenant.</li>
                                <li>Vaya a <b>API Permissions</b></li>
                                <li>Asegúrese de agregar <b>Microsoft Graph</b> &gt; Application Permissions &gt; <b>Organization.Read.All</b> y <b>Reports.Read.All</b></li>
                                <li className="text-rose-600 font-bold">Haga clic en el botón "Grant admin consent for Default Directory"</li>
                            </ol>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-[1400px] mx-auto animate-in fade-in duration-500">
            <h1 className="text-2xl font-black text-slate-800 mb-6">License Optimization</h1>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-sm font-bold text-slate-500 mb-2">Total Licencias</p>
                    <p className="text-3xl font-black text-slate-800">{loading ? '-' : total}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-sm font-bold text-slate-500 mb-2">Asignadas</p>
                    <p className="text-3xl font-black text-blue-600">{loading ? '-' : consumed}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-sm font-bold text-slate-500 mb-2">Disponibles (Sin asignar)</p>
                    <p className="text-3xl font-black text-emerald-600">{loading ? '-' : available}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-sm font-bold text-slate-500 mb-2">Subutilizadas (Riesgo)</p>
                    <p className="text-3xl font-black text-rose-600">{loading ? '-' : underutilized}</p>
                </div>
            </div>

            <h2 className="text-xl font-bold text-slate-800 mb-4">Métricas por SKU</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-8">
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
                            <tr><td colSpan={6} className="p-8 text-center text-slate-500">No se encontraron licencias.</td></tr>
                        )}
                        {!loading && licenses.map(l => (
                            <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                                <td className="p-4 font-bold text-slate-700">{l.skuPartNumber}</td>
                                <td className="p-4 text-slate-600">{l.total}</td>
                                <td className="p-4 text-slate-600">{l.consumed}</td>
                                <td className="p-4 text-emerald-600 font-semibold">{l.available}</td>
                                <td className="p-4 text-rose-600 font-semibold">{l.underutilized}</td>
                                <td className="p-4 text-rose-600 font-bold">${l.wastedCost.toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <h2 className="text-xl font-bold text-slate-800 mb-4">Usuarios Inactivos (Recomendación de Revocación)</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
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
                            <tr><td colSpan={4} className="p-8 text-center text-slate-500">No se encontraron usuarios inactivos. ¡Excelente optimización!</td></tr>
                        )}
                        {!loading && inactiveUsers.map((u, i) => (
                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                <td className="p-4 font-bold text-slate-700">{u.userPrincipalName}</td>
                                <td className="p-4 text-slate-600">{u.assignedProducts}</td>
                                <td className="p-4 text-slate-600">{u.lastActivityDate || 'Nunca'}</td>
                                <td className="p-4 text-rose-600 font-bold">{u.daysInactive > 900 ? '+900' : u.daysInactive}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
