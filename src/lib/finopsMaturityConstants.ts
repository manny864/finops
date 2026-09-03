import type {
  MaturityAssessmentQuestion,
  MaturityStage,
} from "@/types/finopsMaturity.types";

export function calculateMaturityStage(score: number): MaturityStage {
  if (score < 40) return "CRAWL";
  if (score <= 75) return "WALK";
  return "RUN";
}

/**
 * La autoevaluación FinOps: seis dominios, tres niveles cada uno.
 *
 * Acá vive sólo la ESTRUCTURA -- id, dominio, puntaje y nivel. El enunciado de
 * cada pregunta y la descripción de cada opción están en `messages/*.json` bajo
 * `OverviewMaturity.q.<id>`, porque este arreglo lo consume el servicio para
 * armar el payload y el servidor no sabe en qué idioma está el usuario.
 *
 * Los puntajes NO son parejos entre dominios a propósito: reflejan cuánto
 * pesa cada nivel en la práctica. Automatización en Crawl vale 20 y Gobernanza
 * en Crawl vale 30, porque no tener ninguna automatización es peor punto de
 * partida que tener etiquetado inconsistente.
 *
 * El `domainKey` coincide 1:1 con la `key` de las dimensiones del radar; de eso
 * depende que una respuesta del cuestionario mueva su dominio.
 */
export const MATURITY_QUESTIONS: MaturityAssessmentQuestion[] = [
  {
    id: "q_vis",
    domainKey: "visibility",
    options: [
      { score: 25, level: "CRAWL" },
      { score: 65, level: "WALK" },
      { score: 95, level: "RUN" },
    ],
  },
  {
    id: "q_rate",
    domainKey: "rateOpt",
    options: [
      { score: 30, level: "CRAWL" },
      { score: 70, level: "WALK" },
      { score: 95, level: "RUN" },
    ],
  },
  {
    id: "q_usage",
    domainKey: "usageOpt",
    options: [
      { score: 25, level: "CRAWL" },
      { score: 65, level: "WALK" },
      { score: 90, level: "RUN" },
    ],
  },
  {
    id: "q_gov",
    domainKey: "governance",
    options: [
      { score: 30, level: "CRAWL" },
      { score: 70, level: "WALK" },
      { score: 95, level: "RUN" },
    ],
  },
  {
    id: "q_auto",
    domainKey: "automation",
    options: [
      { score: 20, level: "CRAWL" },
      { score: 60, level: "WALK" },
      { score: 90, level: "RUN" },
    ],
  },
  {
    id: "q_culture",
    domainKey: "culture",
    options: [
      { score: 30, level: "CRAWL" },
      { score: 70, level: "WALK" },
      { score: 95, level: "RUN" },
    ],
  },
];
