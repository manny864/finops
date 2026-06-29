#!/usr/bin/env tsx
/**
 * Script CLI para correr migraciones desde local o CI.
 * Uso: npx tsx scripts/migrate.ts
 *
 * Lee las variables de entorno DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT
 * (las mismas que usa la app vía src/modules/storage/db.ts).
 */
import { runMigrations } from '../src/modules/storage/migrations';

async function main() {
    console.log('[migrate] iniciando runner...');
    const results = await runMigrations();
    const applied = results.filter(r => r.status === 'applied').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'failed').length;
    console.log(`[migrate] terminado: ${applied} aplicadas, ${skipped} ya aplicadas, ${failed} fallidas`);
    if (failed > 0) {
        for (const r of results.filter(x => x.status === 'failed')) {
            console.error(`  ❌ ${r.file}: ${r.error}`);
        }
        process.exit(1);
    }
    process.exit(0);
}

main().catch(err => {
    console.error('[migrate] error fatal:', err);
    process.exit(1);
});
