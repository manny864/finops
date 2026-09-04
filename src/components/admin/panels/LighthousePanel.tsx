"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import TierLockedNotice from "@/components/TierLockedNotice";
import { useTenantPlanLimits } from "@/hooks/useTenantPlanLimits";
import { tierPuedeUsarLighthouse, LIGHTHOUSE_REQUIRED_TIER } from "@/lib/lighthouseTier";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import {
    IconAlertTriangle,
    IconApps,
    IconBrandAzure,
    IconBuildingBridge,
    IconChecklist,
    IconCompass,
    IconCopy,
    IconDownload,
    IconRefresh,
    IconTrash,
    IconExternalLink,
    IconEye,
    IconFileCode,
    IconLoader2,
    IconSearch,
    IconShieldLock,
    IconSparkles,
    IconTopologyStar3,
} from "@tabler/icons-react";
import { toast } from "sonner";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import { CELL, ColumnMenu, SCROLL_X, useColumnConfig, type TableColumnConfig } from "@/components/TableColumns";
import { KpiCard, formatDateTime } from "@/components/support/supportUi";
import { AZURE_CUSTOM_DEPLOYMENT_URL, azureRoleNamesFor, syncPercentage } from "@/services/azureLighthouse.service";
import { isValidGuid } from "@/services/clientOnboarding.service";
import {
    LIGHTHOUSE_ROLES,
    type LighthouseDelegationItem,
    type LighthousePayload,
    type LighthouseRoleKey,
} from "@/types/azureLighthouse.types";

/**
 * Onboarding vía Azure Lighthouse.
 *
 * El MSP gestiona el tenant del cliente sin credenciales suyas: el cliente
 * despliega una plantilla ARM que delega roles concretos al tenant del MSP.
 *
 * La tabla mezcla dos fuentes y las distingue: `arg` son delegaciones que
 * existen en Azure de verdad, `db` son plantillas que la plataforma emitió y el
 * cliente todavía no aplicó. Mostrarlas indistintas haría que un template
 * descargado y nunca desplegado se lea como acceso vigente.
 */

const DELEGATION_COLUMNS: TableColumnConfig[] = [
    { id: "tenant", label: "Tenant gestionado", visible: true },
    { id: "subscription", label: "Suscripción delegada", visible: true },
    { id: "roles", label: "Roles delegados", visible: true },
    { id: "status", label: "Estado de delegación", visible: true },
    { id: "approved", label: "Fecha de aprobación", visible: true },
    { id: "actions", label: "Acciones", visible: true },
];

const STATUS_BADGE: Record<string, string> = {
    ACTIVE: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800",
    PENDING: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800",
    REJECTED: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800",
};

const TH = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400";
const TD = "px-3 py-2.5 text-[12.5px] text-slate-700 dark:text-slate-300 align-middle";

