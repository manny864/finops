"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    ArrowDownRight,
    ArrowUpRight,
    CheckCircle2,
    Coins,
    Gauge,
    RefreshCw,
    ShieldAlert,
    Sparkles,
    Wallet
} from "lucide-react";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";

interface MetricPoint {
    timestamp: string;
    PercentProcessorTime: number | null;
    UsedMemory: number | null;
    OperationsPerSecond: number | null;
    EvictedKeys: number | null;
    Errors: number | null;
}

interface RedisInstanceMetrics {
    id: string;
    name: string;
    region: string;
    sku: string;
    monthlyCostUsd: number;
    telemetry?: {
        available: boolean;
        source?: "azure-monitor" | "mock";
        message?: string;
    };
    history: MetricPoint[];
}

interface Recommendation {
    title: string;
    instanceId: string;
    monthlySavings: number;
    risk: "low" | "medium" | "high";
    confidence: "high" | "medium" | "low";
    actionType: "manual" | "guided" | "automatic";
}

interface RedisFinOpsResponse {
    success?: boolean;
    mock?: boolean;
    resourceExists?: boolean;
    instances?: RedisInstanceMetrics[];
    financialSummary?: {
        mtdCost: number;
        forecastEom: { value: number; low: number; high: number };
        deltaMoM: { value: number; percentage: number };
        potentialSavings: number;
    };
    efficiency?: {
        costPerUsedGb: number;
        costPerKOps: number;
        underutilizedCount: number;
    };
    risk?: {
        healthScore: number;
        criticalAlerts: number;
    };
    recommendations?: Recommendation[];
    error?: string;
    details?: string;
}

function formatShortCurrency(value: number, formatter: (amountUSD: string | number, opts?: { compact?: boolean; fractionDigits?: number }) => string): string {
    return formatter(value);
}

function normalizeResponse(data: RedisFinOpsResponse): Required<Pick<RedisFinOpsResponse, "instances" | "financialSummary" | "efficiency" | "risk" | "recommendations">> {
    const instances = data.instances || [];

    const financialSummary = data.financialSummary || {
        mtdCost: instances.reduce((acc, instance) => acc + (instance.monthlyCostUsd || 0), 0),
        forecastEom: {
            value: instances.reduce((acc, instance) => acc + (instance.monthlyCostUsd || 0), 0),
            low: instances.reduce((acc, instance) => acc + (instance.monthlyCostUsd || 0), 0) * 0.92,
            high: instances.reduce((acc, instance) => acc + (instance.monthlyCostUsd || 0), 0) * 1.08
        },
        deltaMoM: { value: 0, percentage: 0 },
        potentialSavings: 0
    };

    const efficiency = data.efficiency || {
        costPerUsedGb: 0,
        costPerKOps: 0,
        underutilizedCount: 0
    };

    const risk = data.risk || {
        healthScore: 0,
        criticalAlerts: 0
    };

    const recommendations = data.recommendations || [];

    return { instances, financialSummary, efficiency, risk, recommendations };
}

