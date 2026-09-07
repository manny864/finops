"use client";

import { useTranslations } from "next-intl";

/**
 * El bucket de costo sin etiquetar.
 *
 * `"Sin asignar"` NO es texto de UI: es el centinela que usa la capa de datos
 * para el costo que no trae la etiqueta `CostCenter`. Sale de un
 * `COALESCE(..., 'Sin asignar')` en las consultas de cost-centers, whiteboard y
 * ai-analytics, y además viaja de vuelta al servidor —`?costCenterName=...`—
 * para pedir los recursos del bucket y alimentar el bulk-tag.
 *
 * Por eso NO se traduce en origen ni se cambia la constante: se traduce al
 * renderizar, y sólo eso. Cambiar el valor rompería el filtrado, el drawer y el
 * etiquetado masivo de una forma que ningún test de i18n vería.
 *
 * Vive acá porque cinco componentes de cuatro namespaces distintos muestran el
 * mismo centinela: CostCenterBudgetsBoard, WhiteboardBudgetWidget,
 * WhiteboardPinnedWidget, CostAllocationEngine y AIAnalyticsDashboard. La clave
 * va en `Common` para no repetir la misma frase en cada namespace.
 */
export const CENTINELA_SIN_ASIGNAR = "Sin asignar";

export const esSinAsignar = (nombre: unknown): boolean =>
    typeof nombre === "string" && nombre.trim() === CENTINELA_SIN_ASIGNAR;

/**
 * Devuelve una función que traduce el centinela y deja pasar cualquier otro
 * nombre tal como vino.
 */
export function useNombreDeBucket(): (nombre: string | null | undefined) => string {
    const t = useTranslations("Common");
    return (nombre) => (esSinAsignar(nombre) ? t("unassigned") : nombre ?? "");
}
