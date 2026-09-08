"use client";
import { useTranslations } from "next-intl";

/**
 * Badges de riesgo y confianza de una recomendacion.
 *
 * Estaba escrito tres veces, identico, en los boards de MySQL, PostgreSQL y
 * MongoDB --el mapa de colores incluido, mismo md5-- con los rotulos y los
 * valores en castellano dentro de ternarios:
 *
 *   Riesgo: {rec.risk === "low" ? "Bajo" : rec.risk === "medium" ? "Medio" : "Alto"}
 *
 * `risk` y `confidence` YA son discriminadores (`low` | `medium` | `high`), asi
 * que no hacia falta nada del servidor: alcanzaba con resolverlos con t().
 *
 * No lo usa `VmssFinopsCmpBoard`, que tiene el mismo texto pero otro estilo
 * (pills `rounded-full` sin color por riesgo) y pinta el valor crudo. Unificar
 * eso le cambiaria el aspecto, asi que queda aparte.
 */
const COLOR_RIESGO: Record<string, string> = {
  low: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400",
  medium: "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400",
  high: "text-red-700 bg-red-50 border-red-200 dark:bg-red-950/30 dark:text-red-400",
};

const CLAVE_RIESGO: Record<string, string> = { low: "riskLow", medium: "riskMedium", high: "riskHigh" };
const CLAVE_CONFIANZA: Record<string, string> = { high: "confidenceHigh", medium: "confidenceMedium", low: "confidenceLow" };

export default function RiskConfidenceBadges({
  risk,
  confidence,
}: {
  risk: string;
  confidence: string;
}) {
  const t = useTranslations("RiskConfidence");

  return (
    <>
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${COLOR_RIESGO[risk] || ""}`}>
        {t("riskLabel")}: {t(CLAVE_RIESGO[risk] || "riskHigh")}
      </span>
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
        {t("confidenceLabel")}: {t(CLAVE_CONFIANZA[confidence] || "confidenceLow")}
      </span>
    </>
  );
}