export default function LighthousePanel() {
    const t = useTranslations("Lighthouse");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tenantId = selectedTenant?.id || "";
    const planLimits = useTenantPlanLimits(tenantId);

    const [payload, setPayload] = useState<LighthousePayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    const [clientTenantId, setClientTenantId] = useState("");
    const [clientSubscriptionId, setClientSubscriptionId] = useState("");
    const [roles, setRoles] = useState<LighthouseRoleKey[]>(["READER", "COST_READER"]);
    const [generating, setGenerating] = useState(false);
    const [template, setTemplate] = useState<string>("");
    const [detail, setDetail] = useState<LighthouseDelegationItem | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const cols = useColumnConfig(`table_columns_config_lighthouse_${tenantId}`, DELEGATION_COLUMNS);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const load = useCallback(async () => {
        if (!tenantId || tenantId === "default" || accounts.length === 0) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/onboard/lighthouse?tenantId=${encodeURIComponent(tenantId)}`, { headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setPayload(json as LighthousePayload);
            if (json.warning) toast.warning(String(json.warning));
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setLoading(false);
        }
    }, [tenantId, accounts.length, authHeaders, t]);

    useEffect(() => {
        load();
    }, [load]);

    const tenantGuidOk = !clientTenantId || isValidGuid(clientTenantId);
    const subGuidOk = !clientSubscriptionId || isValidGuid(clientSubscriptionId);
    const canGenerate = isValidGuid(clientTenantId) && isValidGuid(clientSubscriptionId) && roles.length > 0;

    const generate = async () => {
        setGenerating(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/onboard/lighthouse?tenantId=${encodeURIComponent(tenantId)}`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    managedTenantId: clientTenantId.trim(),
                    managedSubscriptionId: clientSubscriptionId.trim(),
                    roles: azureRoleNamesFor(roles),
                }),
            });
            const json = await res.json();
            if (!json.armTemplate) throw new Error(json.error || t("templateError"));
            setTemplate(JSON.stringify(json.armTemplate, null, 2));
            if (!res.ok) toast.warning(json.error || t("templatePartial"));
            else toast.success(t("templateOk"));
            await load();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setGenerating(false);
        }
    };

    /**
     * Pregunta a Azure si el cliente desplegó la plantilla.
     *
     * Sin esto el panel no distingue "le mandamos el JSON" de "la delegación
     * existe": el INSERT deja status 'pending' y nada lo actualizaba. Y es lo
     * que enciende `access_model = 'lighthouse'`, o sea lo que hace que las
     * consultas se autentiquen contra nuestro directorio en vez del del
     * cliente.
     */
    const verify = async () => {
        setVerifying(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/onboard/lighthouse/verify?tenantId=${encodeURIComponent(tenantId)}`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("errorGeneric"));
            if (json.activa) {
                toast.success(t("verifyActive"), {
                    description: t("verifyActiveDesc", {
                        subs: (json.suscripciones || []).length,
                        roles: (json.roles || []).join(", ") || "—",
                    }),
                });
            } else {
                toast.warning(t("verifyPending"), { description: json.error || "" });
            }
            await load();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setVerifying(false);
        }
    };

    /**
     * Da de baja el registro de una delegacion.
     *
     * Pide confirmacion tipeando nada --no destruye recursos-- pero avisa
     * cuando la delegacion seguia activa en Azure: ahi el borrado deja al
     * cliente delegando acceso que nosotros creemos no tener, y eso lo tiene
     * que resolver alguien.
     */
    const removeDelegation = async (d: LighthouseDelegationItem) => {
        if (d.origin === "arg") {
            toast.warning(t("deleteFromAzureOnly"));
            return;
        }
        setDeleting(d.id);
        try {
            const headers = await authHeaders();
            const res = await fetch(
                `/api/onboard/lighthouse/${encodeURIComponent(d.id)}?tenantId=${encodeURIComponent(tenantId)}`,
                { method: "DELETE", headers },
            );
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("errorGeneric"));
            if (json.seguiaActivaEnAzure) {
                toast.warning(t("deleteStillLive"), { description: t("deleteStillLiveDesc") });
            } else {
                toast.success(t("deleteOk"));
            }
            if (json.modeloRevertido) toast.info(t("deleteModelReverted"));
            await load();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setDeleting(null);
        }
    };

    const downloadTemplate = () => {
        const blob = new Blob([template], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "lighthouse-delegation.json";
        a.click();
        URL.revokeObjectURL(url);
    };

    const delegations = payload?.summary.delegations || [];
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return delegations;
        return delegations.filter(
            (d) =>
                d.managedTenantName.toLowerCase().includes(q) ||
                d.managedTenantId.toLowerCase().includes(q) ||
                d.subscriptionName.toLowerCase().includes(q) ||
                d.subscriptionId.toLowerCase().includes(q)
        );
    }, [delegations, search]);
    const pg = usePagination(filtered, 15);
    const summary = payload?.summary;

    /*
     * Azure Lighthouse es Enterprise.
     *
     * `routeTiers` ya lo declaraba, pero ese gate no se aplicaba: el panel dejo
     * de ser pagina propia y hoy es una pestaña de `/admin/access`.
     * `RouteTierGate` resuelve el tier por el pathname --que ahi es
     * `/admin/access`-- y `AdminHubGate` filtra por permisos y rol, no por tier.
     * La declaracion decia Enterprise y la realidad era "cualquiera".
     *
     * Esto es el aviso; el gate de verdad esta en las rutas de API, porque un
     * bloqueo solo visual se saltea con un fetch.
     */
    if (!tierPuedeUsarLighthouse(planLimits.planTier)) {
        return (
            <div className="p-6">
                <TierLockedNotice
                    requiredTier={LIGHTHOUSE_REQUIRED_TIER}
                    currentTier={planLimits.planTier}
                    featureName={t("title")}
                />
            </div>
        );
    }

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-5">
                <h1 className="font-heading font-extrabold text-[20px] text-slate-900 dark:text-white flex items-center">
                    <IconCompass size={24} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                    {t("title")}
                    <InfoTooltip content={t("titleHelp")} />
                </h1>
                <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>

            {payload?.source === "snapshot" && (
                <div className="mb-4 text-[12.5px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-start gap-2">
                    <IconAlertTriangle size={16} stroke={1.5} className="text-amber-600 shrink-0 mt-0.5" />
                    <span>{payload.warning || t("snapshotWarning")}</span>
                </div>
            )}
            {payload?.mock && (
                <div className="mb-4 text-[12px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                    {t("mockBanner")}
                </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
                <KpiCard
                    icon={IconBuildingBridge}
                    label={t("kpiTenants")}
                    value={summary?.totalManagedTenantsCount ?? 0}
                    tone="#0078D4"
                    tooltip={<InfoTooltip content={t("kpiTenantsHelp")} />}
                />
                <KpiCard
                    icon={IconApps}
                    label={t("kpiSubscriptions")}
                    value={summary?.totalDelegatedSubscriptionsCount ?? 0}
                    tone="#2563EB"
                    tooltip={<InfoTooltip content={t("kpiSubscriptionsHelp")} />}
                />
                <KpiCard
                    icon={IconShieldLock}
                    label={t("kpiRoles")}
                    value={summary?.delegatedRoleAssignmentsCount ?? 0}
                    tone="#0284C7"
                    tooltip={<InfoTooltip content={t("kpiRolesHelp")} />}
                />
                <KpiCard
                    icon={IconChecklist}
                    label={t("kpiSync")}
                    value={summary ? `${syncPercentage(summary)}%` : "—"}
                    tone="#1B2A41"
                    hint={summary && summary.delegations.length > 0 ? t("kpiSyncHint", { active: summary.activeDelegationsCount, total: summary.delegations.length }) : undefined}
                    tooltip={<InfoTooltip content={t("kpiSyncHelp")} />}
                />
            </div>

            {/* Tabla de delegaciones */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden mb-5">
                <div className="p-3 flex items-center justify-between gap-3 flex-wrap border-b border-slate-200 dark:border-slate-800">
                    <h2 className="font-heading font-bold text-[14px] text-slate-900 dark:text-white flex items-center">
                        <IconTopologyStar3 size={18} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                        {t("tableTitle")}
                        <InfoTooltip content={t("tableHelp")} />
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative">
                            <IconSearch size={14} stroke={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t("searchPlaceholder")}
                                className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] w-60"
                            />
                        </div>
                        <ColumnMenu {...cols} label={t("customizeColumns")} />
                    </div>
                </div>

                {loading ? (
                    <div className="p-6 flex items-center gap-2 text-slate-500 text-[13px]">
                        <IconLoader2 size={16} className="animate-spin text-[#0078D4]" /> {t("loading")}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <IconTopologyStar3 size={40} stroke={1.5} className="text-[#0078D4] mx-auto mb-3" />
                        <div className="font-bold text-[15px] text-slate-900 dark:text-white">{t("emptyTitle")}</div>
                        <div className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">{t("emptyBody")}</div>
                    </div>
                ) : (
                    <>
                        <div className={SCROLL_X}>
                            <table className="w-full table-fixed">
                                <thead className="bg-slate-50 dark:bg-slate-800/50">
                                    <tr>
                                        {DELEGATION_COLUMNS.filter((c) => cols.isVisible(c.id)).map((c) => (
                                            <ResizableTh key={c.id} minWidth={100} className={TH}>
                                                {t(`col_${c.id}` as never)}
                                                <InfoTooltip content={t(`col_${c.id}_help` as never)} />
                                            </ResizableTh>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pg.paged.map((d) => (
                                        <tr key={d.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                                            {cols.isVisible("tenant") && (
                                                <td className={TD}>
                                                    <div className={`${CELL} font-semibold text-slate-900 dark:text-white`} title={d.managedTenantName}>
                                                        {d.managedTenantName}
                                                    </div>
                                                    <div className={`${CELL} font-mono text-[11px] text-slate-500`} title={d.managedTenantId}>
                                                        {d.managedTenantId}
                                                    </div>
                                                </td>
                                            )}
                                            {cols.isVisible("subscription") && (
                                                <td className={TD}>
                                                    <span className={`${CELL} inline-block`} title={`${d.subscriptionName} · ${d.subscriptionId}`}>
                                                        {d.subscriptionName}
                                                    </span>
                                                </td>
                                            )}
                                            {cols.isVisible("roles") && (
                                                <td className={TD}>
                                                    <div className="flex flex-wrap gap-1">
                                                        {d.delegatedRoles.length === 0 ? (
                                                            <span className="text-[11px] text-slate-500">{t("noRoles")}</span>
                                                        ) : (
                                                            d.delegatedRoles.map((r) => (
                                                                <span
                                                                    key={r}
                                                                    className="text-[10.5px] font-semibold px-2 py-[2px] rounded-full bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] border border-blue-200 dark:border-blue-800 whitespace-nowrap"
                                                                >
                                                                    {r}
                                                                </span>
                                                            ))
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                            {cols.isVisible("status") && (
                                                <td className={TD}>
                                                    <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-md ${STATUS_BADGE[d.status]}`}>
                                                        {t(`status_${d.status}` as never)}
                                                    </span>
                                                    {d.origin === "db" && (
                                                        <span className="block text-[10px] text-slate-500 mt-0.5" title={t("originDbHelp")}>
                                                            {t("originDb")}
                                                        </span>
                                                    )}
                                                </td>
                                            )}
                                            {cols.isVisible("approved") && <td className={TD}>{d.approvedAt ? formatDateTime(d.approvedAt) : "—"}</td>}
                                            {cols.isVisible("actions") && (
                                                <td className={TD}>
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <button
                                                            onClick={() => setDetail(d)}
                                                            className="text-xs font-semibold rounded-lg border border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
                                                        >
                                                            <IconEye size={16} stroke={1.5} className="inline mr-1" />
                                                            {t("viewDetails")}
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setClientTenantId(d.managedTenantId);
                                                                setClientSubscriptionId(d.subscriptionId);
                                                                toast.info(t("auditPrefilled"));
                                                            }}
                                                            className="text-xs font-semibold rounded-lg border border-[#00AEEF] text-[#00AEEF] bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
                                                        >
                                                            <IconSparkles size={16} stroke={1.5} className="inline mr-1 text-[#0078D4]" />
                                                            {t("auditScope")}
                                                        </button>
                                                        <button
                                                            onClick={() => removeDelegation(d)}
                                                            disabled={deleting === d.id}
                                                            title={d.origin === "arg" ? t("deleteFromAzureOnly") : t("deleteHint")}
                                                            className="text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-rose-700 dark:text-rose-400 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer whitespace-nowrap hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-40"
                                                        >
                                                            <IconTrash size={16} stroke={1.5} className="inline mr-1" />
                                                            {deleting === d.id ? t("deleting") : t("delete")}
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-3">
                            <Pagination {...pg} pageSizes={[15, 30, 45, 60]} />
                        </div>
                    </>
                )}
            </div>

            {/* Generador de template */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl">
                <h2 className="font-heading font-bold text-[15px] text-slate-900 dark:text-white flex items-center mb-4">
                    <IconFileCode size={18} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                    {t("templateTitle")}
                    <InfoTooltip content={t("templateHelp")} />
                </h2>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                        <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center">
                            {t("clientTenantLabel")}
                            <InfoTooltip content={t("clientTenantHelp")} />
                        </label>
                        <input
                            value={clientTenantId}
                            onChange={(e) => setClientTenantId(e.target.value)}
                            placeholder="00000000-0000-0000-0000-000000000000"
                            className={`w-full mt-1 border rounded-lg p-2.5 text-[13px] font-mono bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] ${tenantGuidOk ? "border-slate-300 dark:border-slate-700" : "border-rose-400"
                                }`}
                        />
                        {!tenantGuidOk && <p className="text-[11px] text-rose-600 mt-1">{t("guidInvalid")}</p>}
                    </div>
                    <div>
                        <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center">
                            {t("clientSubLabel")}
                            <InfoTooltip content={t("clientSubHelp")} />
                        </label>
                        <input
                            value={clientSubscriptionId}
                            onChange={(e) => setClientSubscriptionId(e.target.value)}
                            placeholder="00000000-0000-0000-0000-000000000000"
                            className={`w-full mt-1 border rounded-lg p-2.5 text-[13px] font-mono bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] ${subGuidOk ? "border-slate-300 dark:border-slate-700" : "border-rose-400"
                                }`}
                        />
                        {!subGuidOk && <p className="text-[11px] text-rose-600 mt-1">{t("guidInvalid")}</p>}
                    </div>
                </div>

                <div className="mt-4">
                    <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center">
                        {t("rolesLabel")}
                        <InfoTooltip content={t("rolesHelp")} />
                    </label>
                    <div className="flex flex-wrap gap-3 mt-2">
                        {LIGHTHOUSE_ROLES.map((r) => (
                            <label
                                key={r.key}
                                className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                            >
                                <input
                                    type="checkbox"
                                    checked={roles.includes(r.key)}
                                    onChange={() => setRoles((prev) => (prev.includes(r.key) ? prev.filter((x) => x !== r.key) : [...prev, r.key]))}
                                    className="accent-[#0054A6] cursor-pointer"
                                />
                                {t(`role_${r.key}` as never)}
                            </label>
                        ))}
                    </div>
                    {roles.includes("CONTRIBUTOR") && (
                        <p className="text-[11.5px] text-amber-700 dark:text-amber-400 mt-2 flex items-start gap-1.5">
                            <IconAlertTriangle size={14} stroke={1.5} className="text-amber-600 shrink-0 mt-0.5" />
                            {t("contributorWarning")}
                        </p>
                    )}
                </div>

                <button
                    onClick={generate}
                    disabled={generating || !canGenerate}
                    className="mt-4 bg-[#0078D4] text-white hover:bg-[#0060AA] px-5 py-2.5 rounded-lg font-medium text-[13px] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                    {generating ? <IconLoader2 size={16} className="animate-spin" /> : <IconFileCode size={16} stroke={1.5} />}
                    {t("generateTemplate")}
                </button>

                {template && (
                    <div className="mt-5">
                        <div className="rounded-t-xl bg-slate-800 dark:bg-slate-950 px-4 py-2.5 flex items-center gap-3">
                            <span className="flex gap-1.5">
                                <span className="w-3 h-3 rounded-full bg-rose-400" />
                                <span className="w-3 h-3 rounded-full bg-amber-400" />
                                <span className="w-3 h-3 rounded-full bg-emerald-400" />
                            </span>
                            <span className="font-mono text-[12px] text-slate-300 flex-1">lighthouse-delegation.json</span>
                            <button
                                onClick={() => {
                                    navigator.clipboard?.writeText(template);
                                    toast.success(t("templateCopied"));
                                }}
                                className="text-[11px] font-semibold text-slate-200 hover:text-white cursor-pointer whitespace-nowrap"
                            >
                                <IconCopy size={14} stroke={1.5} className="inline mr-1" />
                                {t("copyTemplate")}
                            </button>
                        </div>
                        <pre
                            className={`rounded-b-xl bg-slate-900 dark:bg-black text-slate-100 text-[11.5px] leading-relaxed p-4 max-h-80 overflow-auto font-mono ${SCROLL_X}`}
                        >
                            {template}
                        </pre>

                        <div className="flex items-center gap-2 flex-wrap mt-3">
                            <button
                                onClick={downloadTemplate}
                                className="bg-[#0078D4] text-white hover:bg-[#0060AA] px-5 py-2.5 rounded-lg font-medium text-[13px] flex items-center gap-1.5 cursor-pointer"
                            >
                                <IconDownload size={16} stroke={1.5} />
                                {t("downloadTemplate")}
                            </button>
                            {/*
                              * El paso que faltaba. Generar la plantilla y que
                              * el cliente la despliegue son dos cosas
                              * distintas, y hasta ahora el panel no las
                              * distinguía.
                              */}
                            <button
                                onClick={verify}
                                disabled={verifying}
                                title={t("verifyHint")}
                                className="bg-white dark:bg-slate-900 text-[#0054A6] border border-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/30 px-5 py-2.5 rounded-lg font-medium text-[13px] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                                <IconRefresh size={16} stroke={1.5} className={verifying ? "animate-spin" : ""} />
                                {verifying ? t("verifying") : t("verifyDelegation")}
                            </button>
                            <a
                                href={AZURE_CUSTOM_DEPLOYMENT_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bg-blue-600 text-white hover:bg-blue-700 px-5 py-2.5 rounded-lg font-medium text-[13px] flex items-center gap-1.5 cursor-pointer"
                            >
                                <IconBrandAzure size={16} stroke={1.5} />
                                {t("deployInPortal")}
                                <IconExternalLink size={14} stroke={1.5} />
                            </a>
                        </div>
                        <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-2">{t("deployNote")}</p>
                    </div>
                )}
            </div>

            {/* Detalle */}
            {detail && (
                <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4" onClick={() => setDetail(null)}>
                    <div
                        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="font-heading font-bold text-[16px] text-slate-900 dark:text-white mb-3">{detail.managedTenantName}</h2>
                        <dl className="grid grid-cols-1 gap-2 text-[12.5px]">
                            <div className="flex gap-2">
                                <dt className="text-slate-500 shrink-0">{t("detailTenantId")}:</dt>
                                <dd className="font-mono text-slate-800 dark:text-slate-200 break-all">{detail.managedTenantId}</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt className="text-slate-500 shrink-0">{t("detailSubscription")}:</dt>
                                <dd className="font-mono text-slate-800 dark:text-slate-200 break-all">{detail.subscriptionId}</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt className="text-slate-500 shrink-0">{t("detailRoles")}:</dt>
                                <dd className="text-slate-800 dark:text-slate-200">{detail.delegatedRoles.join(", ") || t("noRoles")}</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt className="text-slate-500 shrink-0">{t("detailStatus")}:</dt>
                                <dd className="text-slate-800 dark:text-slate-200">{t(`status_${detail.status}` as never)}</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt className="text-slate-500 shrink-0">{t("detailOrigin")}:</dt>
                                <dd className="text-slate-800 dark:text-slate-200">
                                    {detail.origin === "arg" ? t("originArgFull") : t("originDbFull")}
                                </dd>
                            </div>
                        </dl>
                        <button
                            onClick={() => setDetail(null)}
                            className="w-full mt-5 bg-[#0078D4] text-white hover:bg-[#0060AA] font-semibold py-2.5 rounded-lg text-[13px] cursor-pointer"
                        >
                            {t("close")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
