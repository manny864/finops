/**
 * Migra los secretos de infraestructura del .env local hacia Azure Key
 * Vault, bajo el prefijo `infra-*` (ver src/lib/secrets/infraSecrets.ts).
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
 * quitar esos valores del .env del VPS — el fallback a env var sigue
 * activo por si Key Vault no responde.
 *
 * NO incluye (a propósito, ver infraSecrets.ts): AZURE_KEYVAULT_* (bootstrap
 * de acceso al propio Key Vault) ni MFA_ENCRYPTION_KEY (deriva la clave que
 * descifra el caché local de Key Vault). Tampoco SMTP_* (no configurado en
 * prod todavía — fuera de alcance de esta migración).
 *
 * NOTA sobre BACKUP_AZURE_SAS_URL: se migra a KV (útil como respaldo/rotación
 * centralizada), pero `scripts/backup-db.sh` es un script bash de cron que
 * corre FUERA del proceso Node — no pasa por `hydrateInfraSecretsFromKeyVault()`
 * y sigue leyendo el valor del `.env` plano directamente. Si rotás este
 * secret en KV, actualizá también el `.env` del VPS para que el backup no
 * quede con una SAS vencida.
 */

/* eslint-disable no-console, @typescript-eslint/no-require-imports */
// A diferencia de la app Next.js (que carga .env automático), `npx tsx` de
// un script suelto NO carga ningún .env por sí solo — sin esto,
// isKeyVaultEnabled() siempre da false aunque el .env del VPS tenga todo
// bien configurado. Mismo patrón que scripts/migrate-tenants-to-keyvault.ts.
// Busca ".env" primero (nombre real del archivo en el VPS, ver
// scripts/prod-migrate-kv.sh) y cae a .env.production/.env.development en
// local si no lo encuentra. dotenv nunca pisa una env var ya seteada, así
// que si el runtime ya inyectó las vars (Docker) esto es un no-op.
import path from "path";
import fs from "fs";
try {
  // require() en lugar de import estático para compat CJS (tsx en prod) y
  // para poder tolerar que dotenv no esté instalado en el runtime standalone.
  const dotenv = require("dotenv") as typeof import("dotenv");
  // Para en el PRIMER archivo que encuentre — nunca cargar más de uno: si
  // .env.production y .env.development coexistieran (ej. corriendo esto en
  // local por error) y se cargaran ambos, dotenv no pisa valores ya
  // seteados, así que el orden decidiría en silencio de dónde sale cada
  // secreto. ".env" primero porque es el nombre real del archivo en el VPS
  // (ver scripts/prod-migrate-kv.sh); en local no existe y cae a
  // .env.development/.env.production según NODE_ENV.
  const nodeEnvFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.development";
  const candidates = [".env", nodeEnvFile];
  let loaded = false;
  for (const f of candidates) {
    const envPath = path.resolve(process.cwd(), f);
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      console.log(`[env] loaded ${f}`);
      loaded = true;
      break;
    }
  }
  if (!loaded) {
    console.warn(`[env] Ningún archivo .env encontrado en ${process.cwd()} — usando solo env vars ya inyectadas.`);
  }
} catch {
  console.log(`[env] dotenv no instalado — usando solo env vars ya inyectadas por el runtime.`);
}

import { isKeyVaultEnabled, setSecret, getSecret } from "../src/lib/secrets/keyvault";

const SECRETS: Array<{ envVar: string; kvName: string }> = [
  { envVar: "DB_PASSWORD", kvName: "infra-db-password" },
  { envVar: "REDIS_PASSWORD", kvName: "infra-redis-password" },
  { envVar: "CRON_SECRET", kvName: "infra-cron-secret" },
  { envVar: "PADDLE_API_KEY", kvName: "infra-paddle-api-key" },
  { envVar: "PADDLE_WEBHOOK_SECRET", kvName: "infra-paddle-webhook-secret" },
  { envVar: "AZURE_CLIENT_SECRET", kvName: "infra-azure-client-secret" },
  { envVar: "AZURE_MARKETPLACE_AAD_APP_SECRET", kvName: "infra-azure-marketplace-aad-app-secret" },
  { envVar: "BACKUP_AZURE_SAS_URL", kvName: "infra-backup-azure-sas-url" },
  { envVar: "GEMINI_API_KEY", kvName: "infra-gemini-api-key" },
  { envVar: "RECAPTCHA_SECRET", kvName: "infra-recaptcha-secret" },
  { envVar: "AZURE_STORAGE_CONNECTION_STRING", kvName: "infra-azure-storage-connection-string" },
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
