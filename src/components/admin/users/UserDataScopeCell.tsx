"use client";
/**
 * MEJ-38 — el alcance de DATOS de un usuario: a qué grupo de una Perspective
 * queda acotado. No es "Alcance de páginas" (qué módulos ve): esto recorta los
 * importes DENTRO de las pantallas, y le saca las que no saben recortar.
 *
 * Antes se asignaba sólo por API. El servidor valida todo —rol, Perspective,
 * grupo—; acá se ofrece sólo lo que va a aceptar: a un Admin u Owner no se le
 * ofrece, porque podría emitirse una clave de API por tenant y saltearlo.
 */
import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { IconLoader2, IconLock, IconX } from "@tabler/icons-react";
import { errorMessage } from "@/lib/apiErrors";
import type { TenantUserRole } from "@/types/tenantUsers.types";

export interface PerspectivaConGrupos {
    id: number;
    name: string;
    reglas: { grupo: string | null }[];
}

export interface AlcanceDeDatos {
    email: string;
    perspectiveId: number;
    perspectiveName: string | null;
    grupo: string | null;
}

const BTN =
    "text-xs font-semibold rounded-lg border px-2.5 py-1 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50";

export default function UserDataScopeCell({
    email, rol, asignado, perspectivas, tenantId, authHeaders, onChanged,
}: {
    email: string;
    rol: TenantUserRole;
    asignado: AlcanceDeDatos | null;
    perspectivas: PerspectivaConGrupos[];
    tenantId: string;
    authHeaders: () => Promise<Record<string, string>>;
    onChanged: () => void;
}) {
    const t = useTranslations("AdminUsers");
    const [abierto, setAbierto] = useState(false);
    const [perspectiva, setPerspectiva] = useState<number | null>(null);
    const [grupo, setGrupo] = useState("");
    const [guardando, setGuardando] = useState(false);

    const sinAlcancePosible = rol === "ADMIN" || rol === "OWNER";

    // Los grupos salen de las reglas, igual que en el selector del encabezado.
    const grupos = useMemo(() => {
        const p = perspectivas.find((x) => x.id === perspectiva);
        return [...new Set((p?.reglas ?? []).map((r) => r.grupo).filter((g): g is string => Boolean(g)))];
    }, [perspectivas, perspectiva]);

    const abrir = () => {
        setPerspectiva(asignado?.perspectiveId ?? perspectivas[0]?.id ?? null);
        setGrupo(asignado?.grupo ?? "");
        setAbierto(true);
    };

    const guardar = async () => {
        if (perspectiva === null) return;
        setGuardando(true);
        try {
            const res = await fetch("/api/admin/user-scopes", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await authHeaders()) },
                body: JSON.stringify({ tenantId, email, perspectiveId: perspectiva, group: grupo || null }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || t("dataScopeSaveError"));
            toast.success(t("dataScopeSaved", { email }));
            setAbierto(false);
            onChanged();
        } catch (e) {
            toast.error(errorMessage(e) || t("dataScopeSaveError"));
        } finally {
            setGuardando(false);
        }
    };

    const quitar = async () => {
        if (!confirm(t("dataScopeRemoveConfirm", { email }))) return;
        setGuardando(true);
        try {
            const res = await fetch(
                `/api/admin/user-scopes?tenantId=${encodeURIComponent(tenantId)}&email=${encodeURIComponent(email)}`,
                { method: "DELETE", headers: await authHeaders() },
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || t("dataScopeSaveError"));
            toast.success(t("dataScopeRemoved", { email }));
            onChanged();
        } catch (e) {
            toast.error(errorMessage(e) || t("dataScopeSaveError"));
        } finally {
            setGuardando(false);
        }
    };

    return (
        <>
            <div className="flex items-center gap-1.5 whitespace-nowrap">
                {asignado ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-[3px] rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                        <IconLock size={12} stroke={2} />
                        {asignado.perspectiveName ?? `#${asignado.perspectiveId}`} · {asignado.grupo ?? t("dataScopeAllGroups")}
                    </span>
                ) : (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">{t("dataScopeNone")}</span>
                )}
                {sinAlcancePosible ? (
                    <span className="text-[11px] text-slate-400" title={t("dataScopeAdminNotAllowed")}>—</span>
                ) : (
                    <>
                        <button
                            onClick={abrir}
                            disabled={guardando}
                            className={`${BTN} border-[#0078D4] text-[#0078D4] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/30`}
                        >
                            {asignado ? t("dataScopeChange") : t("dataScopeAssign")}
                        </button>
                        {asignado && (
                            <button
                                onClick={quitar}
                                disabled={guardando}
                                aria-label={t("dataScopeRemove")}
                                title={t("dataScopeRemove")}
                                className={`${BTN} border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800`}
                            >
                                <IconX size={12} stroke={2} />
                            </button>
                        )}
                    </>
                )}
            </div>

            {abierto && (
                <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={() => !guardando && setAbierto(false)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={t("dataScopeModalTitle", { email })}
                        className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-5 space-y-4 whitespace-normal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="font-bold text-[15px] text-slate-900 dark:text-white">{t("dataScopeModalTitle", { email })}</h3>

                        {perspectivas.length === 0 ? (
                            <p className="text-[13px] text-slate-600 dark:text-slate-400">{t("dataScopeNoPerspectives")}</p>
                        ) : (
                            <>
                                <p className="text-[12.5px] rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 p-3">
                                    {t("dataScopeWarning")}
                                </p>
                                <label className="block text-[12px] font-semibold text-slate-600 dark:text-slate-400">
                                    {t("dataScopePerspective")}
                                    <select
                                        value={perspectiva ?? ""}
                                        onChange={(e) => { setPerspectiva(Number(e.target.value)); setGrupo(""); }}
                                        className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                    >
                                        {perspectivas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                </label>
                                <label className="block text-[12px] font-semibold text-slate-600 dark:text-slate-400">
                                    {t("dataScopeGroup")}
                                    <select
                                        value={grupo}
                                        onChange={(e) => setGrupo(e.target.value)}
                                        className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                    >
                                        <option value="">{t("dataScopeAllGroups")}</option>
                                        {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
                                    </select>
                                </label>
                            </>
                        )}

                        <div className="flex justify-end gap-2 pt-1">
                            <button
                                onClick={() => setAbierto(false)}
                                disabled={guardando}
                                className={`${BTN} py-1.5 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800`}
                            >
                                {t("dataScopeCancel")}
                            </button>
                            {perspectivas.length > 0 && (
                                <button
                                    onClick={guardar}
                                    disabled={guardando || perspectiva === null}
                                    className={`${BTN} py-1.5 border-[#0078D4] bg-[#0078D4] text-white hover:bg-[#0060AA] inline-flex items-center gap-1`}
                                >
                                    {guardando && <IconLoader2 size={13} className="animate-spin" />}
                                    {t("dataScopeSave")}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
