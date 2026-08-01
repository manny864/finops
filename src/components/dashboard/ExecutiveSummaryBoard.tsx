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
import { Loader2, AlertCircle, Info, TrendingUp, TrendingDown, MapPin, ShieldAlert, Lightbulb, ChevronRight, DollarSign, Recycle, PiggyBank, Leaf } from "lucide-react";
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

// Layout persistido de las tarjetas resizeables/reubicables — separado del
// (ya eliminado) key del viejo Dashboard General para no heredar un layout
// con items que ya no existen. Se persiste por cookie (sobrevive a un
// localStorage.clear() del usuario); localStorage queda como fallback de
// lectura para migrar preferencias guardadas antes de este cambio.
const LAYOUT_STORAGE_KEY = "finops_whiteboard_layout_v1";
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

// Deriva un layout válido para un breakpoint angosto a partir del de `lg`
// (12 columnas). Debajo de 6 columnas apilamos todo a ancho completo — con
// tarjetas de hasta w:8 en el layout base, cualquier intento de conservar
// varias columnas en pantallas chicas termina en overflow horizontal o
// tarjetas amontonadas ilegibles; apilar es lo único que se ve bien en un
// teléfono. De 6 columnas para arriba escalamos ancho/posición
// proporcionalmente y dejamos que el compactado vertical de la librería
// resuelva las colisiones que queden.
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

