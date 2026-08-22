"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import {
    IconAlertTriangle,
    IconCheck,
    IconClockCheck,
    IconCopy,
    IconDeviceMobileCheck,
    IconDownload,
    IconEye,
    IconEyeOff,
    IconKey,
    IconLoader2,
    IconLockOff,
    IconSearch,
    IconShieldCheck,
    IconSparkles,
    IconTrash,
    IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import { CELL, ColumnMenu, SCROLL_X, useColumnConfig, type TableColumnConfig } from "@/components/TableColumns";
import { KpiCard, formatDateTime } from "@/components/support/supportUi";
import { isFailureEvent, needsRecoveryCodesRefresh } from "@/services/user2fa.service";
import type { Security2faPayload, SecurityAuditEvent, TwoFactorMethod } from "@/types/security2fa.types";

/**
 * Seguridad (2FA) de la cuenta en esta plataforma.
 *
 * Ojo con la distinción: acá se gestiona el segundo factor **de la cuenta del
 * usuario en el SaaS**. El badge de 2FA de la pestaña "Usuarios y Permisos" es
 * otro dato — el registro de MFA en el directorio del cliente (Entra ID). Un
 * usuario puede tener uno y no el otro.
 *
 * RBAC: cada usuario gestiona su propio segundo factor y ve su propia bitácora.
 * Las rutas filtran por el email del token, nunca por un parámetro del cliente.
 */

const LOG_COLUMNS: TableColumnConfig[] = [
    { id: "timestamp", label: "Fecha y hora", visible: true },
    { id: "event", label: "Evento de seguridad", visible: true },
    { id: "method", label: "Método utilizado", visible: true },
    { id: "ip", label: "Dirección IP", visible: true },
    { id: "device", label: "Navegador / dispositivo", visible: true },
    { id: "result", label: "Resultado", visible: true },
];

/**
 * Eventos con etiqueta traducida. Un tipo que no esté acá se muestra crudo en
 * vez de romper la fila: `next-intl` lanza si la clave no existe, y la bitácora
 * puede traer eventos escritos por una versión más nueva del backend.
 */
const EVENT_I18N: Record<string, string> = {
    MFA_ENROLLED: "event_MFA_ENROLLED",
    MFA_DISABLED: "event_MFA_DISABLED",
    LOGIN_2FA_SUCCESS: "event_LOGIN_2FA_SUCCESS",
    LOGIN_2FA_FAILED: "event_LOGIN_2FA_FAILED",
    LOGIN_RECOVERY_CODE_USED: "event_LOGIN_RECOVERY_CODE_USED",
    RECOVERY_CODES_REGENERATED: "event_RECOVERY_CODES_REGENERATED",
    SECURITY_KEY_REGISTERED: "event_SECURITY_KEY_REGISTERED",
    SECURITY_KEY_REMOVED: "event_SECURITY_KEY_REMOVED",
    SECURITY_KEY_USED: "event_SECURITY_KEY_USED",
};

const METHOD_LABEL: Record<TwoFactorMethod, string> = {
    TOTP: "method_TOTP",
    FIDO2_WEBAUTHN: "method_FIDO2_WEBAUTHN",
    RECOVERY_CODE: "method_RECOVERY_CODE",
};

const TH = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400";
const TD = "px-3 py-2.5 text-[12.5px] text-slate-700 dark:text-slate-300 align-middle";

