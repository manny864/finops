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
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">💳</span>
                        Showback / Chargeback
                    </div>
                    <div className="vs">Distribuye y agrupa los costos de la nube por Unidad de Negocio usando Etiquetas (Tags).</div>
                </div>
                <div className="right">
                    <span className="scopechip">📍 {selectedTenant?.name || "Tenant"}</span>
                    {data.length > 0 && (
                        <button
                            onClick={handleExportCSV}
                            className="bg-surface border border-line text-ink-soft rounded-[10px] shadow-sm text-[13px] font-heading font-semibold transition-colors flex items-center hover:text-brand-deep hover:border-brand-bright cursor-pointer px-[11px] py-[7px]"
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Exportar CSV
                        </button>
                    )}
                </div>
            </div>

            <div className="card">
                <div className="p-[18px]">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        <div className="flex flex-col gap-2 md:col-span-1">
                            <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">Etiqueta a Agrupar (Tag Key)</label>
                            <div className="flex space-x-2">
                                <div className="relative w-full">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Tag className="w-4 h-4 text-grey" />
                                    </div>
                                    <select
                                        value={tagKey}
                                        onChange={(e) => setTagKey(e.target.value)}
                                        className="w-full pl-10 bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2.5 outline-none"
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
                            <div className="flex flex-col gap-2 md:col-span-1">
                                <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">Etiqueta Personalizada</label>
                                <input
                                    type="text"
                                    value={customTagKey}
                                    onChange={(e) => setCustomTagKey(e.target.value)}
                                    placeholder="Ej: Departamento"
                                    className="w-full bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2.5 outline-none"
                                />
                            </div>
                        )}

                        <div className={`md:col-span-1 ${isCustomTag ? '' : 'md:col-start-3'}`}>
                            <button
                                onClick={handleAnalyze}
                                disabled={loading || !selectedSubscription}
                                className="w-full bg-brand-deep text-white px-4 py-2.5 rounded-[10px] hover:brightness-110 transition flex items-center justify-center font-heading font-bold text-[13px] disabled:opacity-50 h-[42px] cursor-pointer shadow-sm"
                            >
                                {loading && <Loader2 className="w-5 h-5 animate-spin mr-2" />}
                                Ejecutar Showback
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {data.length > 0 ? (
                <div className="grid-2">
                    {/* Gráfico */}
                    <div className="card flex flex-col items-center p-6">
                        <h3 className="text-[14px] font-bold text-ink mb-6 w-full text-left">Distribución del Gasto por {isCustomTag ? customTagKey : tagKey}</h3>
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
                                        contentStyle={{ borderRadius: '8px', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}
                                    />
                                    <Legend 
                                        verticalAlign="bottom" 
                                        height={36}
                                        formatter={(value, entry: any) => (
                                            <span className="text-[12px] font-medium text-ink">
                                                {value} ({((entry.payload.value / totalCost) * 100).toFixed(1)}%)
                                            </span>
                                        )}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Breakdown */}
                    <div className="card flex flex-col h-full">
                        <div className="card-h">
                            <h3>Desglose de Costos (Últimos 30 días)</h3>
                        </div>
                        <div className="overflow-y-auto flex-1 max-h-96 p-[18px]">
                            <div className="flex flex-col gap-[14px]">
                                {data.map((item, index) => (
                                    <div key={index} className="flex justify-between items-center p-[11px_14px] rounded-[10px] border border-line bg-surface-2">
                                        <div className="flex items-center">
                                            <div className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                                            <span className="font-bold text-[13px] text-ink">{item.name}</span>
                                        </div>
                                        <span className="font-heading font-extrabold text-[15px] text-ink">${item.value.toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="mt-4 p-[18px] border-t border-line flex justify-between items-center bg-surface-2 rounded-b-[14px]">
                            <span className="font-bold text-ink text-sm">Gasto Total</span>
                            <span className="font-heading font-extrabold text-brand-deep text-lg">${totalCost.toFixed(2)} USD</span>
                        </div>
                    </div>
                </div>
            ) : (
                !loading && hasAnalyzed && (
                    <div className="empty border border-line rounded-[14px]">
                        <CreditCard className="w-12 h-12 text-grey mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-ink mb-2">No se encontraron costos</h3>
                        <p className="text-ink-soft">No hay datos de consumo registrados en los últimos 30 días para esta suscripción.</p>
                    </div>
                )
            )}
        </div>
    );
}
