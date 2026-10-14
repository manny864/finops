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

/** bash/zsh/Cloud Shell: comillas simples; la única secuencia especial es ' -> '\'' */
export const bashQuote = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;
