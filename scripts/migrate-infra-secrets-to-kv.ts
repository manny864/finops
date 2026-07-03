/**
 * Migra los secretos de infraestructura (DB_PASSWORD, REDIS_PASSWORD,
 * CRON_SECRET) del .env local hacia Azure Key Vault, bajo el prefijo
 * `infra-*` (ver src/lib/secrets/infraSecrets.ts).
 *
 * Correr ESTO EN EL VPS (donde el .env real tiene los valores actuales),
 * no en local. Requiere que AZURE_KEYVAULT_ENABLED=true y las credenciales
 * de Key Vault estén configuradas en el mismo .env.
 *
 * Uso:
 *   npx tsx scripts/migrate-infra-secrets-to-kv.ts           # aplica los cambios
 *   npx tsx scripts/migrate-infra-secrets-to-kv.ts --dry-run # solo muestra qué haría
 *
 * Una vez migrado y verificado (la app sigue funcionando leyendo desde KV
 * gracias al hook de arranque en src/instrumentation.ts), podés opcionalmente
 * quitar esos 3 valores del .env del VPS — el fallback a env var sigue
 * activo por si Key Vault no responde.
 */
import { isKeyVaultEnabled, setSecret, getSecret } from "../src/lib/secrets/keyvault";

const SECRETS: Array<{ envVar: string; kvName: string }> = [
  { envVar: "DB_PASSWORD", kvName: "infra-db-password" },
  { envVar: "REDIS_PASSWORD", kvName: "infra-redis-password" },
  { envVar: "CRON_SECRET", kvName: "infra-cron-secret" },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!isKeyVaultEnabled()) {
    console.error(
      "[migrate-infra-secrets] Key Vault no está habilitado (AZURE_KEYVAULT_ENABLED != 'true' o faltan credenciales). Abortando."
    );
    process.exit(1);
  }

  console.log(`[migrate-infra-secrets] Modo: ${dryRun ? "DRY RUN (sin escribir)" : "APLICAR CAMBIOS"}`);

  for (const { envVar, kvName } of SECRETS) {
    const value = (process.env[envVar] || "").trim();
    if (!value) {
      console.warn(`[migrate-infra-secrets] SKIP ${envVar}: no está seteado en el .env local.`);
      continue;
    }

    const existing = await getSecret(kvName).catch(() => null);
    if (existing) {
      console.log(`[migrate-infra-secrets] SKIP ${kvName}: ya existe en Key Vault (no se sobreescribe).`);
      continue;
    }

    if (dryRun) {
      console.log(`[migrate-infra-secrets] (dry-run) Crearía secret '${kvName}' desde ${envVar} (longitud=${value.length}).`);
      continue;
    }

    await setSecret(kvName, value);
    console.log(`[migrate-infra-secrets] OK: ${kvName} creado en Key Vault desde ${envVar}.`);
  }

  console.log("[migrate-infra-secrets] Listo.");
}

main().catch((e) => {
  console.error("[migrate-infra-secrets] Error fatal:", e);
  process.exit(1);
});
