"use client";

/**
 * MEJ-38 — vistas guardadas, al lado del selector de Perspective.
 *
 * Aplicar una vista es EXACTAMENTE escribir los mismos parámetros de URL que el
 * usuario podría poner a mano: reusa `setScope` de `usePerspectiveScope` en vez
 * de tener su propio camino. Si una vista pudiera llevar a un estado que la URL
 * no alcanza, sería un permiso disfrazado de comodidad.
 *
 * NO SE DIBUJA para un usuario con alcance asignado. Su recorte no se elige, no
 * se guarda y no se cambia; ofrecerle un selector de vistas sería sugerir que
 * puede moverse. La API además se lo niega (MEJ-38, default-deny), así que esto
 * es para no mostrar un control que va a fallar.
 *
 * Compartir y marcar como predeterminada antes sólo se podía por API. Compartir
 * (y borrar o cambiar una compartida) lo ofrece sólo a Admin y Owner, que es lo
 * que la API exige: una compartida la ve —y la pierde— todo el tenant.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import { useTenant } from "@/components/TenantProvider";
import { usePerspectiveScope, useAlcanceAsignado } from "@/components/PerspectiveScopeSelector";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/demoTenant";
import { IconBookmark, IconStar, IconStarFilled, IconTrash } from "@tabler/icons-react";

interface Vista {
    id: number;
    name: string;
    perspectiveId: number | null;
    groupName: string | null;
    isDefault: boolean;
    shared: boolean;
    canDelete: boolean;
}

/**
 * La predeterminada que se aplica al entrar. La PERSONAL gana sobre la del
 * equipo: puede haber una de cada una (la base admite una por dueño), y la que
 * eligió el usuario es más específica que la que se eligió para todos. La API
 * devuelve primero las compartidas, así que tomar la primera daba lo contrario.
 */
export function predeterminadaQueAplica<V extends { isDefault: boolean; shared: boolean; perspectiveId: number | null }>(
    vistas: V[],
): V | null {
    const candidatas = vistas.filter((v) => v.isDefault && v.perspectiveId !== null);
    return candidatas.find((v) => !v.shared) ?? candidatas[0] ?? null;
}

