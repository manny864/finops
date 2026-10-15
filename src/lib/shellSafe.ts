// AISEC-01: los scripts az/PowerShell se arman con nombres que elige el cliente
// y terminan pegados en la terminal del operador. Defensa: allowlist estricta
// (fail-closed) + quoting simple para texto libre. Un valor que pasa SAFE_VALUE
// no contiene comillas, $, `, \, ;, |, &, <, >, saltos ni bidi, así que es
// inerte entre comillas dobles tanto en bash como en PowerShell.

const SAFE_VALUE = /^(?!-)[\p{L}\p{N} ._()\-:@+/]{0,500}$/u;

export const UNSAFE_SCRIPT = {
  cli: "# Nombre de recurso no apto para generar script; use el portal.",
  powershell: "# Nombre de recurso no apto para generar script; use el portal.",
};

const isSafe = (v: string): boolean => SAFE_VALUE.test(v.normalize("NFKC"));

/** Campos de la acción que se interpolan en los scripts (ver aiRemediations.ts). */
const INTERPOLATED = new Set([
  "resourceId", "resourceName", "vaultName", "vaultId", "targetId", "subscriptionId",
  "planKey", "policyName", "policyId", "ruleId", "ruleName", "affectedPrincipals",
]);

/** true si todo valor interpolable de la acción es seguro. */
export function isSafeAction(action: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(action)) {
    if (value == null) continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
    } else if (!INTERPOLATED.has(key) && !(key.startsWith("recommended") && key !== "recommendedQuery")) {
      continue;
    } else if (typeof value === "string") {
      if (!isSafe(value)) return false;
    } else if (Array.isArray(value)) {
      if (!value.every((v) => typeof v === "string" && isSafe(v))) return false;
    }
  }
  return true;
}

// commandPayload pregenerado en ~30 servicios: los nombres van entre comillas dobles o en
// líneas de comentario. Se rechaza lo que rompe esos contextos en bash y PowerShell:
// ", $, `, \, ! (history), controles/saltos, comillas tipográficas (PS las trata como ")
// y bidi. Blocklist y no allowlist porque acá entran display names legítimos ("R&D, Ops").
const QUOTE_BREAKER = /["$`\\!\u0000-\u001f\u007f\u0085\u2028\u2029\u2018-\u201f\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/;
const REF_KEY = /^(id|ids|name|names|rg|location|key|params)$|(Id|Ids|Name|Names|Rg|ResourceGroup|resourceGroup|Principals)$/;

const refValueUnsafe = (v: string): boolean => {
  const n = v.normalize("NFKC");
  return QUOTE_BREAKER.test(n) || (n.startsWith("-") && !/^-\d+(\.\d+)?$/.test(n));
};

function refsUnsafe(value: unknown, isRef: boolean): boolean {
  if (typeof value === "string") return isRef && refValueUnsafe(value);
  if (Array.isArray(value)) return value.some((v) => refsUnsafe(v, isRef));
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([k, v]) => k !== "commandPayload" && refsUnsafe(v, isRef || REF_KEY.test(k)),
    );
  }
  return false;
}

function neutralize(payload: unknown): unknown {
  if (typeof payload === "string") return UNSAFE_SCRIPT.cli;
  if (Array.isArray(payload)) return payload.map(neutralize);
  if (payload && typeof payload === "object") {
    return Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, neutralize(v)]));
  }
  return payload;
}

/**
 * Recorre una respuesta y, en cada objeto con commandPayload cuyos nombres/ids/RG/params
 * no sean seguros, reemplaza los scripts por UNSAFE_SCRIPT (fail-closed, misma forma).
 */
export function guardScripts<T>(data: T): T {
  if (Array.isArray(data)) return data.map(guardScripts) as T;
  if (!data || typeof data !== "object") return data;
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = k === "commandPayload" ? v : guardScripts(v);
  if (out.commandPayload != null && refsUnsafe(out, false)) {
    out.commandPayload = neutralize(out.commandPayload);
  }
  return out as T;
}

/** bash/zsh/Cloud Shell: comillas simples; la única secuencia especial es ' -> '\'' */
export const bashQuote = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;
