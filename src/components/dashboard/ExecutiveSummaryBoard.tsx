"use client";
import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Loader2, AlertCircle, Info, TrendingUp, TrendingDown, MapPin, ShieldAlert, Lightbulb, ChevronRight, DollarSign, Recycle, PiggyBank, Leaf, X, PanelRightOpen, PanelRightClose, Eye, EyeOff, RotateCcw, LayoutGrid } from "lucide-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { formatResourceType } from "@/lib/resourceTypeLabels";
import { useCurrency } from "@/components/CurrencyProvider";
import CostProjectionCard from "@/components/dashboard/CostProjectionCard";
import HABreakdownCard from "@/components/dashboard/HABreakdownCard";
import ContainerAppsCard from "@/components/dashboard/ContainerAppsCard";
import LogAnalyticsCard from "@/components/dashboard/LogAnalyticsCard";
import BudgetBurnChart from "@/components/dashboard/BudgetBurnChart";
import MyPinnedWidgets from "@/components/dashboard/MyPinnedWidgets";
import FeatureGuard from "@/components/FeatureGuard";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import { Responsive, WidthProvider } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { getCookie, setCookie } from "@/lib/clientCookie";

const ResponsiveGridLayout = WidthProvider(Responsive);

const LAYOUT_STORAGE_KEY = "finops_whiteboard_layout_v1";
const HIDDEN_CARDS_STORAGE_KEY = "finops_whiteboard_hidden_cards_v1";
const GRID_COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

const LG_ITEMS = [
    { i: "budget", x: 0, y: 0, w: 4, h: 5 },
    { i: "projection", x: 4, y: 0, w: 4, h: 5 },
    { i: "ha", x: 8, y: 0, w: 4, h: 5 },
    { i: "costs", x: 0, y: 5, w: 4, h: 4 },
    { i: "trend3m", x: 4, y: 5, w: 4, h: 4 },
    { i: "top3services", x: 8, y: 5, w: 4, h: 4 },
    { i: "security", x: 0, y: 9, w: 6, h: 5 },
    { i: "governance", x: 6, y: 9, w: 6, h: 5 },
    { i: "threats", x: 0, y: 14, w: 4, h: 4 },
    { i: "locations", x: 4, y: 14, w: 4, h: 4 },
    { i: "inventory", x: 8, y: 14, w: 4, h: 4 },
    { i: "advisorRec", x: 0, y: 18, w: 4, h: 3 },
    { i: "recTrend", x: 4, y: 18, w: 4, h: 3 },
    { i: "costGroups", x: 8, y: 18, w: 4, h: 3 },
    { i: "containerApps", x: 0, y: 21, w: 6, h: 5 },
    { i: "logAnalytics", x: 6, y: 21, w: 6, h: 5 },
];

const CARD_METADATA: Record<string, { label: string; description: string }> = {
    budget: { label: "Tenant Budget Burn", description: "Consumo acumulado y velocidad de gasto contra presupuestos" },
    projection: { label: "Proyección de Gastos", description: "Pronóstico de costos con tendencia acumulada" },
    ha: { label: "Alta Disponibilidad (HA)", description: "Recomendaciones de arquitectura resiliente" },
    costs: { label: "Resumen de Costos FY", description: "Comparativa de ejercicio fiscal actual vs anterior" },
    trend3m: { label: "Tendencia Últimos 3 Meses", description: "Evolución histórica de gasto trimestral" },
    top3services: { label: "TOP 3 Servicios de Mayor Gasto", description: "Servicios con mayor impacto presupuestario" },
    security: { label: "Postura de Seguridad y Vulnerabilidades", description: "Calificación y hallazgos críticos de seguridad" },
    governance: { label: "Gobernanza y Etiquetado (Tags)", description: "Cumplimiento de tags y recursos no etiquetados" },
    threats: { label: "Top Categorías de Amenazas", description: "Eventos de seguridad y amenazas identificadas" },
    locations: { label: "Top Regiones de Despliegue", description: "Distribución geográfica de infraestructura" },
    inventory: { label: "Top Inventario por Tipo", description: "Recursos más desplegados en la nube" },
    advisorRec: { label: "Recomendaciones Azure Advisor", description: "Optimizaciones sugeridas por Microsoft" },
    recTrend: { label: "Tendencia de Recomendaciones y Anomalías", description: "Evolución mensual de sugerencias y desvíos" },
    costGroups: { label: "Top Cost Groups / Unidades de Negocio", description: "Distribución de costo por área de negocio" },
    containerApps: { label: "Infraestructura de Contenedores", description: "Eficiencia y recursos en Container Apps" },
    logAnalytics: { label: "Ingesta Log Analytics", description: "Volumen y gasto de retención de logs" },
};