export default function RedisTestBoard() {
    const { selectedTenant } = useTenant();
    const { format } = useCurrency();

    const [instances, setInstances] = useState<RedisInstanceMetrics[]>([]);
    const [financialSummary, setFinancialSummary] = useState({
        mtdCost: 0,
        forecastEom: { value: 0, low: 0, high: 0 },
        deltaMoM: { value: 0, percentage: 0 },
        potentialSavings: 0
    });
    const [efficiency, setEfficiency] = useState({
        costPerUsedGb: 0,
        costPerKOps: 0,
        underutilizedCount: 0
    });
    const [risk, setRisk] = useState({
        healthScore: 0,
        criticalAlerts: 0
    });
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
    const [isMock, setIsMock] = useState(false);

    const fetchRedisMetrics = useCallback(async (isManual = false) => {
        if (!selectedTenant) return;

        if (isManual) setRefreshing(true);
        else setLoading(true);

        setError(null);

        try {
            const tenantId = selectedTenant.id;

            const params = new URLSearchParams({
                tenantId,
                realtime: "true"
            });

            const response = await fetch(`/api/intelligence/databases/redis-metrics?${params.toString()}`, {
                cache: "no-store"
            });

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || body.details || `Error HTTP ${response.status}`);
            }

            const data: RedisFinOpsResponse = await response.json();
            const normalized = normalizeResponse(data);

            setInstances(normalized.instances);
            setFinancialSummary(normalized.financialSummary);
            setEfficiency(normalized.efficiency);
            setRisk(normalized.risk);
            setRecommendations(normalized.recommendations);

            setIsMock(Boolean(data.mock) || isMockTenant(tenantId));
            setLastUpdatedAt(new Date());
        } catch (err) {
            const message = err instanceof Error ? err.message : "Error inesperado al cargar Redis FinOps cockpit";
            setError(message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [selectedTenant]);

    useEffect(() => {
        fetchRedisMetrics(false);
    }, [fetchRedisMetrics]);

    useEffect(() => {
        if (!autoRefresh || !selectedTenant) return;
        const interval = setInterval(() => {
            void fetchRedisMetrics(true);
        }, 30000);
        return () => clearInterval(interval);
    }, [autoRefresh, selectedTenant, fetchRedisMetrics]);

    const telemetry = useMemo(() => {
        const withTelemetry = instances.filter((i) => i.telemetry?.available === true).length;
        const total = instances.length;
        return {
            withTelemetry,
            total,
            missing: Math.max(total - withTelemetry, 0)
        };
    }, [instances]);

    const topRecommendations = useMemo(() => recommendations.slice(0, 5), [recommendations]);

    if (!selectedTenant) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">
                Selecciona un tenant para ver el cockpit FinOps de Redis.
            </div>
        );
    }

    if (loading) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                <p className="text-sm text-slate-600">Cargando Redis FinOps Cockpit...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="mb-2 flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-sky-600" />
                            <h2 className="text-xl font-semibold text-slate-900">Redis FinOps Cockpit v2</h2>
                        </div>
                        <p className="text-sm text-slate-600">
                            Control financiero, eficiencia operativa y riesgo priorizado para decisiones CMP.
                        </p>
                        {lastUpdatedAt && (
                            <p className="mt-2 text-xs text-slate-500">
                                Actualizado: {lastUpdatedAt.toLocaleTimeString()} {isMock ? "(mock)" : "(real-time)"}
                            </p>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setAutoRefresh((prev) => !prev)}
                            className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                                autoRefresh
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-slate-100 text-slate-700"
                            }`}
                        >
                            {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
                        </button>
                        <button
                            type="button"
                            onClick={() => void fetchRedisMetrics(true)}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            disabled={refreshing}
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                            {refreshing ? "Actualizando..." : "Actualizar"}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        <AlertTriangle className="mt-0.5 h-4 w-4" />
                        <span>{error}</span>
                    </div>
                )}
            </section>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                    icon={<Wallet className="h-4 w-4 text-sky-700" />}
                    title="MTD Cost"
                    value={formatShortCurrency(financialSummary.mtdCost, format)}
                    subtitle={`Forecast EOM: ${formatShortCurrency(financialSummary.forecastEom.value, format)}`}
                />

                <KpiCard
                    icon={<Coins className="h-4 w-4 text-emerald-700" />}
                    title="Ahorro Potencial"
                    value={formatShortCurrency(financialSummary.potentialSavings, format)}
                    subtitle={topRecommendations.length > 0 ? `${topRecommendations.length} acciones priorizadas` : "Sin recomendaciones aún"}
                />

                <KpiCard
                    icon={<Gauge className="h-4 w-4 text-amber-700" />}
                    title="Eficiencia"
                    value={`${formatShortCurrency(efficiency.costPerUsedGb, format)} / GB usado`}
                    subtitle={`${formatShortCurrency(efficiency.costPerKOps, format)} / KOps`}
                />

                <KpiCard
                    icon={<ShieldAlert className="h-4 w-4 text-rose-700" />}
                    title="Risk Health Score"
                    value={`${risk.healthScore.toFixed(1)} / 100`}
                    subtitle={`${risk.criticalAlerts} alertas críticas`}
                />
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900">Top oportunidades de ahorro</h3>
                        <span className="text-xs text-slate-500">Priorizadas por impacto mensual</span>
                    </div>

                    {topRecommendations.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                            No hay recomendaciones activas. El cockpit seguirá mostrando métricas financieras aunque no haya telemetría operacional completa.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {topRecommendations.map((rec) => (
                                <div key={`${rec.instanceId}-${rec.title}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900">{rec.title}</p>
                                            <p className="text-xs text-slate-600">Instancia: {rec.instanceId}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-semibold text-emerald-700">
                                                {formatShortCurrency(rec.monthlySavings, format)} / mes
                                            </p>
                                            <p className="text-xs text-slate-500">
                                                Confianza {rec.confidence} | Riesgo {rec.risk}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex items-center gap-2 text-xs">
                                        <Badge label={`Action: ${rec.actionType}`} tone="slate" />
                                        <Badge label={`Risk: ${rec.risk}`} tone={rec.risk === "high" ? "rose" : rec.risk === "medium" ? "amber" : "emerald"} />
                                        <Badge label={`Confidence: ${rec.confidence}`} tone={rec.confidence === "high" ? "emerald" : rec.confidence === "medium" ? "amber" : "rose"} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-sm font-semibold text-slate-900">Estado y contexto</h3>
                    <div className="space-y-3 text-sm">
                        <ContextRow label="Instancias detectadas" value={`${instances.length}`} />
                        <ContextRow label="Underutilized" value={`${efficiency.underutilizedCount}`} />
                        <ContextRow label="Telemetría completa" value={`${telemetry.withTelemetry}/${telemetry.total}`} />
                        <ContextRow label="Sin telemetría" value={`${telemetry.missing}`} />
                    </div>

                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                        {telemetry.missing > 0
                            ? "Modo resiliente activo: el cockpit mantiene decisiones financieras y recomendaciones aún con señales operacionales parciales."
                            : "Telemetría operacional completa: decisiones con máxima confianza."}
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <SignalCard
                    title="Delta MoM"
                    value={`${financialSummary.deltaMoM.percentage.toFixed(1)}%`}
                    icon={financialSummary.deltaMoM.percentage >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    tone={financialSummary.deltaMoM.percentage > 8 ? "rose" : financialSummary.deltaMoM.percentage > 0 ? "amber" : "emerald"}
                    helper={`${formatShortCurrency(financialSummary.deltaMoM.value, format)} vs baseline`}
                />

                <SignalCard
                    title="Rango Forecast"
                    value={`${formatShortCurrency(financialSummary.forecastEom.low, format)} - ${formatShortCurrency(financialSummary.forecastEom.high, format)}`}
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    tone="slate"
                    helper="Banda de confianza estimada"
                />

                <SignalCard
                    title="Modo de vista"
                    value={isMock ? "Demo" : "Production"}
                    icon={<Sparkles className="h-4 w-4" />}
                    tone={isMock ? "amber" : "emerald"}
                    helper={isMock ? "Datos simulados para evaluación" : "Datos reales Azure + FinOps"}
                />
            </section>
        </div>
    );
}

