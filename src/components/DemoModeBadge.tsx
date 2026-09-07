"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { IconSparkles } from "@tabler/icons-react";

/**
 * Insignia de "Modo Demostración" para las cabeceras de los paneles.
 *
 * Estaba duplicada literal —el mismo div, las mismas clases, el mismo icono— en
 * 11 paneles, con el texto fijo en español en cada uno. Traducirlo donde estaba
 * habría significado la misma clave repetida en 11 namespaces distintos: 33
 * entradas de catálogo para una sola frase, y 11 lugares donde desincronizarla.
 */
export default function DemoModeBadge() {
    const t = useTranslations("Common");
    return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-400">
            <IconSparkles size={14} />
            <span>{t("demoMode")}</span>
        </div>
    );
}
