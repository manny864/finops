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
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { usePerspectiveScope, useAlcanceAsignado } from "@/components/PerspectiveScopeSelector";
import { IconBookmark, IconTrash } from "@tabler/icons-react";

interface Vista {
    id: number;
    name: string;
    perspectiveId: number | null;
    groupName: string | null;
    isDefault: boolean;
    shared: boolean;
    canDelete: boolean;
}

export default function SavedViewSelector() {
    const t = useTranslations("Views");
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id || "";
    const { perspectiveId, group, setScope } = usePerspectiveScope();
    const { scope: alcanceAsignado } = useAlcanceAsignado();

    const [abierto, setAbierto] = useState(false);
    const yaAplicoLaPredeterminada = useRef(false);

    const { data, mutate } = useSWR<{ views: Vista[] }>(
        tenantId && !alcanceAsignado ? `/api/intelligence/views?tenantId=${encodeURIComponent(tenantId)}` : null,
        (url: string) => fetch(url).then((r) => r.json()),
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
        const porDefecto = vistas.find((v) => v.isDefault && v.perspectiveId !== null);
        if (!porDefecto) return;
        yaAplicoLaPredeterminada.current = true;
        setScope(porDefecto.perspectiveId, porDefecto.groupName);
    }, [vistas, perspectiveId, setScope]);

    const guardar = useCallback(async () => {
        const nombre = window.prompt(t("namePrompt"));
        if (!nombre?.trim()) return;
        await fetch("/api/intelligence/views", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tenantId, name: nombre.trim(), perspectiveId, groupName: group }),
        });
        await mutate();
        setAbierto(false);
    }, [t, tenantId, perspectiveId, group, mutate]);

    const borrar = useCallback(
        async (id: number) => {
            await fetch(`/api/intelligence/views?tenantId=${encodeURIComponent(tenantId)}&id=${id}`, { method: "DELETE" });
            await mutate();
        },
        [tenantId, mutate]
    );

    // Un control que no puede hacer nada no se dibuja: sin vistas y sin un
    // alcance activo que guardar, sólo ocuparía lugar en el header.
    if (alcanceAsignado) return null;
    if (vistas.length === 0 && perspectiveId === null) return null;

    const activa = vistas.find((v) => v.perspectiveId === perspectiveId && (v.groupName ?? null) === (group ?? null));

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setAbierto((v) => !v)}
                className="flex items-center gap-1.5 text-sm px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                title={t("title")}
            >
                <IconBookmark className="w-4 h-4 opacity-70" />
                <span className="max-w-[10rem] truncate">{activa ? activa.name : t("title")}</span>
            </button>

            {abierto && (
                <div className="absolute right-0 mt-1 w-64 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-50 py-1">
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
                            {v.canDelete && (
                                <button
                                    type="button"
                                    onClick={() => borrar(v.id)}
                                    className="p-1 opacity-40 hover:opacity-90"
                                    title={t("delete")}
                                >
                                    <IconTrash className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    ))}

                    {perspectiveId !== null && (
                        <>
                            <div className="my-1 border-t border-gray-200 dark:border-slate-700" />
                            <button
                                type="button"
                                onClick={guardar}
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                            >
                                {t("saveCurrent")}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
