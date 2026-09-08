"use client";
import { useTranslations } from "next-intl";
import { IconCircleCheck, IconAlertTriangle, IconAlertCircle, IconShieldExclamation } from "@tabler/icons-react";

/**
 * Badge de estado de un recurso de base de datos.
 *
 * Existia tres veces, copiado byte por byte en los boards de MySQL, PostgreSQL y
 * MongoDB, con los rotulos en castellano incrustados: "Saludable",
 * "Advertencia", "Detenido", "Actualizando". Solo el estado critico pasaba por
 * t(). En la UI en ingles la columna State salia en castellano en las tres.
 *
 * Las tres copias eran identicas en estilo y se diferenciaban unicamente en la
 * lista de estados que consideraban sanos y en el rotulo de la rama de
 * advertencia. Aca va la union: un estado que un motor no produce simplemente no
 * matchea, y no cuesta nada tenerlo.
 *
 * El namespace es propio (`DatabaseStates`) y no el de cada motor, justamente
 * para que no vuelva a haber tres definiciones de lo mismo.
 */
const SALUDABLES = new Set(["healthy", "online", "Ready", "Succeeded"]);

export default function DatabaseStateBadge({
  state,
  isLegacy = false,
}: {
  state: string;
  isLegacy?: boolean;
}) {
  const t = useTranslations("DatabaseStates");

  if (isLegacy) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400">
        <IconAlertCircle size={11} stroke={2} />
        {/* "Legacy" no se traduce: es el mismo termino en los tres idiomas. */}
        Legacy
      </span>
    );
  }

  if (SALUDABLES.has(state)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400">
        <IconCircleCheck size={11} stroke={2} />
        {t("healthy")}
      </span>
    );
  }

  if (state === "warning" || state === "Stopped" || state === "Updating") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400">
        <IconAlertTriangle size={11} stroke={2} />
        {state === "Stopped" ? t("stopped") : state === "Updating" ? t("updating") : t("warning")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400">
      <IconShieldExclamation size={11} stroke={2} />
      {t("critical")}
    </span>
  );
}
