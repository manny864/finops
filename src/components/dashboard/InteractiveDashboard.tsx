"use client";
import React, { useState, useEffect } from 'react';
// @ts-ignore
import { Responsive, WidthProvider, Layout, ResponsiveLayouts as Layouts } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { GripVertical, Leaf, RotateCcw } from 'lucide-react';
import CostPieChart from '../CostPieChart';
import BudgetBurnChart from './BudgetBurnChart';
import ZombieResourcesTable from '../ZombieResourcesTable';
import CostForecastChart from './CostForecastChart';

const ResponsiveGridLayout = WidthProvider(Responsive);

const DEFAULT_LAYOUTS: Layouts = {
    lg: [
        { i: 'summary-co2', x: 0, y: 0, w: 3, h: 4 },
        { i: 'summary-savings', x: 3, y: 0, w: 3, h: 4 },
        { i: 'governance', x: 6, y: 0, w: 3, h: 8 },
        { i: 'cost-pie', x: 0, y: 4, w: 4, h: 10 },
        { i: 'budget-burn', x: 4, y: 8, w: 4, h: 10 },
        { i: 'forecast', x: 8, y: 8, w: 4, h: 10 },
        { i: 'zombie-table', x: 0, y: 18, w: 12, h: 12 }
    ],
    md: [
        { i: 'summary-co2', x: 0, y: 0, w: 5, h: 4 },
        { i: 'summary-savings', x: 5, y: 0, w: 5, h: 4 },
        { i: 'governance', x: 0, y: 4, w: 5, h: 8 },
        { i: 'cost-pie', x: 5, y: 4, w: 5, h: 10 },
        { i: 'budget-burn', x: 0, y: 12, w: 5, h: 10 },
        { i: 'forecast', x: 5, y: 12, w: 5, h: 10 },
        { i: 'zombie-table', x: 0, y: 22, w: 10, h: 12 }
    ],
    sm: [
        { i: 'summary-co2', x: 0, y: 0, w: 6, h: 4 },
        { i: 'summary-savings', x: 0, y: 4, w: 6, h: 4 },
        { i: 'governance', x: 0, y: 8, w: 6, h: 8 },
        { i: 'cost-pie', x: 0, y: 16, w: 6, h: 10 },
        { i: 'budget-burn', x: 0, y: 26, w: 6, h: 10 },
        { i: 'forecast', x: 0, y: 36, w: 6, h: 10 },
        { i: 'zombie-table', x: 0, y: 46, w: 6, h: 12 }
    ]
};

interface InteractiveDashboardProps {
    totalSavings: number;
    calculateCO2Savings: (val: number) => string;
    loading: boolean;
    dashboardData: any[];
    selectedCategory: string | null;
    setSelectedCategory: (cat: string | null) => void;
    complianceScore: number | null;
    setActiveTab: (tab: string) => void;
}

