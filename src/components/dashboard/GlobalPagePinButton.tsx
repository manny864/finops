"use client";
import React from "react";
import { usePathname } from "next/navigation";
import PinButton from "./PinButton";
import { findPageForPath, pageWidgetKey } from "@/lib/pageRegistry";
import { useTenant } from "@/components/TenantProvider";

/**
 * Botón flotante "Pinear esta página" — montado una sola vez en el shell.
 * Detecta la ruta actual y, si está registrada en pageRegistry, muestra
 * el PinButton anclado al bottom-right (sobre el badge de tier).
 *
 * Convive con los PinButtons de página/tablero individual: ambos comparten
 * la misma SWR cache key (`/api/dashboard/pins?tenantId=...`).
 */
export default function GlobalPagePinButton() {
    const pathname = usePathname() || "/";
    const { selectedTenant } = useTenant();

    // No mostrar en login, dashboard root (no tiene sentido pinearse a sí mismo),
    // ni cuando no hay tenant seleccionado.
    if (!selectedTenant || selectedTenant.id === "default") return null;

    const normalized = pathname.replace(/^\/(en|es|pt-BR|pt)/i, "") || "/";
    if (normalized === "/" || normalized === "/login" || normalized.startsWith("/demo")) return null;

    const entry = findPageForPath(pathname);
    if (!entry) return null;

    return (
        <div className="fixed bottom-16 right-6 z-40">
            <PinButton widgetKey={pageWidgetKey(entry)} label={`Pinear "${entry.title}" al dashboard`} />
        </div>
    );
}
