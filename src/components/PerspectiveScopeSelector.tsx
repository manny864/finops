"use client";

import React, { useCallback, useMemo } from "react";
import useSWR from "swr";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";

/**
 * MEJ-34 — el selector de Perspective transversal.
 *
 * Vive en la barra de alcance, al lado del de suscripción, porque hace lo
 * mismo: acota lo que las pantallas muestran. El alcance viaja en la URL
 * (`?perspective=<id>&pgroup=<grupo>`) con el mismo criterio que `?sub=`, así se
 * comparte por link y sobrevive al refresh.
 *
 * QUÉ SIGNIFICA QUE UNA PANTALLA LO "HONRE". No alcanza con leer el parámetro:
 * la pantalla tiene que filtrar sus filas por el grupo Y que sus totales sigan
 * cuadrando. En un tablero que agrega en SQL eso es trabajo propio, no una línea
 * — por eso el selector no promete filtrar todo: sólo aparece, y cada pantalla
 * lo adopta cuando puede hacerlo bien. Ver en docs/MEJORAS-FUTURAS.md cuáles ya
 * lo hacen.
 */

interface Perspectiva {
    id: number;
    name: string;
    reglas: Array<{ grupo: string }>;
}

/** Lee el alcance de Perspective de la URL y lo escribe. */
export function usePerspectiveScope() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const idCrudo = Number(searchParams.get("perspective"));
    const perspectiveId = Number.isInteger(idCrudo) && idCrudo > 0 ? idCrudo : null;
    const group = searchParams.get("pgroup") || null;

    const setScope = useCallback(
        (id: number | null, grupo: string | null) => {
            const params = new URLSearchParams(searchParams.toString());
            if (id === null) {
                params.delete("perspective");
                params.delete("pgroup");
            } else {
                params.set("perspective", String(id));
                if (grupo) params.set("pgroup", grupo);
                else params.delete("pgroup");
            }
            router.push(`${pathname}?${params.toString()}`);
        },
        [searchParams, router, pathname],
    );

    /** Los parámetros listos para pegar a una URL de API, o cadena vacía. */
    const queryString = useMemo(() => {
        if (perspectiveId === null) return "";
        const p = new URLSearchParams({ perspective: String(perspectiveId) });
        if (group) p.set("pgroup", group);
        return `&${p.toString()}`;
    }, [perspectiveId, group]);

    return { perspectiveId, group, setScope, queryString };
}

/**
 * El aviso de "se pidió acotar por Perspective y no se pudo".
 *
 * Vive acá y no en cada tablero porque en todos es el mismo problema: el
 * alcance se evalúa POR FILA, y una pantalla cuyo costo llega sin procedencia
 * —sin etiquetas ni identificador de recurso— resuelve su reparto aproximando
 * por Resource Group, que no se recorta fila por fila. Cuatro copias del mismo
 * párrafo terminan divergiendo.
 *
 * No dibuja nada si no se pidió alcance, o si sí se aplicó: `aplicado` es el
 * `scopeApplied` que devuelve la ruta.
 */
export function AlcanceNoAplicado({ aplicado }: { aplicado?: boolean }) {
    const t = useTranslations("Perspectives");
    const { perspectiveId } = usePerspectiveScope();
    if (perspectiveId === null || aplicado !== false) return null;
    return (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
            <span aria-hidden className="mt-px shrink-0">⚠</span>
            <span>{t("scopeNotApplied")}</span>
        </div>
    );
}

export default function PerspectiveScopeSelector() {
    const t = useTranslations("Perspectives");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { perspectiveId, group, setScope } = usePerspectiveScope();

    const tenantId = selectedTenant?.id || "";
    const esMock = isMockTenant(tenantId);
    // Sólo Enterprise tiene Perspectives: sin este corte, cada carga de página de
    // un tenant Professional dispara un fetch que termina en 403.
    const esEnterprise = (selectedTenant?.tier || "").toLowerCase() === "enterprise";

    const fetcher = useCallback(
        async (url: string) => {
            const headers: Record<string, string> = esMock
                ? {}
                : { Authorization: `Bearer ${await getFreshIdToken(instance, accounts[0], ["User.Read"])}` };
            const res = await fetch(url, { headers });
            if (!res.ok) throw new Error(String(res.status));
            return res.json();
        },
        [instance, accounts, esMock],
    );

    const { data } = useSWR(
        tenantId && esEnterprise ? `/api/intelligence/perspectives?tenantId=${encodeURIComponent(tenantId)}` : null,
        fetcher,
        { revalidateOnFocus: false, shouldRetryOnError: false },
    );

    const perspectivas: Perspectiva[] = data?.perspectives || [];
    const actual = perspectivas.find((p) => p.id === perspectiveId) || null;

    // Los grupos salen de las reglas y no de un breakdown: alcanza para poblar el
    // selector y evita una segunda consulta de costo en cada carga de página.
    const grupos = useMemo(() => {
        if (!actual) return [];
        return [...new Set(actual.reglas.map((r) => r.grupo).filter(Boolean))];
    }, [actual]);

    if (perspectivas.length === 0) return null;

    return (
        <div className="flex items-center gap-1.5">
            <select
                aria-label={t("scopePerspective")}
                className="rounded-lg border border-line bg-surface-2 p-1.5 text-[12px] font-bold text-ink outline-none"
                value={perspectiveId ?? ""}
                onChange={(e) => setScope(e.target.value ? Number(e.target.value) : null, null)}
            >
                <option value="">{t("scopeAll")}</option>
                {perspectivas.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>

            {actual && (
                <select
                    aria-label={t("scopeGroup")}
                    className="rounded-lg border border-line bg-surface-2 p-1.5 text-[12px] font-bold text-ink outline-none"
                    value={group ?? ""}
                    onChange={(e) => setScope(actual.id, e.target.value || null)}
                >
                    <option value="">{t("scopeEveryGroup")}</option>
                    {grupos.map((g) => (
                        <option key={g} value={g}>{g}</option>
                    ))}
                    {/* El sin asignar es un grupo más y se puede acotar a él: es
                        donde mira quien está tratando de subir la cobertura. */}
                    <option value="__unassigned__">{t("unassigned")}</option>
                </select>
            )}
        </div>
    );
}
