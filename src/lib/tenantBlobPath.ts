import crypto from "crypto";

/**
 * AISEC-05: carpeta por tenant para los blobs (`<prefijo>/<uuid>.<ext>`).
 *
 * El prefijo es SHA-256 con etiqueta de dominio, no HMAC: no oculta el tenantId a
 * quien ya lo conoce, pero no depende de una clave que, al rotarse, dejaría
 * ilegibles los blobs ya guardados. El aislamiento real lo da `resolveTenantStoredName`:
 * un nombre con la carpeta de otro tenant no se lee ni se borra.
 */
export function tenantBlobPrefix(tenantId: string): string {
  if (!tenantId) throw new Error("tenantBlobPrefix: tenantId requerido");
  return crypto.createHash("sha256").update(`finops/blob-tenant/v1:${tenantId}`).digest("hex").slice(0, 32);
}

export function tenantStoredName(tenantId: string, leaf: string): string {
  return `${tenantBlobPrefix(tenantId)}/${leaf}`;
}

/**
 * Valida un stored_name contra el tenant. Acepta el formato legado plano
 * (`<uuid>.<ext>`, sólo lo devuelven filas ya filtradas por tenant) o el de la
 * carpeta del propio tenant. Cualquier otra cosa (otra carpeta, `..`, barras) → null.
 */
export function resolveTenantStoredName(tenantId: string, storedName: string, leafRe: RegExp): string | null {
  if (typeof storedName !== "string") return null;
  const slash = storedName.indexOf("/");
  if (slash === -1) return leafRe.test(storedName) ? storedName : null;
  const prefix = storedName.slice(0, slash);
  const leaf = storedName.slice(slash + 1);
  if (prefix !== tenantBlobPrefix(tenantId) || !leafRe.test(leaf)) return null;
  return storedName;
}