export default function SavedViewSelector() {
    const t = useTranslations("Views");
    const { selectedTenant, userRole } = useTenant();
    const { instance, accounts } = useMsal();
    const tenantId = selectedTenant?.id || "";
    const esMock = isMockTenant(tenantId);
    const esAdmin = userRole === "Admin" || userRole === "Owner";
    const { perspectiveId, group, setScope } = usePerspectiveScope();
    const { scope: alcanceAsignado } = useAlcanceAsignado();

    const [abierto, setAbierto] = useState(false);
    const [formulario, setFormulario] = useState<{ nombre: string; predeterminada: boolean; compartida: boolean } | null>(null);
    const [ocupado, setOcupado] = useState(false);
    const yaAplicoLaPredeterminada = useRef(false);

    // La API exige la sesión en los tres métodos. Antes no se mandaba y para
    // cualquier tenant real las vistas no cargaban ni se guardaban.
    const cabeceras = useCallback(async (): Promise<Record<string, string>> => (
        esMock ? {} : { Authorization: `Bearer ${await getFreshIdToken(instance, accounts[0])}` }
    ), [esMock, instance, accounts]);

    const { data, mutate } = useSWR<{ views: Vista[] }>(
        tenantId && !alcanceAsignado && (esMock || accounts.length > 0)
            ? `/api/intelligence/views?tenantId=${encodeURIComponent(tenantId)}`
            : null,
        async (url: string) => {
            const r = await fetch(url, { headers: await cabeceras() });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        },
        { revalidateOnFocus: false }
    );
    const vistas = useMemo(() => data?.views ?? [], [data]);

    /**
     * La predeterminada se aplica UNA vez y sólo si la URL no dice otra cosa.
     * El `ref` no es decorativo: sin él, `setScope` cambia la URL, el efecto
     * vuelve a correr y se navega en círculo.
     */
    useEffect(() => {
        if (yaAplicoLaPredeterminada.current) return;
        if (perspectiveId !== null || vistas.length === 0) return;
        const porDefecto = predeterminadaQueAplica(vistas);
        if (!porDefecto) return;
        yaAplicoLaPredeterminada.current = true;
        setScope(porDefecto.perspectiveId, porDefecto.groupName);
    }, [vistas, perspectiveId, setScope]);

    /** Crea o pisa (por nombre y dueño) una vista. */
    const escribir = useCallback(async (cuerpo: {
        name: string; perspectiveId: number | null; groupName: string | null; shared: boolean; isDefault: boolean;
    }) => {
        setOcupado(true);
        try {
            const r = await fetch("/api/intelligence/views", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await cabeceras()) },
                body: JSON.stringify({ tenantId, ...cuerpo }),
            });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
            await mutate();
            return true;
        } catch (e) {
            toast.error(t("saveError"), { description: e instanceof Error ? e.message : undefined });
            return false;
        } finally {
            setOcupado(false);
        }
    }, [cabeceras, tenantId, mutate, t]);

    const guardar = async () => {
        if (!formulario?.nombre.trim()) return;
        const ok = await escribir({
            name: formulario.nombre.trim(),
            perspectiveId,
            groupName: group,
            shared: esAdmin && formulario.compartida,
            isDefault: formulario.predeterminada,
        });
        if (ok) { setFormulario(null); setAbierto(false); }
    };

    const alternarPredeterminada = (v: Vista) =>
        escribir({ name: v.name, perspectiveId: v.perspectiveId, groupName: v.groupName, shared: v.shared, isDefault: !v.isDefault });

    const borrar = useCallback(
        async (id: number) => {
            setOcupado(true);
            try {
                const r = await fetch(`/api/intelligence/views?tenantId=${encodeURIComponent(tenantId)}&id=${id}`, {
                    method: "DELETE",
                    headers: await cabeceras(),
                });
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
                await mutate();
            } catch (e) {
                toast.error(t("deleteError"), { description: e instanceof Error ? e.message : undefined });
            } finally {
                setOcupado(false);
            }
        },
        [tenantId, cabeceras, mutate, t]
    );

    // Un control que no puede hacer nada no se dibuja: sin vistas y sin un
    // alcance activo que guardar, sólo ocuparía lugar en el header.
    if (alcanceAsignado) return null;
    if (vistas.length === 0 && perspectiveId === null) return null;

    const activa = vistas.find((v) => v.perspectiveId === perspectiveId && (v.groupName ?? null) === (group ?? null));
    // Lo propio se toca siempre; lo compartido, sólo Admin y Owner.
    const puedeTocar = (v: Vista) => !v.shared || esAdmin;

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => { setAbierto((v) => !v); setFormulario(null); }}
                className="flex items-center gap-1.5 text-sm px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                title={t("title")}
            >
                <IconBookmark className="w-4 h-4 opacity-70" />
                <span className="max-w-[10rem] truncate">{activa ? activa.name : t("title")}</span>
            </button>

            {abierto && (
                <div className="absolute right-0 mt-1 w-72 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-50 py-1">
                    {vistas.length === 0 && (
                        <div className="px-3 py-2 text-xs opacity-60">{t("empty")}</div>
                    )}
                    {vistas.map((v) => (
                        <div key={v.id} className="flex items-center gap-1 px-1">
                            <button
                                type="button"
                                onClick={() => { setScope(v.perspectiveId, v.groupName); setAbierto(false); }}
                                className="flex-1 text-left px-2 py-1.5 text-sm rounded hover:bg-black/5 dark:hover:bg-white/10 truncate"
                            >
                                {v.name}
                                {/* Una compartida la ve todo el tenant; conviene que se note
                                    antes de apoyarse en ella como si fuera propia. */}
                                {v.shared && <span className="ml-1 text-[10px] opacity-50">{t("sharedTag")}</span>}
                                {v.isDefault && <span className="ml-1 text-[10px] opacity-50">{t("defaultTag")}</span>}
                            </button>
                            {puedeTocar(v) && (
                                <button
                                    type="button"
                                    onClick={() => alternarPredeterminada(v)}
                                    disabled={ocupado}
                                    className="p-1 opacity-50 hover:opacity-100 disabled:opacity-30"
                                    title={v.isDefault ? t("unsetDefault") : t("setDefault")}
                                    aria-label={v.isDefault ? t("unsetDefault") : t("setDefault")}
                                >
                                    {v.isDefault
                                        ? <IconStarFilled className="w-3.5 h-3.5 text-amber-500" />
                                        : <IconStar className="w-3.5 h-3.5" />}
                                </button>
                            )}
                            {puedeTocar(v) && (
                                <button
                                    type="button"
                                    onClick={() => borrar(v.id)}
                                    disabled={ocupado}
                                    className="p-1 opacity-40 hover:opacity-90 disabled:opacity-20"
                                    title={t("delete")}
                                    aria-label={t("delete")}
                                >
                                    <IconTrash className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    ))}

                    {perspectiveId !== null && (
                        <>
                            <div className="my-1 border-t border-gray-200 dark:border-slate-700" />
                            {formulario ? (
                                <form
                                    className="px-3 py-2 space-y-2"
                                    onSubmit={(e) => { e.preventDefault(); guardar(); }}
                                >
                                    <input
                                        autoFocus
                                        value={formulario.nombre}
                                        maxLength={120}
                                        placeholder={t("namePrompt")}
                                        aria-label={t("namePrompt")}
                                        onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })}
                                        className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm"
                                    />
                                    <label className="flex items-center gap-2 text-xs">
                                        <input
                                            type="checkbox"
                                            checked={formulario.predeterminada}
                                            onChange={(e) => setFormulario({ ...formulario, predeterminada: e.target.checked })}
                                        />
                                        {t("markDefault")}
                                    </label>
                                    {esAdmin && (
                                        <label className="flex items-center gap-2 text-xs" title={t("shareHint")}>
                                            <input
                                                type="checkbox"
                                                checked={formulario.compartida}
                                                onChange={(e) => setFormulario({ ...formulario, compartida: e.target.checked })}
                                            />
                                            {t("shareWithTeam")}
                                        </label>
                                    )}
                                    <div className="flex justify-end gap-2">
                                        <button type="button" onClick={() => setFormulario(null)} className="px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10">
                                            {t("cancel")}
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={ocupado || !formulario.nombre.trim()}
                                            className="px-2 py-1 text-xs font-semibold rounded bg-[#0078D4] text-white disabled:opacity-50"
                                        >
                                            {t("save")}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setFormulario({ nombre: "", predeterminada: false, compartida: false })}
                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                                >
                                    {t("saveCurrent")}
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
