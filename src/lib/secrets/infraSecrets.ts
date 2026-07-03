/**
 * Secretos de infraestructura (no de tenant) en Azure Key Vault.
 *
 * Fase 0.1 (docs/vps-infra-improvement-plan.md): antes `DB_PASSWORD`,
 * `REDIS_PASSWORD` y `CRON_SECRET` vivían únicamente en el `.env` plano del
 * VPS. Se migran a Key Vault (mismo vault que ya usa `tenantCredentials.ts`),
 * bajo el prefijo `infra-*` para no colisionar con los secrets `tenant-*`.
 *
 * Estrategia (no rompe nada si Key Vault no tiene el secret todavía):
 *  - Si Key Vault está deshabilitado o el secret no existe → usa el valor
 *    de `process.env` como fallback (comportamiento actual, sin cambios).
 *  - Si Key Vault tiene el secret → lo usa y no hace falta tenerlo en el
 *    `.env` del VPS (podés borrarlo de ahí una vez migrado y verificado).
 *
 * Para poblar los secrets en Key Vault desde el VPS (donde SÍ están los
 * valores reales), correr `scripts/migrate-infra-secrets-to-kv.ts`.
 */

import { getSecret, isKeyVaultEnabled } from "./keyvault";

export type InfraSecretName = "db-password" | "redis-password" | "cron-secret";

const ENV_VAR_BY_SECRET: Record<InfraSecretName, string> = {
  "db-password": "DB_PASSWORD",
  "redis-password": "REDIS_PASSWORD",
  "cron-secret": "CRON_SECRET",
};

const KV_SECRET_NAME: Record<InfraSecretName, string> = {
  "db-password": "infra-db-password",
  "redis-password": "infra-redis-password",
  "cron-secret": "infra-cron-secret",
};

/**
 * Resuelve un secreto de infraestructura: Key Vault primero (si está
 * habilitado), `process.env` como fallback. Nunca lanza excepción: si Key
 * Vault falla o no tiene el secret, cae silenciosamente al env var.
 */
export async function getInfraSecret(name: InfraSecretName): Promise<string> {
  const envFallback = process.env[ENV_VAR_BY_SECRET[name]] || "";

  if (isKeyVaultEnabled()) {
    try {
      const kvValue = await getSecret(KV_SECRET_NAME[name]);
      if (kvValue) return kvValue;
    } catch (e: any) {
      console.warn(
        `[infraSecrets] KV read failed para ${name}, usando fallback de env var:`,
        e?.message || e
      );
    }
  }

  return envFallback;
}

/**
 * Hidrata `process.env` con los secretos de infra resueltos desde Key Vault,
 * si están disponibles. Pensado para llamarse UNA vez al boot del servidor
 * (ver src/instrumentation.ts), antes de que cualquier módulo cree el pool
 * de MySQL o el cliente de Redis (ambos son singletons que leen
 * `process.env` en su primer uso).
 *
 * Es un no-op seguro si Key Vault está deshabilitado o si los secrets no
 * existen todavía ahí: en ese caso `process.env` queda tal cual estaba
 * (el `.env` del VPS sigue siendo la fuente de verdad).
 */
export async function hydrateInfraSecretsFromKeyVault(): Promise<void> {
  if (!isKeyVaultEnabled()) return;

  const names: InfraSecretName[] = ["db-password", "redis-password", "cron-secret"];
  await Promise.all(
    names.map(async (name) => {
      try {
        const kvValue = await getSecret(KV_SECRET_NAME[name]);
        if (kvValue) {
          process.env[ENV_VAR_BY_SECRET[name]] = kvValue;
          console.log(`[infraSecrets] ${ENV_VAR_BY_SECRET[name]} resuelto desde Key Vault.`);
        }
      } catch (e: any) {
        console.warn(
          `[infraSecrets] No se pudo resolver ${name} desde Key Vault, se usa el .env local:`,
          e?.message || e
        );
      }
    })
  );
}
