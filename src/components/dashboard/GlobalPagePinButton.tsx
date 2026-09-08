"use client";
import React from "react";
import { usePathname } from "next/navigation";
import PinButton from "./PinButton";
import { useTranslations } from "next-intl";
import { findPageForPath, pageTitleKey, pageWidgetKeyForPath } from "@/lib/pageRegistry";
import { useTenant } from "@/components/TenantProvider";

/**
 * Botón flotante "Pinear esta página" — montado una sola vez en el shell.
 * Detecta la ruta actual y, si está registrada en pageRegistry, muestra
 * el PinButton alineado arriba a la derecha del contenido principal.
 *
 * Convive con los PinButtons de página/tablero individual: ambos comparten
 * la misma SWR cache key (`/api/dashboard/pins?tenantId=...`).
 */
export default function GlobalPagePinButton() {
    const t = useTranslations("MyDashboard");
    const pathname = usePathname() || "/";
    const { selectedTenant } = useTenant();

    // No mostrar en login, dashboard root (no tiene sentido pinearse a sí mismo),
    // ni cuando no hay tenant seleccionado.
    if (!selectedTenant || selectedTenant.id === "default") return null;

    const normalized = pathname.replace(/^\/(en|es|pt-BR|pt)/i, "") || "/";
    if (normalized === "/" || normalized === "/login" || normalized.startsWith("/demo")) return null;

    const entry = findPageForPath(pathname);
    const widgetKey = pageWidgetKeyForPath(pathname);
    const labelTitle = entry ? t(pageTitleKey(entry.id)) : normalized.replace("/intelligence/", "").replace("/governance/", "").replace("/cleanup/", "").replace("/overview/", "").replace("/admin/", "").replaceAll("-", " ");

    return <PinButton widgetKey={widgetKey} label={t("pinPageLabel", { page: labelTitle })} />;
}