export default function SecurityPanel() {
    const t = useTranslations("AdminSecurity");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tenantId = selectedTenant?.id || "";

    const [payload, setPayload] = useState<Security2faPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    // Enrolamiento TOTP
    const [showEnroll, setShowEnroll] = useState(false);
    const [enrolling, setEnrolling] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [qrCode, setQrCode] = useState("");
    const [manualSecret, setManualSecret] = useState("");
    const [totp, setTotp] = useState("");

    // Códigos de recuperación
    const [codes, setCodes] = useState<string[]>([]);
    const [showCodesModal, setShowCodesModal] = useState(false);
    const [showRegenModal, setShowRegenModal] = useState(false);
    const [regenToken, setRegenToken] = useState("");
    const [regenerating, setRegenerating] = useState(false);
    const [codesVisible, setCodesVisible] = useState(false);

    // Deshabilitar y llaves
    const [showDisable, setShowDisable] = useState(false);
    const [disableToken, setDisableToken] = useState("");
    const [disabling, setDisabling] = useState(false);
    const [addingKey, setAddingKey] = useState(false);

    const cols = useColumnConfig(`table_columns_config_2fa_logs_${tenantId}`, LOG_COLUMNS);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const load = useCallback(async () => {
        if (accounts.length === 0) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/mfa/audit", { headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setPayload(json as Security2faPayload);
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setLoading(false);
        }
    }, [accounts.length, authHeaders, t]);

    useEffect(() => {
        load();
    }, [load]);

    const startEnroll = async () => {
        setEnrolling(true);
        setShowEnroll(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/mfa/enroll/start", { method: "POST", headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error?.message || json.error);
            setQrCode(json.qrCodeDataUrl);
            setManualSecret(json.manualSecret);
            setCodes(json.recoveryCodes || []);
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
            setShowEnroll(false);
        } finally {
            setEnrolling(false);
        }
    };

    const confirmEnroll = async () => {
        setVerifying(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/mfa/enroll/verify", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ token: totp.trim() }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error?.message || json.error);
            toast.success(t("enrollOk"));
            setShowEnroll(false);
            setTotp("");
            // Los códigos se muestran ahora: es la única vez que existen en claro.
            setShowCodesModal(true);
            await load();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorInvalidToken"));
        } finally {
            setVerifying(false);
        }
    };

    const regenerate = async () => {
        setRegenerating(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/mfa/recovery-codes/regenerate", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ token: regenToken.trim() }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setCodes(json.recoveryCodes || []);
            setShowRegenModal(false);
            setRegenToken("");
            setShowCodesModal(true);
            toast.success(t("regenOk"));
            await load();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setRegenerating(false);
        }
    };

    const disable2fa = async () => {
        setDisabling(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/mfa/disable", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ token: disableToken.trim() }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error?.message || json.error);
            toast.success(t("disableOk"));
            setShowDisable(false);
            setDisableToken("");
            await load();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setDisabling(false);
        }
    };

    /**
     * Registro de llave FIDO2. El navegador es el único que puede hablar con el
     * autenticador, así que la librería del cliente se carga en demanda: es
     * inútil en el bundle de todos los que nunca registran una llave.
     */
    const addSecurityKey = async () => {
        setAddingKey(true);
        try {
            const headers = await authHeaders();
            const optRes = await fetch("/api/mfa/webauthn/register", { headers });
            const optJson = await optRes.json();
            if (!optRes.ok) throw new Error(optJson.error);

            const { startRegistration } = await import("@simplewebauthn/browser");
            const credential = await startRegistration({ optionsJSON: optJson.options });

            const res = await fetch("/api/mfa/webauthn/register", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ credential, friendlyName: navigator.platform || "Llave de seguridad" }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(t("keyAdded"));
            await load();
        } catch (e) {
            // El usuario cancelando el diálogo del navegador no es un error que
            // valga un toast rojo.
            const msg = errorMessage(e);
            if (/NotAllowedError|abort/i.test(msg)) toast.info(t("keyCancelled"));
            else toast.error(msg || t("errorGeneric"));
        } finally {
            setAddingKey(false);
        }
    };

    const removeKey = async (id: string, name: string) => {
        if (!confirm(t("confirmRemoveKey", { name }))) return;
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/mfa/webauthn/register?id=${encodeURIComponent(id)}`, { method: "DELETE", headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(t("keyRemoved"));
            await load();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        }
    };

    const copyCodes = () => {
        navigator.clipboard?.writeText(codes.join("\n"));
        toast.success(t("codesCopied"));
    };

    const downloadCodes = () => {
        const header = t("codesFileHeader");
        const blob = new Blob([`${header}\n\n${codes.join("\n")}\n`], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "cscloudsolutions-recovery-codes.txt";
        a.click();
        URL.revokeObjectURL(url);
    };

    const status = payload?.status;
    const events = payload?.events || [];
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return events;
        return events.filter(
            (e) =>
                e.eventType.toLowerCase().includes(q) ||
                e.ipAddress.toLowerCase().includes(q) ||
                e.deviceLabel.toLowerCase().includes(q)
        );
    }, [events, search]);
    const pg = usePagination(filtered, 15);

    const remaining = status?.remainingRecoveryCodesCount ?? 0;
    const lowCodes = Boolean(status?.isEnabled) && needsRecoveryCodesRefresh(remaining);

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-5">
                <h1 className="font-heading font-extrabold text-[20px] text-slate-900 dark:text-white flex items-center">
                    <IconShieldCheck size={24} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                    {t("title")}
                    <InfoTooltip content={t("titleHelp")} />
                </h1>
                <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>

            {payload?.mock && (
                <div className="mb-4 text-[12px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                    {t("mockBanner")}
                </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
                <KpiCard
                    icon={IconShieldCheck}
                    label={t("kpiStatus")}
                    value={status?.isEnabled ? t("kpiStatusOn") : t("kpiStatusOff")}
                    tone="#0078D4"
                    tooltip={<InfoTooltip content={t("kpiStatusHelp")} />}
                />
                <KpiCard
                    icon={IconDeviceMobileCheck}
                    label={t("kpiPrimary")}
                    value={status?.isEnabled ? t(METHOD_LABEL[status.primaryMethod] as never) : "—"}
                    tone="#2563EB"
                    hint={status?.registeredSecurityKeysCount ? t("kpiKeysCount", { count: status.registeredSecurityKeysCount }) : undefined}
                    tooltip={<InfoTooltip content={t("kpiPrimaryHelp")} />}
                />
                <KpiCard
                    icon={IconKey}
                    label={t("kpiCodes")}
                    value={remaining}
                    tone="#0284C7"
                    hint={lowCodes ? t("kpiCodesLow") : t("kpiCodesOk")}
                    badge={lowCodes ? <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> : undefined}
                    tooltip={<InfoTooltip content={t("kpiCodesHelp")} />}
                />
                <KpiCard
                    icon={IconClockCheck}
                    label={t("kpiLastAuth")}
                    value={status?.lastUsedAt ? formatDateTime(status.lastUsedAt) : "—"}
                    tone="#1B2A41"
                    tooltip={<InfoTooltip content={t("kpiLastAuthHelp")} />}
                />
            </div>

            {/* Tarjeta principal */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl mb-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="font-heading font-bold text-[15px] text-slate-900 dark:text-white flex items-center">
                            {t("cardTitle")}
                            <InfoTooltip content={t("cardHelp")} />
                            <span
                                className={`ml-2 text-[11px] font-semibold px-2 py-[3px] rounded-md ${status?.isEnabled
                                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                                    }`}
                            >
                                {status?.isEnabled ? t("badgeActive") : t("badgeInactive")}
                            </span>
                        </h2>
                        <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-1">
                            {status?.isEnabled
                                ? status.lastUsedAt
                                    ? t("cardBodyOnWithUse", { date: formatDateTime(status.lastUsedAt) })
                                    : t("cardBodyOn")
                                : t("cardBodyOff")}
                        </p>
                    </div>
                </div>

                {lowCodes && (
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-4 rounded-lg flex items-center justify-between gap-3 flex-wrap mt-4">
                        <span className="text-[13px] text-slate-700 dark:text-slate-300">
                            <IconAlertTriangle size={18} stroke={1.5} className="text-amber-600 inline mr-2" />
                            {t("codesWarning", { count: remaining })}
                        </span>
                        <button
                            onClick={() => setShowRegenModal(true)}
                            className="bg-[#0078D4] text-white hover:bg-[#0060AA] px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer whitespace-nowrap"
                        >
                            <IconSparkles size={16} stroke={1.5} className="inline mr-1" />
                            {t("generateCodes")}
                        </button>
                    </div>
                )}

                {(status?.securityKeys?.length ?? 0) > 0 && (
                    <div className="mt-4">
                        <h3 className="text-[13px] font-bold text-slate-900 dark:text-white mb-2 flex items-center">
                            {t("registeredKeys")}
                            <InfoTooltip content={t("registeredKeysHelp")} />
                        </h3>
                        <div className="flex flex-col gap-1.5">
                            {status!.securityKeys.map((k) => (
                                <div
                                    key={k.id}
                                    className="flex items-center gap-3 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2"
                                >
                                    <IconKey size={16} stroke={1.5} className="text-[#0078D4] shrink-0" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[13px] font-semibold text-slate-900 dark:text-white truncate">{k.friendlyName}</span>
                                        <span className="block text-[11px] text-slate-500">
                                            {k.lastUsedAt ? t("keyLastUsed", { date: formatDateTime(k.lastUsedAt) }) : t("keyNeverUsed")}
                                            {k.isBackedUp ? ` · ${t("keySynced")}` : ""}
                                        </span>
                                    </span>
                                    <button onClick={() => removeKey(k.id, k.friendlyName)} className="cursor-pointer" aria-label={t("removeKey")}>
                                        <IconTrash size={16} stroke={1.5} className="text-rose-500 hover:text-rose-700" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-2 flex-wrap mt-5">
                    <button
                        onClick={startEnroll}
                        className="text-xs font-semibold rounded-lg border border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer whitespace-nowrap"
                    >
                        <IconDeviceMobileCheck size={16} stroke={1.5} className="inline mr-1" />
                        {status?.isEnabled ? t("setupAnotherApp") : t("setupApp")}
                    </button>
                    <button
                        onClick={addSecurityKey}
                        disabled={addingKey}
                        className="text-xs font-semibold rounded-lg border border-[#00AEEF] text-[#00AEEF] bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                        {addingKey ? <IconLoader2 size={16} className="inline mr-1 animate-spin" /> : <IconKey size={16} stroke={1.5} className="inline mr-1" />}
                        {t("addSecurityKey")}
                    </button>
                    {status?.isEnabled && (
                        <>
                            <button
                                onClick={() => setShowRegenModal(true)}
                                className="text-xs font-semibold rounded-lg border border-emerald-600 text-emerald-600 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer whitespace-nowrap"
                            >
                                <IconSparkles size={16} stroke={1.5} className="inline mr-1" />
                                {t("generateCodes")}
                            </button>
                            <button
                                onClick={() => setShowDisable(true)}
                                className="text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer whitespace-nowrap"
                            >
                                <IconLockOff size={16} stroke={1.5} className="inline mr-1 text-slate-500" />
                                {t("disable2fa")}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Bitácora */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="p-3 flex items-center justify-between gap-3 flex-wrap border-b border-slate-200 dark:border-slate-800">
                    <h2 className="font-heading font-bold text-[14px] text-slate-900 dark:text-white flex items-center">
                        {t("logTitle")}
                        <InfoTooltip content={t("logHelp")} />
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative">
                            <IconSearch size={14} stroke={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t("logSearchPlaceholder")}
                                className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] w-56"
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
                        <IconShieldCheck size={40} stroke={1.5} className="text-[#0078D4] mx-auto mb-3" />
                        <div className="font-bold text-[15px] text-slate-900 dark:text-white">{t("logEmptyTitle")}</div>
                        <div className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">{t("logEmptyBody")}</div>
                    </div>
                ) : (
                    <>
                        <div className={SCROLL_X}>
                            <table className="w-full table-fixed">
                                <thead className="bg-slate-50 dark:bg-slate-800/50">
                                    <tr>
                                        {LOG_COLUMNS.filter((c) => cols.isVisible(c.id)).map((c) => (
                                            <ResizableTh key={c.id} minWidth={100} className={TH}>
                                                {t(`col_${c.id}` as never)}
                                                <InfoTooltip content={t(`col_${c.id}_help` as never)} />
                                            </ResizableTh>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pg.paged.map((e: SecurityAuditEvent) => {
                                        const failed = isFailureEvent(e.eventType, e.isSuccess);
                                        return (
                                            <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                                                {cols.isVisible("timestamp") && <td className={TD}>{formatDateTime(e.timestamp)}</td>}
                                                {cols.isVisible("event") && (
                                                    <td className={TD}>
                                                        <div className={`${CELL} font-semibold text-slate-900 dark:text-white`} title={e.eventType}>
                                                            {EVENT_I18N[e.eventType] ? t(EVENT_I18N[e.eventType] as never) : e.eventType}
                                                        </div>
                                                        {e.detail && (
                                                            <div className={`${CELL} text-[11px] text-slate-500`} title={e.detail}>
                                                                {e.detail}
                                                            </div>
                                                        )}
                                                    </td>
                                                )}
                                                {cols.isVisible("method") && (
                                                    <td className={TD}>{e.methodUsed ? t(METHOD_LABEL[e.methodUsed] as never) : "—"}</td>
                                                )}
                                                {cols.isVisible("ip") && <td className={`${TD} font-mono text-[11.5px]`}>{e.ipAddress}</td>}
                                                {cols.isVisible("device") && (
                                                    <td className={TD}>
                                                        <span className={`${CELL} inline-block`} title={e.userAgent}>
                                                            {e.deviceLabel}
                                                        </span>
                                                    </td>
                                                )}
                                                {cols.isVisible("result") && (
                                                    <td className={TD}>
                                                        <span
                                                            className={`text-[11px] font-semibold px-2 py-[3px] rounded-md ${failed
                                                                ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800"
                                                                : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                                                                }`}
                                                        >
                                                            {failed ? t("resultFailed") : t("resultOk")}
                                                        </span>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-3">
                            <Pagination {...pg} pageSizes={[15, 30, 45, 60]} />
                        </div>
                    </>
                )}
            </div>

            {/* Modal de enrolamiento */}
            {showEnroll && (
                <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4" onClick={() => !verifying && setShowEnroll(false)}>
                    <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6" onClick={(ev) => ev.stopPropagation()}>
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <h2 className="font-heading font-bold text-[16px] text-slate-900 dark:text-white">{t("enrollTitle")}</h2>
                            <button onClick={() => setShowEnroll(false)} className="cursor-pointer" aria-label={t("close")}>
                                <IconX size={20} stroke={1.5} className="text-slate-400 hover:text-slate-600" />
                            </button>
                        </div>
                        {enrolling ? (
                            <div className="flex items-center gap-2 text-slate-500 text-[13px]">
                                <IconLoader2 size={16} className="animate-spin text-[#0078D4]" /> {t("loading")}
                            </div>
                        ) : (
                            <>
                                <p className="text-[13px] text-slate-600 dark:text-slate-400 mb-3">{t("enrollStep1")}</p>
                                {qrCode && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={qrCode} alt={t("enrollQrAlt")} className="w-44 h-44 mx-auto rounded-lg border border-slate-200 dark:border-slate-700" />
                                )}
                                <p className="text-[11.5px] text-slate-500 text-center mt-2">{t("enrollManual")}</p>
                                <code className="block text-center font-mono text-[12px] text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 rounded-lg py-2 mt-1 break-all">
                                    {manualSecret}
                                </code>
                                <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-4 mb-1">{t("enrollStep2")}</p>
                                <input
                                    value={totp}
                                    onChange={(ev) => setTotp(ev.target.value.replace(/\D/g, "").slice(0, 6))}
                                    inputMode="numeric"
                                    placeholder="000000"
                                    className="w-full text-center tracking-[0.4em] font-mono text-[18px] border border-slate-300 dark:border-slate-700 rounded-lg py-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4]"
                                />
                                <button
                                    onClick={confirmEnroll}
                                    disabled={verifying || totp.length !== 6}
                                    className="w-full mt-4 bg-[#0078D4] text-white hover:bg-[#0060AA] font-semibold py-2.5 rounded-lg text-[13px] flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                                >
                                    {verifying ? <IconLoader2 size={16} className="animate-spin" /> : <IconCheck size={16} stroke={2} />}
                                    {t("enrollConfirm")}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Modal de códigos */}
            {showCodesModal && codes.length > 0 && (
                <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4">
                    <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6">
                        <h2 className="font-heading font-bold text-[16px] text-slate-900 dark:text-white mb-1">{t("codesTitle")}</h2>
                        <p className="text-[12.5px] text-slate-600 dark:text-slate-400 mb-4">{t("codesBody")}</p>

                        <div className="grid grid-cols-2 gap-2">
                            {codes.map((c, i) => (
                                <code
                                    key={i}
                                    className="font-mono text-[13px] text-center text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2"
                                >
                                    {codesVisible ? c : "•".repeat(c.length)}
                                </code>
                            ))}
                        </div>

                        <div className="flex items-center justify-between gap-2 mt-4 flex-wrap">
                            <button
                                onClick={() => setCodesVisible(!codesVisible)}
                                className="text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer"
                            >
                                {codesVisible ? <IconEyeOff size={16} stroke={1.5} className="inline mr-1" /> : <IconEye size={16} stroke={1.5} className="inline mr-1" />}
                                {codesVisible ? t("codesHide") : t("codesShow")}
                            </button>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={copyCodes}
                                    className="text-xs font-semibold rounded-lg border border-emerald-600 text-emerald-600 bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer"
                                >
                                    <IconCopy size={16} stroke={1.5} className="inline mr-1" />
                                    {t("codesCopyAll")}
                                </button>
                                <button
                                    onClick={downloadCodes}
                                    className="text-xs font-semibold rounded-lg border border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer"
                                >
                                    <IconDownload size={16} stroke={1.5} className="inline mr-1" />
                                    {t("codesDownload")}
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                setShowCodesModal(false);
                                setCodes([]);
                                setCodesVisible(false);
                            }}
                            className="w-full mt-4 bg-[#0078D4] text-white hover:bg-[#0060AA] font-semibold py-2.5 rounded-lg text-[13px] cursor-pointer"
                        >
                            {t("codesSaved")}
                        </button>
                    </div>
                </div>
            )}

            {/* Modal de regeneración */}
            {showRegenModal && (
                <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4" onClick={() => !regenerating && setShowRegenModal(false)}>
                    <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6" onClick={(ev) => ev.stopPropagation()}>
                        <h2 className="font-heading font-bold text-[16px] text-slate-900 dark:text-white mb-1">{t("regenTitle")}</h2>
                        <p className="text-[12.5px] text-slate-600 dark:text-slate-400 mb-4">{t("regenBody")}</p>
                        <input
                            value={regenToken}
                            onChange={(ev) => setRegenToken(ev.target.value.replace(/\D/g, "").slice(0, 6))}
                            inputMode="numeric"
                            placeholder="000000"
                            className="w-full text-center tracking-[0.4em] font-mono text-[18px] border border-slate-300 dark:border-slate-700 rounded-lg py-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4]"
                        />
                        <div className="flex items-center gap-2 mt-4">
                            <button
                                onClick={() => setShowRegenModal(false)}
                                className="flex-1 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 font-semibold py-2.5 rounded-lg text-[13px] cursor-pointer"
                            >
                                {t("cancel")}
                            </button>
                            <button
                                onClick={regenerate}
                                disabled={regenerating || regenToken.length !== 6}
                                className="flex-1 bg-[#0078D4] text-white hover:bg-[#0060AA] font-semibold py-2.5 rounded-lg text-[13px] flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                            >
                                {regenerating ? <IconLoader2 size={16} className="animate-spin" /> : <IconSparkles size={16} stroke={1.5} />}
                                {t("generateCodes")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de deshabilitar */}
            {showDisable && (
                <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4" onClick={() => !disabling && setShowDisable(false)}>
                    <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6" onClick={(ev) => ev.stopPropagation()}>
                        <h2 className="font-heading font-bold text-[16px] text-slate-900 dark:text-white mb-1">{t("disableTitle")}</h2>
                        <p className="text-[12.5px] text-slate-600 dark:text-slate-400 mb-4">{t("disableBody")}</p>
                        <input
                            value={disableToken}
                            onChange={(ev) => setDisableToken(ev.target.value.trim().slice(0, 24))}
                            placeholder={t("disablePlaceholder")}
                            className="w-full text-center font-mono text-[15px] border border-slate-300 dark:border-slate-700 rounded-lg py-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4]"
                        />
                        <div className="flex items-center gap-2 mt-4">
                            <button
                                onClick={() => setShowDisable(false)}
                                className="flex-1 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 font-semibold py-2.5 rounded-lg text-[13px] cursor-pointer"
                            >
                                {t("cancel")}
                            </button>
                            <button
                                onClick={disable2fa}
                                disabled={disabling || disableToken.length < 6}
                                className="flex-1 border border-rose-300 dark:border-rose-800 text-rose-600 bg-white dark:bg-slate-900 font-semibold py-2.5 rounded-lg text-[13px] flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                            >
                                {disabling ? <IconLoader2 size={16} className="animate-spin" /> : <IconLockOff size={16} stroke={1.5} />}
                                {t("disable2fa")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
