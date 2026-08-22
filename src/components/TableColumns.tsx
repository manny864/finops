"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { IconColumns } from "@tabler/icons-react";

/**
 * Configuración de columnas de tabla (visibilidad + persistencia).
 *
 * Este hook y su menú estaban duplicados literalmente en 11 paneles
 * (`src/components/governance/*`, `src/components/cleanup/*`). Acá viven una
 * sola vez para las tablas nuevas; los paneles existentes siguen con su copia
 * local y se pueden migrar de a uno sin tocar esta implementación.
 *
 * El ancho de columna NO se guarda acá: lo maneja `ResizableTh` sobre el DOM.
 * Lo persistido es la visibilidad, que es lo que sobrevive a un remount.
 */
export interface TableColumnConfig {
    id: string;
    label: string;
    visible: boolean;
}

export function useColumnConfig(storageKey: string, defaults: TableColumnConfig[]) {
    const [columns, setColumns] = useState<TableColumnConfig[]>(defaults);
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const saved = localStorage.getItem(storageKey);
            if (!saved) return;
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed)) return;
            setColumns((prev) =>
                prev.map((c) => {
                    const m = parsed.find((p: { id?: string }) => p?.id === c.id);
                    return m ? { ...c, visible: Boolean(m.visible) } : c;
                })
            );
        } catch {
            // Preferencia corrupta: se ignora y quedan los defaults.
        }
    }, [storageKey]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            localStorage.setItem(storageKey, JSON.stringify(columns.map((c) => ({ id: c.id, visible: c.visible }))));
        } catch {
            // Cuota llena o modo privado: la tabla sigue funcionando sin persistir.
        }
    }, [columns, storageKey]);

    useEffect(() => {
        function onOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", onOutside);
        return () => document.removeEventListener("mousedown", onOutside);
    }, []);

    const isVisible = useCallback((id: string) => columns.find((c) => c.id === id)?.visible ?? true, [columns]);
    const toggle = useCallback(
        (id: string) => setColumns((p) => p.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c))),
        []
    );
    return { columns, isVisible, toggle, open, setOpen, menuRef };
}

export function ColumnMenu({ columns, toggle, open, setOpen, menuRef, label = "Personalizar Columnas" }:
    ReturnType<typeof useColumnConfig> & { label?: string }) {
    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setOpen(!open)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
            >
                <IconColumns size={16} className="inline mr-1.5 text-[#0078D4]" stroke={1.5} />
                {label}
            </button>
            {open && (
                <div className="absolute right-0 mt-1 w-60 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-[100] space-y-0.5">
                    {columns.map((c) => (
                        <label
                            key={c.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                            <input type="checkbox" checked={c.visible} onChange={() => toggle(c.id)} className="accent-[#0054A6] cursor-pointer" />
                            {c.label}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * Clases del contenedor con scroll horizontal. macOS oculta el scrollbar hasta
 * que hay movimiento, así que se fuerza su visibilidad: sin esto una tabla
 * ancha parece cortada y no hay pista de que se puede desplazar.
 */
export const SCROLL_X =
    "overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
    "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 " +
    "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
    "dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 " +
    "dark:[&::-webkit-scrollbar-track]:bg-slate-800";

/** Celda con texto adaptable: ancho acotado y truncado con tooltip nativo. */
export const CELL = "min-w-[120px] max-w-[240px] truncate";
