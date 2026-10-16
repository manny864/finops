/**
 * Controlled v1/plaintext -> v2 migration. Run in the target environment with
 * the same key references as the app; never print plaintext or key material.
 * Default is dry-run. See docs/security/app-secret-rotation.md before --apply.
 */
import 'dotenv/config';
import type { RowDataPacket } from 'mysql2';
import pool from '../src/modules/storage/db';
import { hasEncryptionKey, reencryptSecret } from '../src/lib/secretCrypto';

async function main() {
    const apply = process.argv.includes('--apply');
    const allowed = new Set(['--apply', '--dry-run', '--backup-confirmed']);
    if (process.argv.slice(2).some(arg => !allowed.has(arg))
        || (apply && process.argv.includes('--dry-run'))) throw new Error('Invalid migration arguments.');
    if (apply && !process.argv.includes('--backup-confirmed')) {
        throw new Error('Apply requires --backup-confirmed after a protected backup and restore verification.');
    }
    if (!hasEncryptionKey()) throw new Error('APP_SECRET_ENCRYPTION_KEY must be configured.');
    const connection = await pool.getConnection();
    let count = 0;
    try {
        await connection.beginTransaction();
        const lock = apply ? ' FOR UPDATE' : '';
        const [tenants] = await connection.query<RowDataPacket[]>(
            `SELECT tenant_id, ai_api_key, itsm_api_key_encrypted FROM Tenants${lock}`,
        );
        for (const row of tenants) {
            for (const column of ['ai_api_key', 'itsm_api_key_encrypted'] as const) {
                const current: unknown = row[column];
                if (current == null || current === '') continue;
                if (typeof current !== 'string') throw new Error('Unexpected stored secret type.');
                const rotated = reencryptSecret(current);
                if (apply) await connection.execute(
                    `UPDATE Tenants SET ${column} = ? WHERE tenant_id = ?`, [rotated, row.tenant_id],
                );
                count++;
            }
        }
        const [settings] = await connection.query<RowDataPacket[]>(
            `SELECT setting_key, setting_value FROM GlobalSettings
             WHERE setting_key IN ('ai_api_key', 'enterprise_ai_api_key')${lock}`,
        );
        for (const row of settings) {
            const current: unknown = row.setting_value;
            if (current == null || current === '') continue;
            if (typeof current !== 'string') throw new Error('Unexpected stored secret type.');
            const rotated = reencryptSecret(current);
            if (apply) await connection.execute(
                'UPDATE GlobalSettings SET setting_value = ? WHERE setting_key = ?', [rotated, row.setting_key],
            );
            count++;
        }
        if (apply) await connection.commit();
        else await connection.rollback();
        console.log(`[rotate-app-secrets] ${apply ? 'Applied' : 'Dry-run verified'}: ${count} values.`);
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

main().catch(() => {
    // Driver errors can contain SQL parameters. Do not print the underlying error.
    console.error('[rotate-app-secrets] Failed; transaction rolled back. Check schema and key configuration in the target environment.');
    process.exitCode = 1;
}).finally(() => pool.end());
