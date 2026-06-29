/**
 * Comprime el payload de datos de la página activa antes de enviarlo al
 * FinOps Copilot. El objetivo es reducir tokens de entrada (input) para que
 * Gemini Flash entregue el primer token cuanto antes y la respuesta sea
 * más certera al recibir un resumen estructurado en lugar de un JSON
 * truncado a la mitad.
 *
 * Estrategia:
 *  - Si es un array de objetos: se calcula conteo, suma de campos numéricos,
 *    distintos por dimensiones típicas (service/category/date) y top-N por
 *    monto.
 *  - Si es un objeto: se conservan claves numéricas/string, se recursionan
 *    arrays internos con la misma estrategia, y se recortan textos largos.
 *  - Resultado final acotado a ~2000 caracteres serializados.
 */

const MAX_TOPN = 10;
const MAX_STRING_LEN = 160;
const MAX_FINAL_LENGTH = 8000;
const NUMERIC_FIELDS_HINT = [
  "cost",
  "amount",
  "total",
  "price",
  "savings",
  "savingsAmount",
  "spend",
  "billed",
  "usage",
  "quantity",
  "value",
];
const DIMENSION_FIELDS_HINT = [
  "service",
  "serviceName",
  "category",
  "subscription",
  "subscriptionId",
  "resource",
  "resourceGroup",
  "resourceType",
  "date",
  "usageDate",
  "month",
  "tag",
  "region",
  "location",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truncateString(s: string, max = MAX_STRING_LEN): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function pickNumericField(sample: Record<string, unknown>): string | null {
  for (const hint of NUMERIC_FIELDS_HINT) {
    for (const key of Object.keys(sample)) {
      if (key.toLowerCase().includes(hint) && typeof sample[key] === "number") {
        return key;
      }
    }
  }
  for (const key of Object.keys(sample)) {
    if (typeof sample[key] === "number") return key;
  }
  return null;
}

function pickDimensionField(sample: Record<string, unknown>): string | null {
  for (const hint of DIMENSION_FIELDS_HINT) {
    for (const key of Object.keys(sample)) {
      if (key.toLowerCase().includes(hint) && typeof sample[key] === "string") {
        return key;
      }
    }
  }
  for (const key of Object.keys(sample)) {
    if (typeof sample[key] === "string") return key;
  }
  return null;
}

function compactArray(arr: unknown[]): unknown {
  if (arr.length === 0) return { count: 0 };

  // Array de primitivos: devolvemos conteo + sample
  if (!isPlainObject(arr[0])) {
    return {
      count: arr.length,
      sample: arr.slice(0, 5).map((v) =>
        typeof v === "string" ? truncateString(v) : v
      ),
    };
  }

  const sample = arr[0] as Record<string, unknown>;
  const numericField = pickNumericField(sample);
  const dimensionField = pickDimensionField(sample);

  const result: Record<string, unknown> = { count: arr.length };

  // Agregado por dimensión (top-N por monto)
  if (numericField && dimensionField) {
    const buckets = new Map<string, { sum: number; count: number }>();
    let total = 0;
    for (const row of arr as Record<string, unknown>[]) {
      const dim = String(row[dimensionField] ?? "unknown");
      const val = Number(row[numericField] ?? 0);
      if (!Number.isFinite(val)) continue;
      total += val;
      const cur = buckets.get(dim) || { sum: 0, count: 0 };
      cur.sum += val;
      cur.count += 1;
      buckets.set(dim, cur);
    }
    result[`total_${numericField}`] = Math.round(total * 100) / 100;
    result[`top_by_${dimensionField}`] = Array.from(buckets.entries())
      .sort((a, b) => b[1].sum - a[1].sum)
      .slice(0, MAX_TOPN)
      .map(([dim, agg]) => ({
        [dimensionField]: truncateString(dim),
        [numericField]: Math.round(agg.sum * 100) / 100,
        count: agg.count,
      }));
  } else if (numericField) {
    let total = 0;
    for (const row of arr as Record<string, unknown>[]) {
      const v = Number(row[numericField] ?? 0);
      if (Number.isFinite(v)) total += v;
    }
    result[`total_${numericField}`] = Math.round(total * 100) / 100;
  }

  // Sample compacto: primer registro completo con strings recortadas
  const sampleKeys = Object.keys(sample).slice(0, 8);
  result.sample = sampleKeys.reduce<Record<string, unknown>>((acc, k) => {
    const v = sample[k];
    acc[k] = typeof v === "string" ? truncateString(v) : v;
    return acc;
  }, {});

  return result;
}

function compactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return compactArray(value);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = compactValue(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

/**
 * Comprime el dataPayload activo y devuelve una versión serializada lista
 * para enviar al modelo, acotada por `MAX_FINAL_LENGTH`.
 */
export function compactPayloadString(payload: unknown): string {
  if (payload == null) return "{}";
  let compacted: unknown;
  try {
    compacted = compactValue(payload);
  } catch (_) {
    compacted = { error: "compaction_failed" };
  }
  let s = "";
  try {
    s = JSON.stringify(compacted);
  } catch (_) {
    s = "{}";
  }
  if (s.length > MAX_FINAL_LENGTH) {
    s = s.slice(0, MAX_FINAL_LENGTH) + '"…"}';
  }
  return s;
}
