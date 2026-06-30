/**
 * One-shot migration script: DB plain → Azure Key Vault.
 *
 * Lee todas las filas de Tenants con (client_id, client_secret) no-nulos,
 * y para cada una hace setSecret(...) en KV bajo el naming convencional
 * `tenant-{normalizado}-client-id` y `...-client-secret`.
 *
 * Características:
 *  - Idempotente (sobrescribe el secret en KV si ya existe; KV versiona).
 *  - Dry-run: pasar --dry-run para listar qué haría sin escribir.
 *  - Tras éxito de cada tenant, NO borra la columna en DB (eso es manual
 *    via 2026XXXX-tenants-secret-cleanup.sql después de N días estables).
 *
 * Uso:
 *   AZURE_KEYVAULT_ENABLED=true \
 *   AZURE_KEYVAULT_URL=... AZURE_KEYVAULT_TENANT_ID=... AZURE_KEYVAULT_CLIENT_ID=... AZURE_KEYVAULT_CLIENT_SECRET=... \
 *   DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... \
 *   npx tsx scripts/migrate-tenants-to-keyvault.ts [--dry-run]
 */

/* eslint-disable no-console, @typescript-eslint/no-require-imports */
// Carga env ANTES de cualquier import de la app (los `import` estáticos se
// hoistean al inicio del módulo en ESM, así que usamos dynamic imports para
// que la pool de DB se cree con DB_HOST/DB_PORT ya seteados).
// En producción/Docker las env vars ya están inyectadas por el runtime,
// por eso dotenv es opcional (puede no estar instalado en prod).
import path from "path";
import fs from "fs";
const envFile = process.env.NODE_ENV === "production"
  ? ".env.production"
  : ".env.development";
const envPath = path.resolve(process.cwd(), envFile);
try {
  // require() en lugar de top-level await import() para compat CJS (tsx en prod)
  const dotenv = require("dotenv") as typeof import("dotenv");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`[env] loaded ${envFile}`);
  } else {
    dotenv.config();
  }
} catch {
  console.log(`[env] dotenv not installed (production runtime) — relying on injected env vars`);
}

interface TenantRow {
  tenant_id: string;
  company_name: string;
  client_id: string | null;
  client_secret: string | null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Dynamic imports: after env is loaded.
  const { default: pool } = await import("../src/modules/storage/db");
  const { isKeyVaultEnabled, setSecret, getSecret } = await import(
    "../src/lib/secrets/keyvault"
  );
  const { normalizeSecretName } = await import(
    "../src/lib/secrets/tenantCredentials"
  );

  if (!isKeyVaultEnabled()) {
    console.error(
      "❌ Key Vault is not enabled. Set AZURE_KEYVAULT_ENABLED=true and all AZURE_KEYVAULT_* vars."
    );
    process.exit(1);
  }

  console.log(
    `🔐 Migrating tenant credentials to Azure Key Vault (${dryRun ? "DRY RUN" : "LIVE"})…`
  );

  const [rows] = await pool.query<any[]>(
    "SELECT tenant_id, company_name, client_id, client_secret FROM Tenants ORDER BY company_name ASC"
  );
  const tenants = rows as TenantRow[];

  const stats = { total: tenants.length, migrated: 0, skipped: 0, errors: 0 };

  for (const t of tenants) {
    const tid = (t.tenant_id || "").trim();
    const cid = (t.client_id || "").trim();
    const csec = (t.client_secret || "").trim();

    if (!cid || !csec) {
      console.log(`  ⏭  ${tid} (${t.company_name}): sin credenciales en DB, saltando`);
      stats.skipped++;
      continue;
    }

    const idName = normalizeSecretName(tid, "client-id");
    const secretName = normalizeSecretName(tid, "client-secret");

    if (dryRun) {
      console.log(`  📝 ${tid} (${t.company_name}) → ${idName}, ${secretName}`);
      stats.migrated++;
      continue;
    }

    try {
      // Skip si ya existen en KV con el mismo valor (rerun safety).
      const [existingId, existingSecret] = await Promise.all([
        getSecret(idName),
        getSecret(secretName),
      ]);
      if (existingId === cid && existingSecret === csec) {
        console.log(`  ✓ ${tid}: ya en KV con mismo valor, skip`);
        stats.skipped++;
        continue;
      }

      await setSecret(idName, cid);
      await setSecret(secretName, csec);
      console.log(`  ✅ ${tid} (${t.company_name}): migrado`);
      stats.migrated++;
    } catch (e: any) {
      console.error(`  ❌ ${tid}: ${e?.message || e}`);
      stats.errors++;
    }
  }

  console.log("");
  console.log(`Total:     ${stats.total}`);
  console.log(`Migrated:  ${stats.migrated}`);
  console.log(`Skipped:   ${stats.skipped}`);
  console.log(`Errors:    ${stats.errors}`);

  if (stats.errors > 0) {
    console.error("⚠️  Hubo errores. La columna en DB sigue intacta; podés re-correr el script.");
    process.exit(2);
  }

  console.log("");
  console.log("Done. Siguientes pasos:");
  console.log("  1) Verificá en Azure Portal > Key Vault > Secrets que están todos.");
  console.log("  2) Monitoreá en logs que getTenantCredentials() reporta source=keyvault.");
  console.log("  3) Después de 30 días estables, correr migrations/2026XXXX-tenants-secret-cleanup.sql.");

  await pool.end();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
