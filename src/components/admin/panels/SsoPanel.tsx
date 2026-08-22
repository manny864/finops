"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import {
    IconAlertTriangle,
    IconBrandWindows,
    IconChecklist,
    IconCircleCheck,
    IconCopy,
    IconDeviceFloppy,
    IconExternalLink,
    IconInfoCircle,
    IconLoader2,
    IconShieldLock,
    IconSparkles,
    IconUserCheck,
    IconWorld,
} from "@tabler/icons-react";
import { toast } from "sonner";
import InfoTooltip from "@/components/InfoTooltip";
import { KpiCard, formatDateTime } from "@/components/support/supportUi";
import { isValidDomain, isValidWorkosConnectionId, isValidWorkosOrgId, normalizeDomain, ssoStatusKey } from "@/services/tenantSso.service";
import { IDP_PROVIDERS, type SsoTestResult, type TenantSsoConfig, type TenantSsoPayload } from "@/types/tenantSso.types";

/**
 * SSO con SAML (WorkOS).
 *
 * La plataforma no habla SAML: WorkOS es el broker. Acá se enlaza el tenant con
 * una organización y una conexión de WorkOS, y el cliente completa los
 * metadatos de su IdP desde el Admin Portal.
 *
 * RBAC: sólo Admin/Owner del tenant. El backend revalida en cada endpoint.
 */

const EMPTY: TenantSsoConfig = {
    domain: "",
    workosOrgId: "",
    workosConnectionId: "",
    isEnabled: false,
    jitProvisioningEnabled: false,
    isDomainVerified: false,
    defaultRoleForNewUsers: "READER",
};

