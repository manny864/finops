"use client";
import React, { useState } from 'react';
import { 
    PieChart, MapPin, DollarSign, TrendingDown, CheckSquare, 
    Calendar, Skull, Tag, BarChart3, Zap, Moon
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart as RechartsPieChart, Pie, Cell } from 'recharts';

interface InteractiveDashboardProps {
    totalSavings: number;
    calculateCO2Savings: (val: number) => string;
    loading: boolean;
    dashboardData: any[];
    selectedCategory: string | null;
    setSelectedCategory: (cat: string | null) => void;
    complianceScore: number | null;
    setActiveTab: (tab: string) => void;
    untaggedPercentage?: number;
}

export default function InteractiveDashboard({
    totalSavings,
    loading,
    complianceScore,
}: InteractiveDashboardProps) {

    // Mock data for the charts to match the image
    const evolutionData = [
        { name: 'Ene', gasto: 52000 },
        { name: 'Feb', gasto: 50000 },
        { name: 'Mar', gasto: 51500 },
        { name: 'Abr', gasto: 49000 },
        { name: 'May', gasto: 49500 },
        { name: 'Jun', gasto: 48200 },
    ];

    const pieData = [
        { name: 'PROD-Core', value: 18250, color: '#1e3a8a' },
        { name: 'PROD-Data', value: 14900, color: '#0ea5e9' },
        { name: 'QA-Staging', value: 8600, color: '#3b82f6' },
        { name: 'DEV-Sandbox', value: 6450, color: '#93c5fd' },
    ];

    const formatYAxis = (tickItem: any) => `$${(tickItem / 1000).toFixed(1)}k`;

    const CustomDot = (props: any) => {
        const { cx, cy, index } = props;
        if (index === evolutionData.length - 1) {
            return <circle cx={cx} cy={cy} r={6} stroke="#0ea5e9" strokeWidth={3} fill="#ffffff" />;
        }
        return null;
    };

    return (
        <div className="max-w-[1400px] mx-auto animate-in fade-in duration-500 bg-slate-50 p-6 rounded-2xl">
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <div className="flex items-center">
                        <div className="bg-blue-600 rounded-lg p-2 mr-3 text-white shadow-sm">
                            <PieChart className="w-6 h-6 fill-white/20" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-800">Consumo Real</h1>
                    </div>
                    <p className="text-sm text-slate-500 mt-1 ml-14">Gasto real del tenant y oportunidades activas, en vivo.</p>
                </div>
                <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center shadow-sm">
                    <MapPin className="w-3 h-3 mr-1 text-red-500 fill-red-500" />
                    Tenant completo
                </div>
            </div>

            {/* Top Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <DollarSign className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        Gasto Mensual
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">$48,200</div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <TrendingDown className="w-3.5 h-3.5 mr-1 text-red-500" />
                        Ahorro Identificado
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">$9,698</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-1">pendiente de aplicar</div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <CheckSquare className="w-3.5 h-3.5 mr-1 text-emerald-500 fill-emerald-500/20" />
                        Ahorro Aplicado
                    </div>
                    <div className="text-2xl font-extrabold text-emerald-500">$0</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-1">0% capturado</div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <Calendar className="w-3.5 h-3.5 mr-1 text-rose-400" />
                        Proyección Anual
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">$578,400</div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <Skull className="w-3.5 h-3.5 mr-1 text-slate-500" />
                        Recursos Zombis
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">14</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-1">recursos inactivos</div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <Tag className="w-3.5 h-3.5 mr-1 text-amber-500 fill-amber-500/20" />
                        Compliance Etiquetas
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">68%</div>
                </div>
            </div>

            {/* Middle Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                {/* Left Chart */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 lg:col-span-2">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center text-sm font-bold text-slate-700">
                            <BarChart3 className="w-4 h-4 mr-2 text-rose-800" />
                            Evolución del gasto mensual
                        </div>
                        <div className="text-[11px] font-medium text-slate-400">
                            Tenant completo · USD
                        </div>
                    </div>
                    <div className="h-64 w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={evolutionData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorBlue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.15}/>
                                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={10} />
                                <YAxis tickFormatter={formatYAxis} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} domain={[37000, 55000]} />
                                <RechartsTooltip 
                                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    formatter={(value: any) => [`$${value}`, 'Gasto']}
                                />
                                <Area type="monotone" dataKey="gasto" stroke="#0ea5e9" strokeWidth={3} fillOpacity={1} fill="url(#colorBlue)" activeDot={{ r: 6, strokeWidth: 0 }} dot={<CustomDot />} />
                            </AreaChart>
                        </ResponsiveContainer>
                        {/* Dashed potential line */}
                        <div className="absolute bottom-[35px] left-[55px] right-[25px] border-t-2 border-dashed border-slate-300"></div>
                        <div className="absolute bottom-[40px] right-[25px] text-[10px] font-bold text-slate-400 bg-white px-1">Potencial $38.5k</div>
                    </div>
                    <div className="flex items-center gap-4 mt-4 text-[11px] font-bold text-slate-500 pl-4">
                        <div className="flex items-center"><div className="w-3 h-3 rounded-sm bg-sky-500 mr-2"></div> Gasto real</div>
                        <div className="flex items-center"><div className="w-3 h-3 rounded-sm bg-slate-400 mr-2"></div> Potencial alcanzable</div>
                    </div>
                </div>

                {/* Right Chart */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <div className="flex items-center text-sm font-bold text-slate-700 mb-6">
                        <PieChart className="w-4 h-4 mr-2 text-rose-800 fill-rose-800" />
                        Gasto por suscripción
                    </div>
                    <div className="flex items-center justify-center h-64">
                        <div className="w-1/2 h-full relative flex items-center justify-center">
                            <ResponsiveContainer width="100%" height="100%">
                                <RechartsPieChart>
                                    <Pie
                                        data={pieData}
                                        innerRadius={55}
                                        outerRadius={80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        stroke="none"
                                    >
                                        {pieData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip formatter={(value: any) => `$${value}`} />
                                </RechartsPieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-2">
                                <span className="text-xl font-extrabold text-slate-800 tracking-tight">$48.2k</span>
                                <span className="text-[9px] font-bold text-slate-400">gasto / mes</span>
                            </div>
                        </div>
                        <div className="w-1/2 pl-2 flex flex-col justify-center gap-3">
                            {pieData.map((item, i) => (
                                <div key={i} className="flex items-center text-[10px] font-bold text-slate-600">
                                    <div className="w-2.5 h-2.5 rounded-sm mr-2 shrink-0" style={{ backgroundColor: item.color }}></div>
                                    <span className="truncate">{item.name} <span className="text-slate-400 font-medium">· ${item.value.toLocaleString()}</span></span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom List */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white">
                    <div className="flex items-center text-sm font-bold text-slate-800">
                        <Zap className="w-4 h-4 mr-2 text-amber-500 fill-amber-500" />
                        Top oportunidades de ahorro
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">acción rápida</div>
                </div>
                <div className="divide-y divide-gray-50">
                    <div className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center">
                            <div className="bg-[#FFF4E5] p-2.5 rounded-lg mr-4">
                                <Tag className="w-5 h-5 text-amber-700 fill-amber-700/20" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-bold text-slate-800">Instancia Reservada 3 años</h4>
                                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">12× VM</span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1 font-medium">Optimización de Tarifas · <span className="text-slate-700 font-bold">PROD-Core</span></p>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="text-emerald-600 font-extrabold text-sm mb-2">$2,100 <span className="text-[10px] font-medium text-slate-400">/mes</span></div>
                            <button className="bg-[#0088FF] hover:bg-blue-600 text-white text-[11px] font-bold px-5 py-1.5 rounded-full shadow-sm transition-colors">Aplicar</button>
                        </div>
                    </div>

                    <div className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center">
                            <div className="bg-[#FFF8E6] p-2.5 rounded-lg mr-4">
                                <Moon className="w-5 h-5 text-amber-400 fill-amber-400" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-bold text-slate-800">Power Schedule QA</h4>
                                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">6 VMs</span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1 font-medium">Horarios de Apagado · <span className="text-slate-700 font-bold">QA-Staging</span></p>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="text-emerald-600 font-extrabold text-sm mb-2">$1,850 <span className="text-[10px] font-medium text-slate-400">/mes</span></div>
                            <button className="bg-[#0088FF] hover:bg-blue-600 text-white text-[11px] font-bold px-5 py-1.5 rounded-full shadow-sm transition-colors">Aplicar</button>
                        </div>
                    </div>

                    <div className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center">
                            <div className="bg-[#FFF8E6] p-2.5 rounded-lg mr-4">
                                <Moon className="w-5 h-5 text-amber-400 fill-amber-400" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-bold text-slate-800">Power Schedule DEV</h4>
                                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">8 VMs</span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1 font-medium">Horarios de Apagado · <span className="text-slate-700 font-bold">DEV-Sandbox</span></p>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="text-emerald-600 font-extrabold text-sm mb-2">$1,620 <span className="text-[10px] font-medium text-slate-400">/mes</span></div>
                            <button className="bg-[#0088FF] hover:bg-blue-600 text-white text-[11px] font-bold px-5 py-1.5 rounded-full shadow-sm transition-colors">Aplicar</button>
                        </div>
                    </div>

                    <div className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center">
                            <div className="bg-[#FFF4E5] p-2.5 rounded-lg mr-4">
                                <Tag className="w-5 h-5 text-amber-700 fill-amber-700/20" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-bold text-slate-800">Savings Plan de cómputo</h4>
                                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">SQL MI</span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1 font-medium">Optimización de Tarifas · <span className="text-slate-700 font-bold">PROD-Data</span></p>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="text-emerald-600 font-extrabold text-sm mb-2">$1,450 <span className="text-[10px] font-medium text-slate-400">/mes</span></div>
                            <button className="bg-[#0088FF] hover:bg-blue-600 text-white text-[11px] font-bold px-5 py-1.5 rounded-full shadow-sm transition-colors">Aplicar</button>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
}
