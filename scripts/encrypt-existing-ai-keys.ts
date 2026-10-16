/**
 * Cifra en reposo las API keys de IA que quedaron en TEXTO PLANO en la DB
 * antes de la remediación IA-2 (assessment 2026-07-05).
 *
 * Afecta: `Tenants.ai_api_key` y `GlobalSettings` (setting_key='ai_api_key').
 * Usa el mismo formato self-contained que la app (src/lib/secretCrypto.ts):
 *   enc:v2:<iv>:<authTag>:<ciphertext>
 *
 * Idempotente: `isEncrypted()` salta las filas ya cifradas, así que es seguro
 * re-ejecutarlo. La app ya lee ambos formatos (decryptSecret hace fallback a
 * plaintext), por lo que esto no cambia el comportamiento — solo elimina el
 * texto plano en reposo.
 *
 * Correr en el entorno objetivo, con APP_SECRET_ENCRYPTION_KEY dedicada:
 *   npx tsx scripts/encrypt-existing-ai-keys.ts --dry-run   # muestra qué haría
 *   npx tsx scripts/encrypt-existing-ai-keys.ts             # aplica
 *
 * Debe usar la misma clave dedicada que el runtime. Para rotacion completa,
 * usar rotate-app-secrets.ts y docs/security/app-secret-rotation.md.
 */
import 'dotenv/config';
import pool from '../src/modules/storage/db';
import { encryptSecret, isEncrypted, hasEncryptionKey } from '../src/lib/secretCrypto';
import type { RowDataPacket } from 'mysql2';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
    if (!hasEncryptionKey()) {
        console.error('ERROR: APP_SECRET_ENCRYPTION_KEY no configurada. Abortando.');
        process.exit(1);
    }

    console.log(`[encrypt-ai-keys] modo: ${DRY_RUN ? 'DRY-RUN' : 'APLICAR'}`);
    let tenantsEncrypted = 0;
    let tenantsSkipped = 0;

    // --- Tenants ---
    const [tenantRows] = await pool.query<RowDataPacket[]>(
        "SELECT tenant_id, ai_api_key FROM Tenants WHERE ai_api_key IS NOT NULL AND ai_api_key <> ''"
    );
    for (const row of tenantRows) {
        const current = row.ai_api_key as string;
        if (isEncrypted(current)) {
            tenantsSkipped++;
            continue;
        }
        const enc = encryptSecret(current);
        console.log(`  Tenant ${row.tenant_id}: plaintext(${current.length}) -> encrypted(${enc.length})`);
        if (!DRY_RUN) {
            await pool.query('UPDATE Tenants SET ai_api_key = ? WHERE tenant_id = ?', [enc, row.tenant_id]);
        }
        tenantsEncrypted++;
    }

    // --- GlobalSettings ---
    let globalEncrypted = 0;
    let globalSkipped = 0;
    const [gsRows] = await pool.query<RowDataPacket[]>(
        "SELECT setting_value FROM GlobalSettings WHERE setting_key = 'ai_api_key' AND setting_value IS NOT NULL AND setting_value <> ''"
    );
    for (const row of gsRows) {
        const current = row.setting_value as string;
        if (isEncrypted(current)) {
            globalSkipped++;
            continue;
        }
        const enc = encryptSecret(current);
        console.log(`  GlobalSettings ai_api_key: plaintext(${current.length}) -> encrypted(${enc.length})`);
        if (!DRY_RUN) {
            await pool.query("UPDATE GlobalSettings SET setting_value = ? WHERE setting_key = 'ai_api_key'", [enc]);
        }
        globalEncrypted++;
    }

    console.log(`[encrypt-ai-keys] Tenants: ${tenantsEncrypted} cifradas, ${tenantsSkipped} ya cifradas.`);
    console.log(`[encrypt-ai-keys] GlobalSettings: ${globalEncrypted} cifradas, ${globalSkipped} ya cifradas.`);
    if (DRY_RUN) console.log('[encrypt-ai-keys] DRY-RUN: no se aplicó ningún cambio.');
    await pool.end();
}

main().catch((e) => {
    console.error('[encrypt-ai-keys] error fatal:', e);
    process.exit(1);
});