export default function InteractiveDashboard({
    totalSavings,
    calculateCO2Savings,
    loading,
    dashboardData,
    selectedCategory,
    setSelectedCategory,
    complianceScore,
    setActiveTab
}: InteractiveDashboardProps) {
    const [layouts, setLayouts] = useState<Layouts>(DEFAULT_LAYOUTS);
    const [mounted, setMounted] = useState(false);
    const [currentBreakpoint, setCurrentBreakpoint] = useState('lg');

    useEffect(() => {
        setMounted(true);
        const saved = localStorage.getItem('finops-dashboard-layout');
        if (saved) {
            try {
                setLayouts(JSON.parse(saved));
            } catch (e) {
                console.error("Error parsing saved layout", e);
            }
        }
    }, []);

    const onLayoutChange = (layout: Layout, allLayouts: Layouts) => {
        setLayouts(allLayouts);
        localStorage.setItem('finops-dashboard-layout', JSON.stringify(allLayouts));
    };

    const restoreDefault = () => {
        setLayouts(DEFAULT_LAYOUTS);
        localStorage.removeItem('finops-dashboard-layout');
    };

    const isMobile = currentBreakpoint === 'sm' || currentBreakpoint === 'xs' || currentBreakpoint === 'xxs';

    if (!mounted) return null; // Avoid hydration mismatch

    const Wrapper = ({ children, title, id }: { children: React.ReactNode, title?: string, id: string }) => (
        <div key={id} className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col h-full overflow-hidden">
            <div className="flex justify-between items-center bg-gray-50 border-b border-gray-200 px-4 py-2 shrink-0">
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{title || ''}</span>
                {!isMobile && (
                    <div className="drag-handle cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600 rounded">
                        <GripVertical className="w-4 h-4" />
                    </div>
                )}
            </div>
            <div className="p-4 flex-1 overflow-auto custom-scrollbar">
                {children}
            </div>
        </div>
    );

    return (
        <div>
            <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-800 pb-4 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
                    <p className="text-sm text-gray-500 mt-1">Visión global de rendimiento interactiva y personalizable.</p>
                </div>
                <button
                    onClick={restoreDefault}
                    className="flex items-center text-sm px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
                >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Restaurar Diseño Original
                </button>
            </div>

            <ResponsiveGridLayout
                className="layout"
                layouts={layouts}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={40}
                onLayoutChange={onLayoutChange}
                onBreakpointChange={setCurrentBreakpoint}
                isDraggable={!isMobile}
                isResizable={!isMobile}
                draggableHandle=".drag-handle"
                margin={[16, 16]}
            >
                <div key="summary-co2">
                    <div className="h-full bg-emerald-50 border border-emerald-200 rounded-lg p-6 flex flex-col items-center justify-center shadow-sm relative">
                        {!isMobile && <GripVertical className="drag-handle absolute top-2 right-2 w-5 h-5 text-emerald-300 cursor-grab active:cursor-grabbing hover:text-emerald-500" />}
                        <span className="text-sm font-bold text-emerald-700 uppercase tracking-widest mb-2 flex items-center">
                            <Leaf className="w-4 h-4 mr-2" /> Impacto Ambiental
                        </span>
                        <span className="text-5xl font-extrabold text-emerald-600">
                            {calculateCO2Savings(totalSavings)}
                        </span>
                        <span className="text-xs text-emerald-600 mt-2 font-medium">kg CO2 evitados</span>
                    </div>
                </div>

                <div key="summary-savings">
                    <div className="h-full bg-green-50 border border-green-200 rounded-lg p-6 flex flex-col items-center justify-center shadow-sm relative">
                        {!isMobile && <GripVertical className="drag-handle absolute top-2 right-2 w-5 h-5 text-green-300 cursor-grab active:cursor-grabbing hover:text-green-500" />}
                        <span className="text-sm font-bold text-green-700 uppercase tracking-widest mb-2">Ahorro Potencial Total</span>
                        <span className="text-5xl font-extrabold text-green-600">
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalSavings)}
                        </span>
                        <span className="text-xs text-green-600 mt-2 font-medium">/mes proyectado</span>
                    </div>
                </div>

                <div key="governance">
                    <Wrapper title="Estado de Gobernanza" id="governance">
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300 p-4 text-center">
                            <p className="text-sm font-medium">Score de Seguridad Financiera</p>
                            <span className={`text-5xl font-bold mt-4 ${complianceScore === -1 ? 'text-gray-400' : 'text-green-500'}`}>
                                {complianceScore === null ? '...' : complianceScore === -1 ? 'N/A' : `${complianceScore}%`}
                            </span>
                            <p className="text-xs text-gray-400 mt-4">
                                {complianceScore === -1 ? 'Añade reglas en Gestión de Etiquetas.' : 'Basado en políticas activas.'}
                            </p>
                            {complianceScore === -1 && (
                                <button 
                                    onClick={() => setActiveTab('tags')} 
                                    className="mt-4 w-full px-4 py-2 bg-[#0054A6] text-white text-xs font-semibold rounded shadow-sm hover:bg-blue-800 transition-colors"
                                >
                                    Configurar
                                </button>
                            )}
                        </div>
                    </Wrapper>
                </div>

                <div key="cost-pie">
                    <Wrapper title="Distribución de Fugas Financieras" id="cost-pie">
                        {loading ? (
                             <div className="h-full flex items-center justify-center text-gray-400 animate-pulse">Calculando métricas...</div>
                         ) : (
                             <CostPieChart data={dashboardData} onSegmentClick={(cat: string | null) => setSelectedCategory(cat)} />
                         )}
                    </Wrapper>
                </div>

                <div key="budget-burn">
                    <Wrapper title="Burn Rate (Presupuesto Vs Real)" id="budget-burn">
                        <BudgetBurnChart />
                    </Wrapper>
                </div>

                <div key="forecast">
                    <Wrapper title="Predicción a Fin de Mes" id="forecast">
                        <CostForecastChart />
                    </Wrapper>
                </div>

                <div key="zombie-table">
                    <Wrapper title="Detalle de Recursos Críticos" id="zombie-table">
                        <ZombieResourcesTable forceFilterType={selectedCategory || undefined} />
                    </Wrapper>
                </div>

            </ResponsiveGridLayout>
        </div>
    );
}