function Card({ title, className = "", children }: { title?: string; className?: string; children: React.ReactNode }) {
    return (
        <div className={`drag-handle cursor-move bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col h-full overflow-auto ${className}`}>
            {title && <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">{title}</h3>}
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

    // KPIs (mismos 4 que el Dashboard General: costo actual, recursos
    // zombies, ahorro potencial e impacto ambiental) — se reusa
    // /api/dashboard/summary en vez de duplicar su lógica de auditoría.
    // El White Board es un resumen EJECUTIVO del tenant completo: las ~13
    // tarjetas de abajo se alimentan de /api/intelligence/whiteboard, que no
    // acepta subscriptionId y siempre agrega todo el tenant (getCostFigures y
    // compañía no filtran por suscripción).
    //
    // Antes esta fila pasaba `selectedSubscription`, así que con una suscripción
    // puntual elegida la mitad de arriba del board mostraba UNA suscripción y la
    // mitad de abajo el tenant entero — dos respuestas a preguntas distintas, sin
    // nada en pantalla que lo dijera. Se fuerza el alcance del tenant para que
    // todo el board hable del mismo universo; el drill-down por suscripción vive
    // en las páginas dedicadas (/intelligence/billing, cost-projection, etc.).
    const summarySub = "All";
    const { data: summaryData, isLoading: summaryLoading } = useSWR(
        canFetch ? `/api/dashboard/summary?tenantId=${selectedTenant!.id}&subscriptionId=${summarySub}` : null,
        fetcher,
        { revalidateOnFocus: false }
    );
    // totalSavings viene directo del backend (mismo valor que sum(dashboardData.potentialSavings)
    // en datos reales — ver /api/dashboard/summary — pero en mock dashboardData es una lista de
    // ejemplo fija que no escala por tier, mientras que este campo sí).
    const totalSavings = Number(summaryData?.totalSavings || 0);
    // 'snapshot' = el costo salió de CostSnapshots porque la consulta a Cost
    // Management falló (429). Puede estar incompleto: se marca, no se disimula.
    const costIsPartial = !summaryLoading && summaryData?.costSource === 'snapshot';

    // Layout de tarjetas resizeables/reubicables — persistido por cookie
    // (Max-Age 1 año), con localStorage como fallback de lectura para migrar
    // preferencias guardadas por la versión anterior de este componente.
    const [layouts, setLayouts] = useState<any>(null);
    useEffect(() => {
        const raw = getCookie(LAYOUT_STORAGE_KEY) || localStorage.getItem(LAYOUT_STORAGE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                // Migración: agregar tarjetas nuevas (o breakpoints nuevos, ver
                // fix de responsive) si el layout guardado no las incluye todavía.
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
    }, []);

    // Debounce de la escritura: onLayoutChange dispara en cada frame durante
    // un drag/resize — escribir la cookie en cada uno sería ruidoso y
    // costoso (la cookie viaja en cada request de la pestaña). El estado en
    // memoria (setLayouts) sí se actualiza al instante para que el grid no
    // se sienta con lag.
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

    return (
        <div className="w-full space-y-6">
            {data.mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm">{t("mock_data_notice")}</div>
                </div>
            )}

            {/* KPIs — mismos del Dashboard General */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                <KpiCard
                    icon={DollarSign}
                    label={t("kpi_current_cost")}
                    value={summaryLoading ? "…" : format(Number(summaryData?.actualCost || 0))}
                    /* costSource === 'snapshot': el número viene del snapshot en base
                       porque Cost Management throttleó, así que puede estar
                       incompleto. Se avisa en vez de presentarlo como el gasto real
                       del mes — mostrar un parcial como definitivo es lo que hacía
                       que el KPI no cerrara con el portal sin que nadie lo notara. */
                    sub={costIsPartial ? t("kpi_cost_partial") : t("kpi_current_cost_sub")}
                    tone={costIsPartial
                        ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
                        : "bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400"}
                />
                <KpiCard
                    icon={TrendingUp}
                    label={t("kpi_projected_cost")}
                    value={summaryLoading ? "…" : format(Number(summaryData?.projectedCost || 0))}
                    /* La proyección se deriva de actualCost, así que hereda el aviso. */
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
                    /* kgCO2e evitado al limpiar los discos zombie detectados por Green
                       FinOps (Resource Graph) — antes era una fórmula inventada sobre
                       totalSavings sin relación con emisiones reales. `null` = no se
                       pudo calcular (sin credenciales / Resource Graph no respondió),
                       se muestra "—" en vez de fingir un 0. */
                    value={summaryLoading ? "…" : summaryData?.environmentalImpact == null ? "—" : `${summaryData.environmentalImpact} kg`}
                    sub={t("kpi_environmental_impact_sub")}
                    tone="bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400"
                />
            </div>

            {/* "Mi Dashboard" — pineo de tarjetas, vivía en el Dashboard General
                (ruta "/", eliminada del Sidebar al pasar White Board a cumplir ese
                rol). Mismo componente, sin cambios: cada usuario sigue viendo sus
                propios pins acá. */}
            <MyPinnedWidgets />

            {/* Tarjetas resizeables/reubicables (arrastrar desde el título,
                redimensionar desde la esquina inferior derecha) — mismo patrón
                react-grid-layout que tenía el viejo Dashboard General. */}
            <p className="text-[11px] text-slate-400 -mb-2">{t("drag_resize_hint")}</p>
            <ResponsiveGridLayout
                className="layout"
                layouts={layouts}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={GRID_COLS}
                rowHeight={80}
                onLayoutChange={onLayoutChange}
                draggableHandle=".drag-handle"
            >
                <div key="budget">
                    <div className="drag-handle cursor-move h-full w-full">
                        <BudgetBurnChart onHeightChange={handleBudgetResize} />
                    </div>
                </div>

                <div key="projection">
                    <FeatureGuard requiredTier="Enterprise" featureName={t("cost_projection_feature_name")} className="h-full w-full drag-handle cursor-move">
                        <CostProjectionCard showFullPageLink />
                    </FeatureGuard>
                </div>

                <div key="ha">
                    <FeatureGuard requiredTier="Business" featureName={t("ha_feature_name")} className="h-full w-full drag-handle cursor-move">
                        <HABreakdownCard />
                    </FeatureGuard>
                </div>

                <div key="costs">
                    <Card title={t("costs")}>
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

                <div key="trend3m">
                    <Card title={t("last_3_months_trend")}>
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

                <div key="top3services">
                    <Card title={t("top3_services")}>
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

                <div key="security">
                    <Card title={t("security_vulnerabilities")}>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-[11px] text-slate-400 mb-1">{t("security")}</p>
                                <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{security?.pct}%</p>
                                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-800">
                                    <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{security?.withMfa} {t("of")} {security?.total}</p>
                                </div>
                            </div>
                            <div>
                                <p className="text-[11px] text-slate-400 mb-1">{t("vulnerabilities")}</p>
                                <ResponsiveContainer width="100%" height={130}>
                                    <PieChart>
                                        <Pie data={vulnData} dataKey="value" nameKey="name" innerRadius={28} outerRadius={50}>
                                            {vulnData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                        </Pie>
                                        <Tooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="flex justify-center gap-3 text-[10px] mt-1">
                                    {vulnData.map((v) => (
                                        <span key={v.name} className="flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-full inline-block" style={{ background: v.color }} />
                                            {v.name} {v.value}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>

                <div key="governance">
                    <Card title={t("governance")}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <p className="text-[11px] text-slate-400 mb-2">{t("untagged_resources_trend")}</p>
                                <ResponsiveContainer width="100%" height={100}>
                                    <LineChart data={untagged.trend || []}>
                                        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                                        <Tooltip formatter={(v: any) => format(Number(v))} />
                                        <Line type="monotone" dataKey="cost" stroke={COLORS.violet} strokeWidth={2} dot={{ r: 2 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="grid grid-rows-2 gap-3">
                                <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3">
                                    <p className="text-[10px] text-slate-400 mb-1">{t("untagged_resources_count")}</p>
                                    <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{untagged.count}</p>
                                    <p className="text-[11px] text-slate-500">{untagged.countPct}%</p>
                                </div>
                                <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3">
                                    <p className="text-[10px] text-slate-400 mb-1">{t("untagged_resources_cost")}</p>
                                    <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{format(untagged.cost)}</p>
                                    <p className="text-[11px] text-slate-500">{untagged.costPct}% {t("monthly_cost_pct")}</p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-800">
                            <p className="text-[11px] text-slate-400 mb-2">{t("top3_compliance_wins")}</p>
                            <ResponsiveContainer width="100%" height={110}>
                                <BarChart data={complianceWins}>
                                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                                    <YAxis hide domain={[0, 100]} />
                                    <Tooltip formatter={(v: any) => `${v}%`} />
                                    <Bar dataKey="pct" fill={COLORS.blue} radius={[4, 4, 0, 0]} label={{ position: "top", fontSize: 11, formatter: (v: any) => `${v}%` }} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>
                </div>

                <div key="threats">
                    <Card title={t("top3_threat_categories")}>
                        <div className="flex flex-col gap-3">
                            {(top3ThreatCategories || []).map((cat: any, i: number) => (
                                <div key={i}>
                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate mb-1" title={cat.name}>
                                        {(() => {
                                            const key = cat.name.toLowerCase().replace(/ /g, '_');
                                            // Usamos try-catch interno por si falla la traducción en tiempo de ejecución (si no existe la key).
                                            try {
                                                const translated = t(`threat_cats.${key}` as any);
                                                return translated || cat.name;
                                            } catch {
                                                return cat.name;
                                            }
                                        })()}
                                    </p>
                                    <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-800">
                                        {cat.high > 0 && <div style={{ width: `${(cat.high / cat.total) * 100}%`, background: COLORS.high }} title={`${t("high")}: ${cat.high}`} />}
                                        {cat.medium > 0 && <div style={{ width: `${(cat.medium / cat.total) * 100}%`, background: COLORS.medium }} title={`${t("medium")}: ${cat.medium}`} />}
                                        {cat.low > 0 && <div style={{ width: `${(cat.low / cat.total) * 100}%`, background: COLORS.low }} title={`${t("low")}: ${cat.low}`} />}
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1">{cat.total} {t("total").toLowerCase()}</p>
                                </div>
                            ))}
                            {(!top3ThreatCategories || top3ThreatCategories.length === 0) && (
                                <p className="text-sm text-slate-400 flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> {t("no_findings")}</p>
                            )}
                        </div>
                    </Card>
                </div>

                <div key="locations">
                    <Card title={t("top5_locations")}>
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
                                        <span className="text-xs font-semibold text-slate-500 w-10 text-right">{loc.count}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                </div>

                <div key="inventory">
                    <Card title={t("top5_inventory")}>
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

                <div key="advisorRec">
                    <Card title={t("advisor_recommendations")}>
                        <Link
                            href={`/${locale}/advisor`}
                            className="grid grid-cols-2 gap-3 h-full group -m-1 p-1 rounded-lg transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/40"
                        >
                            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 flex flex-col justify-center">
                                <p className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                                    {t("open_recommendations")}
                                    <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </p>
                                <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                    <Lightbulb className="w-5 h-5 text-amber-500" />{recommendations?.open}
                                </p>
                            </div>
                            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 flex flex-col justify-center">
                                <p className="text-[10px] text-slate-400 mb-1">{t("potential_cost_savings")}</p>
                                <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{format(recommendations?.potentialCostSavings)}</p>
                            </div>
                        </Link>
                    </Card>
                </div>

                <div key="recTrend">
                    <Card>
                        <p className="text-[11px] text-slate-400 mb-1">{t("recommendation_trend")}</p>
                        <ResponsiveContainer width="100%" height={90}>
                            <LineChart data={recommendations?.trend || []}>
                                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                                <Tooltip />
                                <Line type="monotone" dataKey="count" stroke={COLORS.blue} strokeWidth={2} dot={{ r: 2 }} />
                            </LineChart>
                        </ResponsiveContainer>
                        <p className="text-[11px] text-slate-400 mt-3 mb-1">{t("cost_anomaly_trend")}</p>
                        <ResponsiveContainer width="100%" height={90}>
                            <LineChart data={costAnomalyTrend || []}>
                                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                                <Tooltip />
                                <Line type="monotone" dataKey="count" stroke={COLORS.high} strokeWidth={2} dot={{ r: 2 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </Card>
                </div>

                <div key="costGroups">
                    <FeatureGuard requiredTier="Business" featureName="Cost Groups" className="h-full w-full drag-handle cursor-move">
                        <Card title={t("top5_cost_groups")}>
                            <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 mb-2">{format(top5CostGroups?.totalCost)}</p>
                            <ResponsiveContainer width="100%" height="100%" minHeight={100}>
                                <BarChart data={top5CostGroups?.groups || []}>
                                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={40} />
                                    <Tooltip formatter={(v: any) => format(Number(v))} />
                                    <Bar dataKey="cost" fill={COLORS.cyan} radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </Card>
                    </FeatureGuard>
                </div>

                {(
                    <div key="containerApps">
                        <FeatureGuard requiredTier="Business" featureName={t("container_apps_feature_name")} className="h-full w-full drag-handle cursor-move">
                            <ContainerAppsCard />
                        </FeatureGuard>
                    </div>
                )}

                {(
                    <div key="logAnalytics">
                        <FeatureGuard requiredTier="Business" featureName={t("log_analytics_feature_name")} className="h-full w-full drag-handle cursor-move">
                            <LogAnalyticsCard />
                        </FeatureGuard>
                    </div>
                )}
            </ResponsiveGridLayout>
        </div>
    );
}
