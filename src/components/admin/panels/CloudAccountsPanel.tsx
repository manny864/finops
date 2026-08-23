"use client";
/**
 * Estado de Cuenta — Cuentas Cloud (Azure).
 *
 * El panel anterior eran 66 líneas de literales: mostraba "Active & Connected"
 * y "Sincronización OK" con un tilde verde aunque la ingesta estuviera caída, y
 * la etiqueta decía "Tenant Organiazación". Ahora todo sale de
 * /api/admin/config/account-status.
 */
import { useCallback, useEffect, useState } from "react";
import {
    IconActivity,
    IconAlertTriangle,
    IconApps,
    IconBrandAzure,
    IconCheck,
    IconCircleCheck,
    IconColumns,
    IconCopy,
    IconKey,
    IconRefresh,
    IconServer,
    IconSparkles,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import { useTenant } from "@/components/TenantProvider";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import { CELL, ColumnMenu, SCROLL_X, useColumnConfig, type TableColumnConfig } from "@/components/TableColumns";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import type {
    IngestionHealthStatus,
    TenantCloudAccountStatus,
    TenantSubscriptionStatusItem,
} from "@/types/tenantAccountStatus.types";

const SUB_COLUMNS: TableColumnConfig[] = [
    { id: "subscription", label: "Suscripción", visible: true },
    { id: "offer", label: "Tipo de oferta", visible: true },
    { id: "state", label: "Estado ARM", visible: true },
    { id: "resources", label: "Series de costo", visible: true },
    { id: "spend", label: "Gasto MTD", visible: true },
    { id: "ingestion", label: "Ingesta FOCUS", visible: true },
    { id: "lastSample", label: "Última muestra", visible: true },
];

const TH = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400";
const TD = "px-3 py-2.5 text-[12.5px] text-slate-700 dark:text-slate-300 align-middle";
const BADGE = "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border";

const BTN_PRIMARY =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium " +
    "bg-[#0078D4] text-white border border-[#0078D4] hover:bg-[#0060AA] disabled:opacity-50 transition-colors";
const BTN_NEUTRAL =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium " +
    "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 " +
    "hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors";

function fmtMoney(n: number): string {
    return n.toLocaleString("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtDateTime(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function relativeMinutes(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return null;
    const mins = Math.max(0, Math.round((Date.now() - d) / 60000));
    if (mins < 60) return `hace ${mins} min`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `hace ${hours} h`;
    return `hace ${Math.round(hours / 24)} d`;
}

/** Presentación del estado de ingesta. Sólo HEALTHY se muestra en verde. */
function ingestionBadge(status: IngestionHealthStatus) {
    switch (status) {
        case "HEALTHY":
            return { cls: `${BADGE} bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900`, label: "Sincronización OK" };
        case "SYNCING":
            return { cls: `${BADGE} bg-blue-100 text-blue-800 border-blue-200 animate-pulse dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900`, label: "Sincronizando…" };
        case "DEGRADED":
            return { cls: `${BADGE} bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900`, label: "Ingesta atrasada" };
        default:
            return { cls: `${BADGE} bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900`, label: "Desconectado" };
    }
}

function KpiCard({
    icon, label, value, hint, tooltip, valueClass = "text-[#0078D4]",
}: {
    icon: React.ReactNode; label: string; value: string; hint?: string; tooltip: string; valueClass?: string;
}) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {icon}
                {label}
                <InfoTooltip content={tooltip} />
            </div>
            <div className={`mt-2 text-2xl font-extrabold tabular-nums ${valueClass}`}>{value}</div>
            {hint && <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{hint}</div>}
        </div>
    );
}