function deriveLayoutForCols(baseItems: typeof LG_ITEMS, cols: number, baseCols = 12) {
    if (cols <= 4) {
        let y = 0;
        return baseItems.map((item) => {
            const laidOut = { ...item, x: 0, y, w: cols, h: item.h };
            y += item.h;
            return laidOut;
        });
    }
    const scale = cols / baseCols;
    return baseItems.map((item) => ({
        ...item,
        x: Math.max(0, Math.min(cols - 1, Math.round(item.x * scale))),
        w: Math.max(1, Math.min(cols, Math.round(item.w * scale))),
    }));
}

const DEFAULT_LAYOUT = {
    lg: LG_ITEMS,
    md: deriveLayoutForCols(LG_ITEMS, GRID_COLS.md),
    sm: deriveLayoutForCols(LG_ITEMS, GRID_COLS.sm),
    xs: deriveLayoutForCols(LG_ITEMS, GRID_COLS.xs),
    xxs: deriveLayoutForCols(LG_ITEMS, GRID_COLS.xxs),
};

const COLORS = {
    high: "#dc2626",
    medium: "#f59e0b",
    low: "#22c55e",
    blue: "#0054A6",
    cyan: "#00AEEF",
    violet: "#8b5cf6",
};

function Card({ title, onClose, className = "", children }: { title?: string; onClose?: () => void; className?: string; children: React.ReactNode }) {
    return (
        <div className={`drag-handle cursor-move bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col h-full overflow-auto relative group ${className}`}>
            {onClose && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    className="absolute top-3 right-3 p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-all z-20 cursor-pointer"
                    title="Cerrar tarjeta de la pizarra"
                >
                    <X className="w-4 h-4 text-gray-800 dark:text-gray-200 hover:text-white stroke-[2.5]" />
                </button>
            )}
            {title && <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3 pr-6">{title}</h3>}
            {children}
        </div>
    );
}

function KpiCard({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub: string; tone: string }) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
                <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 truncate">{label}</p>
                <p className="text-xl font-extrabold text-slate-800 dark:text-slate-100 truncate">{value}</p>
                <p className="text-[11px] text-slate-400 truncate">{sub}</p>
            </div>
        </div>
    );
}

