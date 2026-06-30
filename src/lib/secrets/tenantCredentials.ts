/**
 * Abstracción para credenciales de Service Principal por tenant.
 *
 * Estrategia (defense-in-depth durante migración):
 *  - READ:  Key Vault primero (si está habilitado) → fallback DB plana.
 *  - WRITE: Key Vault primero (si está habilitado), DB como backup secundario.
 *           Una vez verificada la migración + estabilidad, correr
 *           scripts/cleanup-db-secrets.sql para nullificar la columna.
 *  - DELETE: Borra de KV y NULLifica en DB.
 *
 * Naming en Key Vault:
 *  - tenant-<tenantId-normalizado>-client-id
 *  - tenant-<tenantId-normalizado>-client-secret
 *
 * tenantId-normalizado = lowercase, [^a-z0-9-] → "-", colapsar "--", trim "-".
 * Tenant IDs de Azure son UUIDs, así que la normalización solo aplica lowercase.
 */

import pool from "@/modules/storage/db";
import type { RowDataPacket } from "mysql2";
import {
  deleteSecret,
  getSecret,
  isKeyVaultEnabled,
  setSecret,
} from "./keyvault";

export interface TenantCredentials {
  clientId: string;
  clientSecret: string;
  source: "keyvault" | "database";
}

const cleanInput = (v: unknown): string => {
  if (typeof v !== "string") return "";
  return v.trim().replace(/^["']+|["']+$/g, "");
};

export function normalizeSecretName(
  tenantId: string,
  kind: "client-id" | "client-secret"
): string {
  const norm = tenantId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!norm) throw new Error(`Invalid tenantId for secret name: "${tenantId}"`);
  return `tenant-${norm}-${kind}`;
}

/**
 * Devuelve credenciales del tenant o null si no están configuradas.
 * No lanza excepción si KV está caído: silenciosamente cae a DB.
 */
export async function getTenantCredentials(
  tenantId: string
): Promise<TenantCredentials | null> {
  const cleanTid = cleanInput(tenantId);
  if (!cleanTid) return null;

  if (isKeyVaultEnabled()) {
    try {
      const idName = normalizeSecretName(cleanTid, "client-id");
      const secretName = normalizeSecretName(cleanTid, "client-secret");
      const [kvId, kvSecret] = await Promise.all([
        getSecret(idName),
        getSecret(secretName),
      ]);
      if (kvId && kvSecret) {
        return {
          clientId: cleanInput(kvId),
          clientSecret: cleanInput(kvSecret),
          source: "keyvault",
        };
      }
    } catch (e: any) {
      console.warn(
        `[tenantCredentials] KV read failed for ${cleanTid}, falling back to DB:`,
        e?.message || e
      );
    }
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT client_id, client_secret FROM Tenants WHERE tenant_id = ?",
    [cleanTid]
  );
  if (rows.length === 0) return null;
  const clientId = cleanInput(rows[0].client_id);
  const clientSecret = cleanInput(rows[0].client_secret);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, source: "database" };
}

/**
 * Guarda las credenciales: KV (primario) + DB (backup) si KV está habilitado.
 * Si KV está deshabilitado, escribe solo en DB (modo legacy).
 *
 * Si la escritura a KV falla, NO escribe en DB: lanzamos el error para
 * forzar al caller a decidir qué hacer (re-intentar, alertar, etc.).
 */
export async function setTenantCredentials(
  tenantId: string,
  clientId: string,
  clientSecret: string
): Promise<void> {
  const cleanTid = cleanInput(tenantId);
  const cleanId = cleanInput(clientId);
  const cleanSecret = cleanInput(clientSecret);
  if (!cleanTid || !cleanId || !cleanSecret) {
    throw new Error("tenantId, clientId and clientSecret are required");
  }

  if (isKeyVaultEnabled()) {
    await Promise.all([
      setSecret(normalizeSecretName(cleanTid, "client-id"), cleanId),
      setSecret(normalizeSecretName(cleanTid, "client-secret"), cleanSecret),
    ]);
    // Backup en DB durante fase de migración. Tras estabilización
    // (~30 días), correr migrations/2026XXXX-tenants-secret-cleanup.sql
    // para nullificar y permitir bajar a "Key Vault Secrets User" al SP.
    await pool.query(
      "UPDATE Tenants SET client_id = ?, client_secret = ? WHERE tenant_id = ?",
      [cleanId, cleanSecret, cleanTid]
    );
  } else {
    await pool.query(
      "UPDATE Tenants SET client_id = ?, client_secret = ? WHERE tenant_id = ?",
      [cleanId, cleanSecret, cleanTid]
    );
  }
}

export async function deleteTenantCredentials(tenantId: string): Promise<void> {
  const cleanTid = cleanInput(tenantId);
  if (!cleanTid) return;
  if (isKeyVaultEnabled()) {
    await Promise.allSettled([
      deleteSecret(normalizeSecretName(cleanTid, "client-id")),
      deleteSecret(normalizeSecretName(cleanTid, "client-secret")),
    ]);
  }
  await pool.query(
    "UPDATE Tenants SET client_id = NULL, client_secret = NULL WHERE tenant_id = ?",
    [cleanTid]
  );
}
