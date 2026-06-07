"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import { useMsal } from '@azure/msal-react';
import { CreditCard, AlertTriangle, Loader2, Download, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = ['#0054A6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];

export default function ChargebackPage() {
    const { selectedTenant } = useTenant();
    const { selectedSubscription, loading: loadingSubs } = useSubscription();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<{name: string, value: number}[]>([]);
    const [hasAnalyzed, setHasAnalyzed] = useState(false);

    const [tagKey, setTagKey] = useState('CostCenter');
    const [customTagKey, setCustomTagKey] = useState('');
    const isCustomTag = tagKey === 'custom';

    const handleAnalyze = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            toast.error("Por favor selecciona un tenant primero.");
            return;
        }
        if (!selectedSubscription) {
            toast.error("Selecciona una suscripción en la barra superior.");
            return;
        }

        const activeTagKey = isCustomTag ? customTagKey : tagKey;
        if (!activeTagKey.trim()) {
            toast.error("Debes ingresar el nombre de una etiqueta válida.");
            return;
        }

        setLoading(true);
        try {
            const url = `/api/intelligence/chargeback?tenantId=${selectedTenant.id}&subscriptionId=${selectedSubscription}&tagKey=${encodeURIComponent(activeTagKey)}`;
            const res = await fetch(url);
            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.error || json.details || 'Error desconocido');
            }

            if (json.data) {
                setData(json.data.sort((a: any, b: any) => b.value - a.value)); // Ordenar por costo descendente
                setHasAnalyzed(true);
                toast.success(`Datos de Showback calculados exitosamente.`);
            }
        } catch (error: any) {
            console.error("Chargeback fetch error:", error);
            toast.error(error.message || "Error al obtener datos de chargeback.");
        } finally {
            setLoading(false);
        }
    };

    const handleExportCSV = () => {
        if (data.length === 0) return;
        
        const activeTagKey = isCustomTag ? customTagKey : tagKey;
        const csvRows = [];
        
        // Headers
        csvRows.push(`${activeTagKey},Costo (USD)`);
        
        // Data
        for (const row of data) {
            const escapedName = `"${row.name.replace(/"/g, '""')}"`;
            csvRows.push(`${escapedName},${row.value.toFixed(2)}`);
        }
        
        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `Chargeback_${activeTagKey}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const totalCost = data.reduce((acc, curr) => acc + curr.value, 0);

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                        <CreditCard className="w-8 h-8 mr-3 text-[#0054A6]" />
                        Showback / Chargeback
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Distribuye y agrupa los costos de la nube por Unidad de Negocio usando Etiquetas (Tags).
                    </p>
                </div>
                {data.length > 0 && (
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                    >
                        <Download className="w-4 h-4 mr-2" />
                        Exportar a CSV
                    </button>
                )}
            </div>

            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">

                        <div className="space-y-2 md:col-span-1">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Etiqueta a Agrupar (Tag Key)</label>
                            <div className="flex space-x-2">
                                <div className="relative w-full">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Tag className="w-4 h-4 text-gray-400" />
                                    </div>
                                    <select
                                        value={tagKey}
                                        onChange={(e) => setTagKey(e.target.value)}
                                        className="w-full pl-10 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-[#0054A6] focus:border-[#0054A6] p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                                    >
                                        <option value="CostCenter">CostCenter</option>
                                        <option value="Environment">Environment</option>
                                        <option value="Project">Project</option>
                                        <option value="Owner">Owner</option>
                                        <option value="custom">-- Otro (Personalizado) --</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {isCustomTag && (
                            <div className="space-y-2 md:col-span-1">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Etiqueta Personalizada</label>
                                <input
                                    type="text"
                                    value={customTagKey}
                                    onChange={(e) => setCustomTagKey(e.target.value)}
                                    placeholder="Ej: Departamento"
                                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-[#0054A6] focus:border-[#0054A6] p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                                />
                            </div>
                        )}

                        <div className={`md:col-span-1 ${isCustomTag ? '' : 'md:col-start-3'}`}>
                            <button
                                onClick={handleAnalyze}
                                disabled={loading || !selectedSubscription}
                                className="w-full bg-[#0054A6] text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition flex items-center justify-center font-medium disabled:opacity-50 h-[42px]"
                            >
                                {loading && <Loader2 className="w-5 h-5 animate-spin mr-2" />}
                                Ejecutar Showback
                            </button>
                        </div>
                    </div>
                </div>

            {data.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Gráfico */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm flex flex-col items-center">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 w-full text-left">Distribución del Gasto por {isCustomTag ? customTagKey : tagKey}</h3>
                        <div className="h-80 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={data}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        outerRadius={120}
                                        innerRadius={60}
                                        fill="#8884d8"
                                        dataKey="value"
                                        paddingAngle={2}
                                    >
                                        {data.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip 
                                        formatter={(value: any) => [`$${Number(value).toFixed(2)} USD`, 'Costo']}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Legend 
                                        verticalAlign="bottom" 
                                        height={36}
                                        formatter={(value, entry: any) => (
                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                {value} ({((entry.payload.value / totalCost) * 100).toFixed(1)}%)
                                            </span>
                                        )}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Breakdown */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm flex flex-col h-full">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Desglose de Costos (Últimos 30 días)</h3>
                        <div className="overflow-y-auto flex-1 max-h-96 pr-2">
                            <div className="space-y-4">
                                {data.map((item, index) => (
                                    <div key={index} className="flex justify-between items-center p-3 rounded-lg border border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <div className="flex items-center">
                                            <div className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                                            <span className="font-medium text-gray-900 dark:text-white">{item.name}</span>
                                        </div>
                                        <span className="font-bold text-gray-700 dark:text-gray-300">${item.value.toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-800 flex justify-between items-center">
                            <span className="font-bold text-gray-900 dark:text-white text-lg">Gasto Total</span>
                            <span className="font-bold text-blue-600 dark:text-blue-400 text-xl">${totalCost.toFixed(2)} USD</span>
                        </div>
                    </div>
                </div>
            ) : (
                !loading && hasAnalyzed && (
                    <div className="bg-white dark:bg-slate-900 p-12 text-center rounded-xl border border-gray-200 dark:border-slate-800">
                        <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No se encontraron costos</h3>
                        <p className="text-gray-500 dark:text-gray-400">No hay datos de consumo registrados en los últimos 30 días para esta suscripción.</p>
                    </div>
                )
            )}
        </div>
    );
}