function KpiCard({ icon, title, value, subtitle }: { icon: React.ReactNode; title: string; value: string; subtitle: string }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-600">
                {icon}
                <span>{title}</span>
            </div>
            <p className="text-lg font-semibold text-slate-900">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
    );
}

function ContextRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
            <span className="text-slate-600">{label}</span>
            <span className="font-semibold text-slate-900">{value}</span>
        </div>
    );
}

function SignalCard({
    title,
    value,
    icon,
    tone,
    helper
}: {
    title: string;
    value: string;
    icon: React.ReactNode;
    tone: "emerald" | "amber" | "rose" | "slate";
    helper: string;
}) {
    const toneClass = {
        emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
        amber: "border-amber-200 bg-amber-50 text-amber-800",
        rose: "border-rose-200 bg-rose-50 text-rose-800",
        slate: "border-slate-200 bg-slate-50 text-slate-800"
    }[tone];

    return (
        <div className={`rounded-2xl border p-4 ${toneClass}`}>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                {icon}
                <span>{title}</span>
            </div>
            <p className="text-sm font-semibold">{value}</p>
            <p className="mt-1 text-xs opacity-80">{helper}</p>
        </div>
    );
}

function Badge({ label, tone }: { label: string; tone: "emerald" | "amber" | "rose" | "slate" }) {
    const toneClass = {
        emerald: "bg-emerald-100 text-emerald-700",
        amber: "bg-amber-100 text-amber-700",
        rose: "bg-rose-100 text-rose-700",
        slate: "bg-slate-100 text-slate-700"
    }[tone];

    return <span className={`rounded-full px-2 py-1 font-medium ${toneClass}`}>{label}</span>;
}