function CopyableGuid({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={() => {
                navigator.clipboard.writeText(value);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 hover:text-[#0078D4] transition-colors"
            title={value}
        >
            <span className="truncate max-w-[280px]">{value}</span>
            {copied ? <IconCheck size={13} stroke={1.5} className="text-emerald-600 shrink-0" /> : <IconCopy size={13} stroke={1.5} className="shrink-0" />}
        </button>
    );
}

export default function CloudAccountsPanel() {
    const t = useTranslations("AdminCloudAccounts");
    const { selectedTenant } = useTenant();
    const { instance, accounts, inProgress } = useMsal();

    const [status, setStatus] = useState<TenantCloudAccountStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);

    const tenantId = selectedTenant?.id || "";
    const isMock = isMockTenant(tenantId);
    const canFetch = Boolean(tenantId) && tenantId !== "default" && inProgress === "none" && (isMock || accounts.length > 0);

    const cols = useColumnConfig(`table_columns_config_account_status_${tenantId}`, SUB_COLUMNS);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock || accounts.length === 0) return {};
        return { Authorization: `Bearer ${await getFreshIdToken(instance, accounts[0])}` };
    }, [isMock, accounts, instance]);

    const load = useCallback(async () => {
        if (!canFetch) { setLoading(false); return; }
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/config/account-status?tenantId=${encodeURIComponent(tenantId)}`, {
                headers: await authHeaders(),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("loadFailed"));
            setStatus(json.status as TenantCloudAccountStatus);
        } catch (e) {
            toast.error(t("loadFailed"), { description: errorMessage(e) });
            setStatus(null);
        } finally {
            setLoading(false);
        }
    }, [canFetch, tenantId, authHeaders, t]);

    useEffect(() => { load(); }, [load]);

    const handleSync = async () => {
        setSyncing(true);
        // Optimista: el estado pasa a "Sincronizando…" apenas se dispara.
        setStatus((prev) => (prev ? { ...prev, ingestionStatus: "SYNCING" } : prev));
        try {
            const res = await fetch("/api/admin/config/account-status/sync-now", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await authHeaders()) },
                body: JSON.stringify({ tenantId }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("syncFailed"));
            toast.success(t("syncStarted"), { description: json.message });
            // El job corre en background; se relee para reflejar el estado real.
            setTimeout(load, 4000);
        } catch (e) {
            toast.error(t("syncFailed"), { description: errorMessage(e) });
            await load(); // revierte el optimismo si no arrancó
        } finally {
            setSyncing(false);
        }
    };

    const subs: TenantSubscriptionStatusItem[] = status?.subscriptions ?? [];
    const pg = usePagination(subs, 15);
    const badge = ingestionBadge(status?.ingestionStatus ?? "DISCONNECTED");

    // El tooltip del KPI lista cada límite medido con su remanente crudo: los
    // tres tienen magnitudes distintas (ARG cuenta queries por segundos, ARM
    // lecturas por 5 min), así que el % solo no dice cuánto margen hay.
    const breakdown = status?.apiQuotaBreakdown ?? [];
    const quotaTooltip = breakdown.length
        ? `${t("tooltips.kpiQuota")}\n\n${breakdown
              .map((b) => {
                  const pct = b.remainingPercentage != null ? `${b.remainingPercentage}%` : "—";
                  const ceiling = b.ceiling != null ? `/${b.ceiling}` : "";
                  return `· ${t(`quotaSource.${b.source}`)}: ${pct} (${b.remaining}${ceiling})`;
              })
              .join("\n")}`
        : t("tooltips.kpiQuota");

    if (tenantId === "default") {
        return <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 text-sm text-slate-500">{t("selectTenantPrompt")}</div>;
    }

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 animate-in fade-in duration-500">
            <div className="mb-6 border-b border-slate-200 dark:border-slate-800 pb-4">
                <h1 className="text-2xl font-extrabold text-[#1B2A41] dark:text-white tracking-tight flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                    <IconBrandAzure size={26} stroke={1.5} className="text-[#0078D4]" />
                    {t("pageTitle")}
                    <InfoTooltip content={t("tooltips.page")} />
                </h1>
                <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">{t("pageSubtitle")}</p>
            </div>

            {isMock && (
                <div className="w-full mb-6 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                    <IconAlertTriangle size={16} stroke={1.5} className="shrink-0" />
                    {t("mockBanner")}
                </div>
            )}

            {/* Tarjeta principal */}
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 mb-6">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <IconBrandAzure size={36} stroke={1.5} className="text-[#0078D4] shrink-0" />
                        <div>
                            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-white">{t("azureTenantTitle")}</h2>
                            <span className={`${badge.cls} mt-1`}>
                                {status?.ingestionStatus === "HEALTHY" && <IconCircleCheck size={13} stroke={1.5} />}
                                {badge.label}
                            </span>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button onClick={handleSync} disabled={syncing || loading} className={BTN_PRIMARY}>
                            <IconSparkles size={16} stroke={1.5} />
                            {syncing ? t("syncing") : t("syncNow")}
                        </button>
                        <button onClick={load} disabled={loading} className={BTN_NEUTRAL}>
                            <IconRefresh size={16} stroke={1.5} className="text-slate-500" />
                            {t("recheck")}
                        </button>
                    </div>
                </div>

                {status?.lastErrorMessage && (
                    <div className="mt-4 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                        <span className="font-semibold">{t("lastError")}:</span> {status.lastErrorMessage}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 pt-6 border-t border-slate-200 dark:border-slate-800">
                    <div>
                        {/* Antes decía "Tenant Organiazación". */}
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            {t("orgLabel")}
                            <InfoTooltip content={t("tooltips.org")} />
                        </p>
                        <p className="mt-1.5 font-semibold text-[#1B2A41] dark:text-white truncate" title={status?.organizationDisplayName}>
                            {loading ? "…" : status?.organizationDisplayName || "—"}
                        </p>
                        {status?.azureTenantGuid && <CopyableGuid value={status.azureTenantGuid} />}
                    </div>
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            {t("planLabel")}
                            <InfoTooltip content={t("tooltips.plan")} />
                        </p>
                        <p className="mt-1.5 text-lg font-extrabold text-[#0078D4]">{loading ? "…" : status?.activePlanTier || "—"}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            <IconCheck size={13} stroke={1.5} className="text-emerald-600" />
                            {t("engineReady")}
                        </p>
                    </div>
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            {t("ingestionLabel")}
                            <InfoTooltip content={t("tooltips.ingestion")} />
                        </p>
                        <p className="mt-1.5"><span className={badge.cls}>{badge.label}</span></p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                            {t("lastIngestion")}: {relativeMinutes(status?.lastSuccessfulSyncAt ?? null) ?? t("never")}
                        </p>
                    </div>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                <KpiCard
                    icon={<IconApps size={14} stroke={1.5} className="text-[#0078D4]" />}
                    label={t("kpiSubscriptions")}
                    value={loading ? "…" : String(status?.totalActiveSubscriptionsCount ?? 0)}
                    tooltip={t("tooltips.kpiSubscriptions")}
                />
                <KpiCard
                    icon={<IconServer size={14} stroke={1.5} className="text-[#0078D4]" />}
                    label={t("kpiRecords")}
                    value={loading ? "…" : (status?.ingestedRecordsCount ?? 0).toLocaleString("es-AR")}
                    tooltip={t("tooltips.kpiRecords")}
                    valueClass="text-blue-600"
                />
                <KpiCard
                    icon={<IconActivity size={14} stroke={1.5} className="text-[#0078D4]" />}
                    label={t("kpiQuota")}
                    // Es el MÁS AJUSTADO de los tres límites medidos, no un
                    // promedio: el que primero va a throttlear es el que importa.
                    // null = todavía no hay muestras; nunca se inventa.
                    value={loading ? "…" : status?.apiQuotaRemainingPercentage != null ? `${status.apiQuotaRemainingPercentage}%` : t("notMeasured")}
                    hint={
                        status?.apiQuotaRemainingPercentage == null
                            ? t("quotaNotMeasuredYet")
                            : status.apiQuotaTightestSource
                                ? t("quotaTightest", { source: t(`quotaSource.${status.apiQuotaTightestSource}`) })
                                : undefined
                    }
                    tooltip={quotaTooltip}
                    valueClass="text-[#0284C7]"
                />
                <KpiCard
                    icon={<IconKey size={14} stroke={1.5} className="text-[#0078D4]" />}
                    label={t("kpiCredentials")}
                    value={loading ? "…" : status?.credentialDaysRemaining != null ? t("daysRemaining", { days: status.credentialDaysRemaining }) : t("noCredentialData")}
                    tooltip={t("tooltips.kpiCredentials")}
                    valueClass={
                        status?.credentialDaysRemaining != null && status.credentialDaysRemaining < 30
                            ? "text-rose-600"
                            : "text-slate-900 dark:text-white"
                    }
                />
            </div>

            {/* Tabla de suscripciones */}
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                        {t("subsTitle")}
                        <InfoTooltip content={t("tooltips.subsTable")} />
                    </h3>
                    <ColumnMenu {...cols} label={t("customizeColumns")} />
                </div>

                {loading ? (
                    <div className="p-6 text-sm text-slate-500">{t("loading")}</div>
                ) : subs.length === 0 ? (
                    // Empty state legítimo: sin datos reales no se inventa nada.
                    <div className="p-8 text-center">
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{t("emptyTitle")}</p>
                        <p className="mt-1 text-[12.5px] text-slate-500 dark:text-slate-400">{t("emptyHint")}</p>
                    </div>
                ) : (
                    <>
                        <div className={SCROLL_X}>
                            <table className="w-full text-left text-xs border-collapse">
                                <thead className="bg-slate-50 dark:bg-slate-800/50">
                                    <tr>
                                        {SUB_COLUMNS.filter((c) => cols.isVisible(c.id)).map((c) => (
                                            <ResizableTh key={c.id} minWidth={c.id === "subscription" ? 240 : 130} className={TH}>
                                                {t(`col_${c.id}`)}
                                                <InfoTooltip content={t(`tooltips.col_${c.id}`)} />
                                            </ResizableTh>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {pg.paged.map((s) => (
                                        <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                                            {cols.isVisible("subscription") && (
                                                <td className={TD}>
                                                    <div className={`${CELL} font-semibold text-[#1B2A41] dark:text-white flex items-center gap-1.5`} title={s.subscriptionName}>
                                                        <IconBrandAzure size={14} stroke={1.5} className="text-[#0078D4] shrink-0" />
                                                        {s.subscriptionName}
                                                    </div>
                                                    <CopyableGuid value={s.subscriptionId} />
                                                </td>
                                            )}
                                            {cols.isVisible("offer") && (
                                                <td className={TD}>
                                                    <span className={`${BADGE} bg-blue-50 text-[#0078D4] border-blue-200 dark:bg-blue-950/30 dark:border-blue-900 whitespace-nowrap`}>
                                                        {s.offerType === "Unknown" ? t("offerUnknown") : s.offerType}
                                                    </span>
                                                </td>
                                            )}
                                            {cols.isVisible("state") && (
                                                <td className={TD}>
                                                    <span className={`${BADGE} whitespace-nowrap ${
                                                        s.state === "Enabled"
                                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900"
                                                            : "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                                                    }`}>
                                                        {s.state}
                                                    </span>
                                                </td>
                                            )}
                                            {cols.isVisible("resources") && (
                                                <td className={`${TD} tabular-nums whitespace-nowrap`}>{s.resourceCount.toLocaleString("es-AR")}</td>
                                            )}
                                            {cols.isVisible("spend") && (
                                                <td className={`${TD} tabular-nums whitespace-nowrap font-semibold text-slate-900 dark:text-white`}>
                                                    {fmtMoney(s.monthlySpendUSD)}
                                                </td>
                                            )}
                                            {cols.isVisible("ingestion") && (
                                                <td className={TD}>
                                                    <span className={`${BADGE} whitespace-nowrap ${
                                                        s.isIngestionHealthy
                                                            ? "bg-blue-50 text-[#0078D4] border-blue-200 dark:bg-blue-950/30 dark:border-blue-900"
                                                            : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900"
                                                    }`}>
                                                        {s.isIngestionHealthy ? t("ingestionLive") : t("ingestionPending")}
                                                    </span>
                                                </td>
                                            )}
                                            {cols.isVisible("lastSample") && (
                                                <td className={`${TD} whitespace-nowrap`}>{fmtDateTime(s.lastCostDataTimestamp || null)}</td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800">
                            <Pagination {...pg} pageSizes={[15, 30, 45, 60]} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