export default function SsoPanel() {
    const t = useTranslations("AdminSso");
    const { selectedTenant, userRole, systemRole } = useTenant();
    const { instance, accounts } = useMsal();
    const tenantId = selectedTenant?.id || "";

    const [payload, setPayload] = useState<TenantSsoPayload | null>(null);
    const [form, setForm] = useState<TenantSsoConfig>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [portalLoading, setPortalLoading] = useState(false);
    const [testResult, setTestResult] = useState<SsoTestResult | null>(null);

    const isAdmin = userRole === "Admin" || userRole === "Owner" || systemRole === "SUPERADMIN";

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
            const res = await fetch(`/api/admin/sso?tenantId=${encodeURIComponent(tenantId)}`, { headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setPayload(json as TenantSsoPayload);
            setForm(json.config || EMPTY);
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setLoading(false);
        }
    }, [tenantId, accounts.length, authHeaders, t]);

    useEffect(() => {
        load();
    }, [load]);

    const domainOk = !form.domain || isValidDomain(form.domain);
    const orgOk = !form.workosOrgId || isValidWorkosOrgId(form.workosOrgId);
    const connOk = !form.workosConnectionId || isValidWorkosConnectionId(form.workosConnectionId);
    const canEnable = Boolean(form.domain && form.workosOrgId && form.workosConnectionId);

    const save = async () => {
        setSaving(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/admin/sso", {
                method: "PUT",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    domain: normalizeDomain(form.domain),
                    workos_org_id: form.workosOrgId.trim(),
                    workos_connection_id: form.workosConnectionId.trim(),
                    enabled: form.isEnabled,
                    jitProvisioningEnabled: form.jitProvisioningEnabled,
                    defaultRoleForNewUsers: form.defaultRoleForNewUsers,
                    idpProvider: form.idpProvider,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(t("saveOk"));
            await load();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setSaving(false);
        }
    };

    const openPortal = async () => {
        setPortalLoading(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/admin/sso/portal-link", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId }),
            });
            const json = await res.json();
            if (!res.ok || !json.link) throw new Error(json.error || t("portalNoLink"));
            // El enlace es de un solo uso y expira: se abre en otra pestaña en el
            // momento, no se guarda ni se muestra para copiar.
            window.open(json.link, "_blank", "noopener,noreferrer");
            toast.success(t("portalOk"));
            await load();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setPortalLoading(false);
        }
    };

    const testConnection = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/admin/sso/test", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setTestResult(json.result as SsoTestResult);
            if (json.result?.isSuccess) toast.success(t("testOk"));
            else toast.warning(t("testFailed"));
            await load();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setTesting(false);
        }
    };

    const copy = (value: string, label: string) => {
        navigator.clipboard?.writeText(value);
        toast.success(t("copied", { label }));
    };

    if (!isAdmin) {
        return (
            <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center">
                    <IconShieldLock size={40} stroke={1.5} className="text-[#0078D4] mx-auto mb-3" />
                    <div className="font-bold text-[15px] text-slate-900 dark:text-white">{t("notAuthorizedTitle")}</div>
                    <div className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">{t("notAuthorizedBody")}</div>
                </div>
            </div>
        );
    }

    const statusKey = ssoStatusKey(payload?.config || EMPTY, payload?.workosConfigured ?? false);
    const INPUT =
        "w-full mt-1 border rounded-lg p-2.5 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4]";

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-5">
                <h1 className="font-heading font-extrabold text-[20px] text-slate-900 dark:text-white flex items-center">
                    <IconShieldLock size={24} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                    {t("title")}
                    <InfoTooltip content={t("titleHelp")} />
                </h1>
                <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>

            {payload && !payload.workosConfigured && (
                <div className="mb-4 text-[12.5px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-start gap-2">
                    <IconAlertTriangle size={16} stroke={1.5} className="text-amber-600 shrink-0 mt-0.5" />
                    <span>{t("workosMissing")}</span>
                </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
                <KpiCard
                    icon={IconChecklist}
                    label={t("kpiStatus")}
                    value={t(`status_${statusKey}` as never)}
                    tone="#0078D4"
                    tooltip={<InfoTooltip content={t("kpiStatusHelp")} />}
                />
                <KpiCard
                    icon={IconWorld}
                    label={t("kpiDomain")}
                    value={payload?.config.domain || "—"}
                    tone="#2563EB"
                    hint={payload?.config.isDomainVerified ? t("domainVerified") : t("domainUnverified")}
                    tooltip={<InfoTooltip content={t("kpiDomainHelp")} />}
                />
                <KpiCard
                    icon={IconBrandWindows}
                    label={t("kpiIdp")}
                    value={payload?.config.idpProvider ? t(`idp_${payload.config.idpProvider}` as never) : "—"}
                    tone="#0284C7"
                    tooltip={<InfoTooltip content={t("kpiIdpHelp")} />}
                />
                <KpiCard
                    icon={IconUserCheck}
                    label={t("kpiJit")}
                    value={payload?.config.jitProvisioningEnabled ? t("jitOn") : t("jitOff")}
                    tone="#1B2A41"
                    hint={
                        payload?.config.jitProvisioningEnabled
                            ? t("jitRoleHint", { role: t(`jitRole_${payload.config.defaultRoleForNewUsers}` as never) })
                            : undefined
                    }
                    tooltip={<InfoTooltip content={t("kpiJitHelp")} />}
                />
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-slate-500 text-[13px]">
                    <IconLoader2 size={16} className="animate-spin text-[#0078D4]" /> {t("loading")}
                </div>
            ) : (
                <>
                    {/* Formulario */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl mb-5">
                        <h2 className="font-heading font-bold text-[15px] text-slate-900 dark:text-white flex items-center mb-4">
                            {t("formTitle")}
                            <InfoTooltip content={t("formHelp")} />
                        </h2>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <div>
                                <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center">
                                    {t("domainLabel")}
                                    <InfoTooltip content={t("domainHelp")} />
                                </label>
                                <input
                                    value={form.domain}
                                    onChange={(e) => setForm({ ...form, domain: e.target.value })}
                                    placeholder="acme.com"
                                    className={`${INPUT} ${domainOk ? "border-slate-300 dark:border-slate-700" : "border-rose-400"}`}
                                />
                                {!domainOk && <p className="text-[11px] text-rose-600 mt-1">{t("domainInvalid")}</p>}
                            </div>

                            <div>
                                <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center">
                                    {t("orgIdLabel")}
                                    <InfoTooltip content={t("orgIdHelp")} />
                                </label>
                                <div className="relative">
                                    <input
                                        value={form.workosOrgId}
                                        onChange={(e) => setForm({ ...form, workosOrgId: e.target.value })}
                                        placeholder="org_..."
                                        className={`${INPUT} pr-8 font-mono ${orgOk ? "border-slate-300 dark:border-slate-700" : "border-rose-400"}`}
                                    />
                                    {form.workosOrgId && (
                                        <button
                                            onClick={() => copy(form.workosOrgId, t("orgIdLabel"))}
                                            className="absolute right-2.5 top-1/2 translate-y-[2px] cursor-pointer"
                                            aria-label={t("copy")}
                                        >
                                            <IconCopy size={14} className="text-slate-400 hover:text-[#0078D4]" />
                                        </button>
                                    )}
                                </div>
                                {!orgOk && <p className="text-[11px] text-rose-600 mt-1">{t("orgIdInvalid")}</p>}
                            </div>

                            <div>
                                <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center">
                                    {t("connIdLabel")}
                                    <InfoTooltip content={t("connIdHelp")} />
                                </label>
                                <div className="relative">
                                    <input
                                        value={form.workosConnectionId}
                                        onChange={(e) => setForm({ ...form, workosConnectionId: e.target.value })}
                                        placeholder="conn_..."
                                        className={`${INPUT} pr-8 font-mono ${connOk ? "border-slate-300 dark:border-slate-700" : "border-rose-400"}`}
                                    />
                                    {form.workosConnectionId && (
                                        <button
                                            onClick={() => copy(form.workosConnectionId, t("connIdLabel"))}
                                            className="absolute right-2.5 top-1/2 translate-y-[2px] cursor-pointer"
                                            aria-label={t("copy")}
                                        >
                                            <IconCopy size={14} className="text-slate-400 hover:text-[#0078D4]" />
                                        </button>
                                    )}
                                </div>
                                {!connOk && <p className="text-[11px] text-rose-600 mt-1">{t("connIdInvalid")}</p>}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                            <div>
                                <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center">
                                    {t("idpLabel")}
                                    <InfoTooltip content={t("idpHelp")} />
                                </label>
                                <select
                                    value={form.idpProvider || ""}
                                    onChange={(e) => setForm({ ...form, idpProvider: (e.target.value || undefined) as never })}
                                    className={`${INPUT} border-slate-300 dark:border-slate-700 cursor-pointer`}
                                >
                                    <option value="">{t("idpAuto")}</option>
                                    {IDP_PROVIDERS.map((p) => (
                                        <option key={p} value={p}>
                                            {t(`idp_${p}` as never)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center">
                                    {t("jitRoleLabel")}
                                    <InfoTooltip content={t("jitRoleHelp")} />
                                </label>
                                <select
                                    value={form.defaultRoleForNewUsers}
                                    onChange={(e) => setForm({ ...form, defaultRoleForNewUsers: e.target.value as never })}
                                    disabled={!form.jitProvisioningEnabled}
                                    className={`${INPUT} border-slate-300 dark:border-slate-700 cursor-pointer disabled:opacity-50`}
                                >
                                    <option value="READER">{t("jitRole_READER")}</option>
                                    <option value="CONTRIBUTOR">{t("jitRole_CONTRIBUTOR")}</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 mt-4">
                            <label className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.isEnabled}
                                    onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                                    disabled={!canEnable}
                                    className="mt-0.5 accent-[#0054A6] cursor-pointer disabled:opacity-50"
                                />
                                <span>
                                    {t("enableSso")}
                                    {!canEnable && <span className="block text-[11px] text-slate-500">{t("enableSsoRequires")}</span>}
                                </span>
                            </label>
                            <label className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.jitProvisioningEnabled}
                                    onChange={(e) => setForm({ ...form, jitProvisioningEnabled: e.target.checked })}
                                    className="mt-0.5 accent-[#0054A6] cursor-pointer"
                                />
                                <span>
                                    {t("enableJit")}
                                    <span className="block text-[11px] text-slate-500">{t("enableJitWarning")}</span>
                                </span>
                            </label>
                        </div>

                        <button
                            onClick={save}
                            disabled={saving || !domainOk || !orgOk || !connOk}
                            className="mt-5 bg-[#0078D4] text-white hover:bg-[#0060AA] px-6 py-2.5 rounded-lg font-medium text-[13px] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {saving ? <IconLoader2 size={16} className="animate-spin" /> : <IconDeviceFloppy size={16} stroke={1.5} />}
                            {t("save")}
                        </button>
                    </div>

                    {/* Acciones y verificación */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl mb-5">
                        <h2 className="font-heading font-bold text-[15px] text-slate-900 dark:text-white flex items-center mb-1">
                            {t("actionsTitle")}
                            <InfoTooltip content={t("actionsHelp")} />
                        </h2>
                        {payload?.config.lastTestedAt && (
                            <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-3">
                                {t("lastTested", {
                                    date: formatDateTime(payload.config.lastTestedAt),
                                    result: t(`testResult_${payload.config.lastTestResult || "FAILED"}` as never),
                                })}
                            </p>
                        )}

                        <div className="flex items-center gap-2 flex-wrap">
                            <button
                                onClick={openPortal}
                                disabled={portalLoading || !payload?.workosConfigured}
                                className="bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                            >
                                {portalLoading ? <IconLoader2 size={16} className="animate-spin" /> : <IconExternalLink size={16} stroke={1.5} />}
                                {t("generatePortal")}
                            </button>
                            <button
                                onClick={testConnection}
                                disabled={testing || !form.workosConnectionId}
                                className="bg-slate-800 text-white hover:bg-slate-900 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                            >
                                {testing ? <IconLoader2 size={16} className="animate-spin" /> : <IconSparkles size={16} stroke={1.5} />}
                                {t("testConnection")}
                            </button>
                        </div>

                        {testResult && (
                            <div
                                className={`mt-4 rounded-lg border p-4 ${testResult.isSuccess
                                    ? "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
                                    : "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                                    }`}
                            >
                                <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-white">
                                    {testResult.isSuccess ? (
                                        <IconCircleCheck size={18} stroke={1.5} className="text-emerald-600" />
                                    ) : (
                                        <IconAlertTriangle size={18} stroke={1.5} className="text-amber-600" />
                                    )}
                                    {testResult.isSuccess ? t("testResultOk") : t("testResultFail")}
                                </div>
                                {testResult.errorMessage && (
                                    <p className="text-[12.5px] text-slate-700 dark:text-slate-300 mt-2">{testResult.errorMessage}</p>
                                )}
                                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-[12.5px]">
                                    {testResult.connectionState && (
                                        <div className="flex gap-2">
                                            <dt className="text-slate-500">{t("testState")}:</dt>
                                            <dd className="font-mono text-slate-800 dark:text-slate-200">{testResult.connectionState}</dd>
                                        </div>
                                    )}
                                    {testResult.idpName && (
                                        <div className="flex gap-2">
                                            <dt className="text-slate-500">{t("testIdp")}:</dt>
                                            <dd className="text-slate-800 dark:text-slate-200">{testResult.idpName}</dd>
                                        </div>
                                    )}
                                    {testResult.verifiedDomains && testResult.verifiedDomains.length > 0 && (
                                        <div className="flex gap-2 sm:col-span-2">
                                            <dt className="text-slate-500">{t("testDomains")}:</dt>
                                            <dd className="text-slate-800 dark:text-slate-200">{testResult.verifiedDomains.join(", ")}</dd>
                                        </div>
                                    )}
                                    {testResult.mappedAttributes && (
                                        <div className="flex gap-2 sm:col-span-2">
                                            <dt className="text-slate-500">{t("testAttributes")}:</dt>
                                            <dd className="font-mono text-[11.5px] text-slate-800 dark:text-slate-200">
                                                {testResult.mappedAttributes.email} · {testResult.mappedAttributes.name} ·{" "}
                                                {testResult.mappedAttributes.groups.join(", ")}
                                            </dd>
                                        </div>
                                    )}
                                </dl>
                                <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-3">{t("testScopeNote")}</p>
                            </div>
                        )}
                    </div>

                    {/* Guía */}
                    <div className="bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-5 rounded-xl">
                        <h2 className="font-heading font-bold text-[14px] text-slate-900 dark:text-white flex items-center mb-3">
                            <IconInfoCircle size={18} stroke={1.5} className="text-[#0078D4] inline mr-1.5" />
                            {t("guideTitle")}
                        </h2>
                        <ol className="flex flex-col gap-2.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                                <li key={n} className="flex items-start gap-2.5 text-[13px] text-slate-700 dark:text-slate-300">
                                    <span className="shrink-0 w-5 h-5 rounded-full bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] text-[11px] font-bold grid place-items-center">
                                        {n}
                                    </span>
                                    <span>{t(`guideStep${n}` as never)}</span>
                                </li>
                            ))}
                        </ol>
                    </div>
                </>
            )}
        </div>
    );
}