export default function ExecutiveSummaryBoard() {
    const t = useTranslations("WhiteBoard");
    const locale = useLocale();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();

    const [drawerOpen, setDrawerOpen] = useState(false);
    const [hiddenCards, setHiddenCards] = useState<string[]>([]);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(json.error || "Error al cargar datos");
        }
        return res.json();
    };

    const canFetch = !!selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id));

    const { data, error, isLoading } = useSWR(
        canFetch ? `/api/intelligence/whiteboard?tenantId=${selectedTenant.id}&locale=${locale}` : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const summarySub = "All";
    const { data: summaryData, isLoading: summaryLoading } = useSWR(
        canFetch ? `/api/dashboard/summary?tenantId=${selectedTenant!.id}&subscriptionId=${summarySub}` : null,
        fetcher,
        { revalidateOnFocus: false }
    );
    const totalSavings = Number(summaryData?.totalSavings || 0);
    const costIsPartial = !summaryLoading && summaryData?.costSource === 'snapshot';

    const [layouts, setLayouts] = useState<any>(null);
    useEffect(() => {
        const raw = getCookie(LAYOUT_STORAGE_KEY) || localStorage.getItem(LAYOUT_STORAGE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                Object.keys(DEFAULT_LAYOUT).forEach((bp: string) => {
                    if (!parsed[bp]) {
                        parsed[bp] = DEFAULT_LAYOUT[bp as keyof typeof DEFAULT_LAYOUT];
                        return;
                    }
                    const existing = new Set((parsed[bp] || []).map((l: any) => l.i));
                    LG_ITEMS.forEach((item) => {
                        if (!existing.has(item.i)) parsed[bp].push(item);
                    });
                });
                setLayouts(parsed);
            } catch {
                setLayouts(DEFAULT_LAYOUT);
            }
        } else {
            setLayouts(DEFAULT_LAYOUT);
        }

        const hiddenRaw = getCookie(HIDDEN_CARDS_STORAGE_KEY) || localStorage.getItem(HIDDEN_CARDS_STORAGE_KEY);
        if (hiddenRaw) {
            try {
                const parsedHidden = JSON.parse(hiddenRaw);
                if (Array.isArray(parsedHidden)) setHiddenCards(parsedHidden);
            } catch {}
        }
    }, []);

    const persistTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const persistLayouts = useCallback((allLayouts: any) => {
        if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = setTimeout(() => {
            const serialized = JSON.stringify(allLayouts);
            setCookie(LAYOUT_STORAGE_KEY, serialized);
            localStorage.setItem(LAYOUT_STORAGE_KEY, serialized);
        }, 400);
    }, []);

    const onLayoutChange = (_layout: any, allLayouts: any) => {
        setLayouts(allLayouts);
        persistLayouts(allLayouts);
    };

    const handleHideCard = (cardId: string) => {
        setHiddenCards((prev) => {
            if (prev.includes(cardId)) return prev;
            const updated = [...prev, cardId];
            const serialized = JSON.stringify(updated);
            setCookie(HIDDEN_CARDS_STORAGE_KEY, serialized);
            localStorage.setItem(HIDDEN_CARDS_STORAGE_KEY, serialized);
            return updated;
        });
    };

    const handleRestoreCard = (cardId: string) => {
        setHiddenCards((prev) => {
            const updated = prev.filter((id) => id !== cardId);
            const serialized = JSON.stringify(updated);
            setCookie(HIDDEN_CARDS_STORAGE_KEY, serialized);
            localStorage.setItem(HIDDEN_CARDS_STORAGE_KEY, serialized);
            return updated;
        });
    };

    const handleRestoreAllCards = () => {
        setHiddenCards([]);
        setCookie(HIDDEN_CARDS_STORAGE_KEY, JSON.stringify([]));
        localStorage.setItem(HIDDEN_CARDS_STORAGE_KEY, JSON.stringify([]));
    };

    const handleBudgetResize = useCallback((newH: number) => {
        setLayouts((prev: any) => {
            if (!prev || !prev.lg) return prev;
            let changed = false;
            const nextLayouts = { ...prev };
            Object.keys(nextLayouts).forEach((bp) => {
                nextLayouts[bp] = nextLayouts[bp].map((l: any) => {
                    if (l.i === "budget" && l.h !== newH) {
                        changed = true;
                        return { ...l, h: newH };
                    }
                    return l;
                });
            });
            if (!changed) return prev;
            return nextLayouts;
        });
    }, []);

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Cargando White Board...</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName="White Board Ejecutivo" />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data || !layouts) return null;

    const { costs, security, vulnerabilities, governance, top3ThreatCategories, top5Locations, top5Inventory, recommendations, costAnomalyTrend, top5CostGroups } = data;
    const untagged = governance?.untagged || {};
    const complianceWins: Array<{ name: string; pct: number }> = governance?.top3ComplianceWins || [];
    const vulnData = [
        { name: t("high"), value: vulnerabilities?.high || 0, color: COLORS.high },
        { name: t("medium"), value: vulnerabilities?.medium || 0, color: COLORS.medium },
        { name: t("low"), value: vulnerabilities?.low || 0, color: COLORS.low },
    ];
    const top3Services = (costs?.top3Services || []) as Array<{ name: string; cost: number }>;
    const servicesBarData = [
        ...top3Services.map((s) => ({ name: s.name, cost: s.cost })),
        { name: t("total"), cost: top3Services.reduce((sum, s) => sum + s.cost, 0) },
    ];
    const costUp = (costs?.costChangePct || 0) >= 0;
    const top5InventoryData = ((top5Inventory || []) as Array<{ name: string; count: number }>).map((r) => ({
        label: formatResourceType(r.name),
        fullName: r.name,
        count: r.count,
    }));

    const isCardVisible = (cardId: string) => !hiddenCards.includes(cardId);

    return (
        <div className="w-full space-y-6 relative">
            {data.mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm">{t("mock_data_notice")}</div>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                <KpiCard
                    icon={DollarSign}
                    label={t("kpi_current_cost")}
                    value={summaryLoading ? "…" : format(Number(summaryData?.actualCost || 0))}
                    sub={costIsPartial ? t("kpi_cost_partial") : t("kpi_current_cost_sub")}
                    tone={costIsPartial
                        ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
                        : "bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400"}
                />
                <KpiCard
                    icon={TrendingUp}
                    label={t("kpi_projected_cost")}
                    value={summaryLoading ? "…" : format(Number(summaryData?.projectedCost || 0))}
                    sub={costIsPartial ? t("kpi_cost_partial") : t("kpi_projected_cost_sub")}
                    tone={costIsPartial
                        ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
                        : "bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400"}
                />
                <KpiCard
                    icon={Recycle}
                    label={t("kpi_zombie_resources")}
                    value={summaryLoading ? "…" : String(summaryData?.zombieCount ?? 0)}
                    sub={t("kpi_zombie_resources_sub")}
                    tone="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
                />
                <KpiCard
                    icon={PiggyBank}
                    label={t("kpi_potential_savings")}
                    value={summaryLoading ? "…" : format(totalSavings)}
                    sub={t("kpi_potential_savings_sub")}
                    tone="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                />
                <KpiCard
                    icon={Leaf}
                    label={t("kpi_environmental_impact")}
                    value={summaryLoading ? "…" : summaryData?.environmentalImpact == null ? "—" : `${summaryData.environmentalImpact} kg`}
                    sub={t("kpi_environmental_impact_sub")}
                    tone="bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400"
                />
            </div>

            <MyPinnedWidgets />

            <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
                <p className="text-[11px] text-slate-400">{t("drag_resize_hint")}</p>
                <button
                    onClick={() => setDrawerOpen(true)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:border-brand hover:text-brand transition-all shadow-xs"
                >
                    <PanelRightOpen className="w-4 h-4 text-brand-bright" />
                    <span>Personalizar Tarjetas {hiddenCards.length > 0 && `(${hiddenCards.length} ocultas)`}</span>
                </button>
            </div>

            <ResponsiveGridLayout
                className="layout"
                layouts={layouts}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={GRID_COLS}
                rowHeight={80}
                onLayoutChange={onLayoutChange}
                draggableHandle=".drag-handle"
            >
                {isCardVisible("budget") && (
                    <div key="budget">
                        <div className="drag-handle cursor-move h-full w-full relative group">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleHideCard("budget"); }}
                                className="absolute top-3 right-3 p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-all z-20 cursor-pointer"
                                title="Cerrar tarjeta de la pizarra"
                            >
                                <X className="w-4 h-4 text-gray-800 dark:text-gray-200 hover:text-white stroke-[2.5]" />
                            </button>
                            <BudgetBurnChart onHeightChange={handleBudgetResize} />
                        </div>
                    </div>
                )}

                {isCardVisible("projection") && (
                    <div key="projection">
                        <FeatureGuard requiredTier="Enterprise" featureName={t("cost_projection_feature_name")} className="h-full w-full drag-handle cursor-move relative group">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleHideCard("projection"); }}
                                className="absolute top-3 right-3 p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-all z-20 cursor-pointer"
                                title="Cerrar tarjeta de la pizarra"
                            >
                                <X className="w-4 h-4 text-gray-800 dark:text-gray-200 hover:text-white stroke-[2.5]" />
                            </button>
                            <CostProjectionCard showFullPageLink />
                        </FeatureGuard>
                    </div>
                )}

                {isCardVisible("ha") && (
                    <div key="ha">
                        <FeatureGuard requiredTier="Business" featureName={t("ha_feature_name")} className="h-full w-full drag-handle cursor-move relative group">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleHideCard("ha"); }}
                                className="absolute top-3 right-3 p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-all z-20 cursor-pointer"
                                title="Cerrar tarjeta de la pizarra"
                            >
                                <X className="w-4 h-4 text-gray-800 dark:text-gray-200 hover:text-white stroke-[2.5]" />
                            </button>
                            <HABreakdownCard />
                        </FeatureGuard>
                    </div>
                )}

                {isCardVisible("costs") && (
                    <div key="costs">
                        <Card title={t("costs")} onClose={() => handleHideCard("costs")}>
                            <p className="text-[11px] text-slate-400 mb-1">{t("current_fy_cost")}</p>
                            <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{format(costs?.currentFYCost)}</p>

                            <p className="text-[11px] text-slate-400 mt-4 mb-1">{t("cost_projected")}</p>
                            <div className="flex items-center gap-2">
                                <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{format(costs?.costProjected)}</p>
                                <span className={`inline-flex items-center gap-1 text-xs font-bold ${costUp ? "text-red-600" : "text-emerald-600"}`}>
                                    {costUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                    {Math.abs(costs?.costChangePct || 0)}%
                                </span>
                            </div>

                            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-800">
                                <p className="text-[11px] text-slate-400 mb-1">{t("previous_fy")}</p>
                                <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{format(costs?.previousFYCost)}</p>
                            </div>
                        </Card>
                    </div>
                )}

                {isCardVisible("trend3m") && (
                    <div key="trend3m">
                        <Card title={t("last_3_months_trend")} onClose={() => handleHideCard("trend3m")}>
                            <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                                <LineChart data={costs?.last3MonthsTrend || []}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={45} />
                                    <Tooltip formatter={(v: any) => format(Number(v))} />
                                    <Line type="monotone" dataKey="cost" stroke={COLORS.blue} strokeWidth={2} dot={{ r: 3 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </Card>
                    </div>
                )}

                {isCardVisible("top3services") && (
                    <div key="top3services">
                        <Card title={t("top3_services")} onClose={() => handleHideCard("top3services")}>
                            <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                                <BarChart data={servicesBarData} layout="vertical" margin={{ left: 8, right: 16 }}>
                                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                                    <Tooltip formatter={(v: any) => format(Number(v))} />
                                    <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                                        {servicesBarData.map((entry, i) => (
                                            <Cell key={i} fill={i === servicesBarData.length - 1 ? COLORS.cyan : COLORS.blue} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </Card>
                    </div>
                )}

                {isCardVisible("security") && (
                    <div key="security">
                        <Card title={t("security_vulnerabilities")} onClose={() => handleHideCard("security")}>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-[11px] text-slate-400 mb-1">{t("security")}</p>
                                    <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{security?.pct}%</p>
                                </div>
                                <div>
                                    <p className="text-[11px] text-slate-400 mb-1">{t("vulnerabilities")}</p>
                                    <ResponsiveContainer width="100%" height={100}>
                                        <PieChart>
                                            <Pie data={vulnData} dataKey="value" nameKey="name" innerRadius={20} outerRadius={40}>
                                                {vulnData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                            </Pie>
                                            <Tooltip />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </Card>
                    </div>
                )}

                {isCardVisible("governance") && (
                    <div key="governance">
                        <Card title={t("governance")} onClose={() => handleHideCard("governance")}>
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <p className="text-[11px] text-slate-400 mb-1">{t("untagged_resources_count")}</p>
                                    <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{untagged.count}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] text-slate-400 mb-1">{t("untagged_resources_cost")}</p>
                                    <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{format(untagged.cost)}</p>
                                </div>
                            </div>
                        </Card>
                    </div>
                )}

                {isCardVisible("threats") && (
                    <div key="threats">
                        <Card title={t("top3_threat_categories")} onClose={() => handleHideCard("threats")}>
                            <div className="flex flex-col gap-3">
                                {(top3ThreatCategories || []).map((cat: any, i: number) => (
                                    <div key={i}>
                                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">{cat.name}</p>
                                        <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
                                            <div className="h-2 rounded-full bg-red-500" style={{ width: `${(cat.high / (cat.total || 1)) * 100}%` }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </div>
                )}

                {isCardVisible("locations") && (
                    <div key="locations">
                        <Card title={t("top5_locations")} onClose={() => handleHideCard("locations")}>
                            <div className="flex flex-col gap-2">
                                {(top5Locations || []).map((loc: any, i: number) => {
                                    const max = Math.max(...(top5Locations || []).map((l: any) => l.count), 1);
                                    return (
                                        <div key={i} className="flex items-center gap-2">
                                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                            <span className="text-xs text-slate-600 dark:text-slate-300 w-24 truncate">{loc.name}</span>
                                            <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-2.5">
                                                <div className="h-2.5 rounded-full bg-cyan-500" style={{ width: `${(loc.count / max) * 100}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </Card>
                    </div>
                )}

                {isCardVisible("inventory") && (
                    <div key="inventory">
                        <Card title={t("top5_inventory")} onClose={() => handleHideCard("inventory")}>
                            <ResponsiveContainer width="100%" height="100%" minHeight={140}>
                                <BarChart data={top5InventoryData} layout="vertical" margin={{ left: 8, right: 16 }}>
                                    <XAxis type="number" tick={{ fontSize: 10 }} />
                                    <YAxis type="category" dataKey="label" tick={{ fontSize: 9 }} width={130} />
                                    <Tooltip labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.fullName || ""} />
                                    <Bar dataKey="count" fill={COLORS.blue} radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </Card>
                    </div>
                )}

                {isCardVisible("advisorRec") && (
                    <div key="advisorRec">
                        <Card title={t("advisor_recommendations")} onClose={() => handleHideCard("advisorRec")}>
                            <Link href={`/${locale}/advisor`} className="h-full block">
                                <p className="text-2xl font-extrabold text-slate-800">{recommendations?.open}</p>
                                <p className="text-xs text-slate-400">{t("open_recommendations")}</p>
                            </Link>
                        </Card>
                    </div>
                )}

                {isCardVisible("recTrend") && (
                    <div key="recTrend">
                        <Card title={t("recommendation_trend")} onClose={() => handleHideCard("recTrend")}>
                            <ResponsiveContainer width="100%" height={90}>
                                <LineChart data={recommendations?.trend || []}>
                                    <Line type="monotone" dataKey="count" stroke={COLORS.blue} />
                                </LineChart>
                            </ResponsiveContainer>
                        </Card>
                    </div>
                )}

                {isCardVisible("costGroups") && (
                    <div key="costGroups">
                        <FeatureGuard requiredTier="Business" featureName="Cost Groups" className="h-full w-full drag-handle cursor-move relative group">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleHideCard("costGroups"); }}
                                className="absolute top-3 right-3 p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-all z-20 cursor-pointer"
                                title="Cerrar tarjeta de la pizarra"
                            >
                                <X className="w-4 h-4 text-gray-800 dark:text-gray-200 hover:text-white stroke-[2.5]" />
                            </button>
                            <Card title={t("top5_cost_groups")}>
                                <ResponsiveContainer width="100%" height="100%" minHeight={100}>
                                    <BarChart data={top5CostGroups?.groups || []}>
                                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                                        <Bar dataKey="cost" fill={COLORS.cyan} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </Card>
                        </FeatureGuard>
                    </div>
                )}

                {isCardVisible("containerApps") && (
                    <div key="containerApps">
                        <FeatureGuard requiredTier="Business" featureName={t("container_apps_feature_name")} className="h-full w-full drag-handle cursor-move relative group">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleHideCard("containerApps"); }}
                                className="absolute top-3 right-3 p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-all z-20 cursor-pointer"
                                title="Cerrar tarjeta de la pizarra"
                            >
                                <X className="w-4 h-4 text-gray-800 dark:text-gray-200 hover:text-white stroke-[2.5]" />
                            </button>
                            <ContainerAppsCard />
                        </FeatureGuard>
                    </div>
                )}

                {isCardVisible("logAnalytics") && (
                    <div key="logAnalytics">
                        <FeatureGuard requiredTier="Business" featureName={t("log_analytics_feature_name")} className="h-full w-full drag-handle cursor-move relative group">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleHideCard("logAnalytics"); }}
                                className="absolute top-3 right-3 p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-all z-20 cursor-pointer"
                                title="Cerrar tarjeta de la pizarra"
                            >
                                <X className="w-4 h-4 text-gray-800 dark:text-gray-200 hover:text-white stroke-[2.5]" />
                            </button>
                            <LogAnalyticsCard />
                        </FeatureGuard>
                    </div>
                )}
            </ResponsiveGridLayout>

            {drawerOpen && (
                <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
                    <div className="w-full max-w-md bg-white dark:bg-slate-900 h-full shadow-2xl border-l border-gray-200 dark:border-slate-800 flex flex-col justify-between animate-in slide-in-from-right duration-300">
                        <div>
                            <div className="p-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-brand-deep/10 text-brand-deep flex items-center justify-center">
                                        <LayoutGrid className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Personalizar Tarjetas de la Pizarra</h3>
                                        <p className="text-xs text-slate-500">Gestioná la visibilidad de los paneles en tu Whiteboard</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setDrawerOpen(false)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <X className="w-5 h-5 text-gray-800 dark:text-gray-200 hover:text-white stroke-[2.5]" />
                                </button>
                            </div>

                            <div className="p-5 space-y-3 max-h-[calc(100vh-140px)] overflow-y-auto">
                                {hiddenCards.length > 0 && (
                                    <div className="mb-4 flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 p-3 rounded-xl border border-amber-200 dark:border-amber-800/50">
                                        <span className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                                            {hiddenCards.length} {hiddenCards.length === 1 ? 'tarjeta oculta' : 'tarjetas ocultas'}
                                        </span>
                                        <button
                                            onClick={handleRestoreAllCards}
                                            className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                                        >
                                            <RotateCcw className="w-3.5 h-3.5" /> Restaurar todas
                                        </button>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    {LG_ITEMS.map((item) => {
                                        const meta = CARD_METADATA[item.i] || { label: item.i, description: "" };
                                        const isHidden = hiddenCards.includes(item.i);

                                        return (
                                            <div
                                                key={item.i}
                                                className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                                                    isHidden
                                                        ? "bg-slate-50 dark:bg-slate-950/50 border-gray-200 dark:border-slate-800 opacity-60"
                                                        : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 shadow-xs"
                                                }`}
                                            >
                                                <div className="min-w-0 pr-3">
                                                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{meta.label}</p>
                                                    {meta.description && <p className="text-[11px] text-slate-400 truncate">{meta.description}</p>}
                                                </div>
                                                <button
                                                    onClick={() => (isHidden ? handleRestoreCard(item.i) : handleHideCard(item.i))}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                                                        isHidden
                                                            ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                                                            : "bg-gray-100 hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-300"
                                                    }`}
                                                >
                                                    {isHidden ? (
                                                        <>
                                                            <Eye className="w-3.5 h-3.5" /> Mostrar
                                                        </>
                                                    ) : (
                                                        <>
                                                            <EyeOff className="w-3.5 h-3.5" /> Ocultar
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="p-4 border-t border-gray-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end">
                            <button
                                onClick={() => setDrawerOpen(false)}
                                className="px-5 py-2 bg-brand-deep text-white font-bold rounded-lg text-xs hover:bg-brand-bright transition-colors shadow-sm"
                            >
                                Listo
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
