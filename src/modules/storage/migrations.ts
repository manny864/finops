import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import pool from './db';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

// Errores MySQL que NO deben abortar una migración idempotente.
// (ya existe la columna / índice / tabla / etc.)
const IDEMPOTENT_ERRORS = new Set([
    'ER_DUP_FIELDNAME',     // ALTER ADD COLUMN existente
    'ER_DUP_KEYNAME',       // CREATE INDEX existente
    'ER_TABLE_EXISTS_ERROR', // CREATE TABLE existente (sin IF NOT EXISTS)
    'ER_DUP_ENTRY',         // INSERT duplicado en seed
    'ER_CANT_DROP_FIELD_OR_KEY', // DROP INDEX inexistente
]);

export interface MigrationResult {
    file: string;
    status: 'applied' | 'skipped' | 'failed';
    durationMs?: number;
    error?: string;
}

async function ensureMigrationsTable(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS SchemaMigrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            file_name VARCHAR(255) NOT NULL UNIQUE,
            checksum CHAR(64) NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            duration_ms INT,
            INDEX idx_applied_at (applied_at)
        )
    `);
}

async function getAppliedMigrations(): Promise<Map<string, string>> {
    const [rows]: any = await pool.query(
        'SELECT file_name, checksum FROM SchemaMigrations'
    );
    const map = new Map<string, string>();
    for (const r of rows || []) map.set(r.file_name, r.checksum);
    return map;
}

function sha256(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

// Divide un .sql en statements respetando ; al final de línea (lo suficiente para
// nuestras migraciones simples; no parsea strings con ; embebidos).
// Remueve líneas de comentario `--` antes de splittear para no descartar
// statements legítimos cuyo header sea un comentario.
function splitStatements(sql: string): string[] {
    const cleaned = sql
        .split(/\r?\n/)
        .filter(line => !line.trim().startsWith('--'))
        .join('\n');
    return cleaned
        .split(/;\s*(?:\n|$)/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

async function applyMigrationFile(filePath: string, fileName: string): Promise<MigrationResult> {
    const started = Date.now();
    const content = await fs.readFile(filePath, 'utf8');
    const checksum = sha256(content);
    const statements = splitStatements(content);

    for (const stmt of statements) {
        try {
            await pool.query(stmt);
        } catch (err: any) {
            if (IDEMPOTENT_ERRORS.has(err?.code)) {
                console.log(`[migrations] ${fileName}: stmt ignorado (idempotente: ${err.code})`);
                continue;
            }
            return {
                file: fileName,
                status: 'failed',
                durationMs: Date.now() - started,
                error: `${err.code || 'ERR'}: ${err.message} | stmt: ${stmt.slice(0, 120)}...`,
            };
        }
    }

    const durationMs = Date.now() - started;
    await pool.query(
        'INSERT INTO SchemaMigrations (file_name, checksum, duration_ms) VALUES (?, ?, ?)',
        [fileName, checksum, durationMs]
    );
    return { file: fileName, status: 'applied', durationMs };
}

export async function runMigrations(): Promise<MigrationResult[]> {
    await ensureMigrationsTable();
    const applied = await getAppliedMigrations();

    let files: string[];
    try {
        files = (await fs.readdir(MIGRATIONS_DIR))
            .filter(f => f.endsWith('.sql'))
            .sort();
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            console.log('[migrations] directorio /migrations no existe — skip');
            return [];
        }
        throw e;
    }

    const results: MigrationResult[] = [];
    for (const file of files) {
        if (applied.has(file)) {
            // Verifica checksum: si cambió un .sql ya aplicado, advertir (no abortar).
            const fileContent = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
            const fileHash = sha256(fileContent);
            if (fileHash !== applied.get(file)) {
                console.warn(`[migrations] ⚠️  ${file} fue modificada desde su aplicación. ` +
                    `Hash en DB: ${applied.get(file)?.slice(0, 8)} | Hash en disco: ${fileHash.slice(0, 8)}. ` +
                    `Creá una migración nueva en lugar de editar la existente.`);
            }
            results.push({ file, status: 'skipped' });
            continue;
        }
        console.log(`[migrations] aplicando ${file}...`);
        const result = await applyMigrationFile(path.join(MIGRATIONS_DIR, file), file);
        results.push(result);
        if (result.status === 'failed') {
            console.error(`[migrations] ❌ ${file} falló: ${result.error}`);
            break;
        }
        console.log(`[migrations] ✅ ${file} (${result.durationMs}ms)`);
    }

    const applied2 = results.filter(r => r.status === 'applied').length;
    const skipped2 = results.filter(r => r.status === 'skipped').length;
    const failed2 = results.filter(r => r.status === 'failed').length;
    console.log(`[migrations] resumen: ${applied2} aplicadas, ${skipped2} ya aplicadas, ${failed2} fallidas`);
    return results;
}

export async function getMigrationsStatus() {
    await ensureMigrationsTable();
    const [rows]: any = await pool.query(
        'SELECT file_name, checksum, applied_at, duration_ms FROM SchemaMigrations ORDER BY applied_at DESC'
    );
    let files: string[] = [];
    try {
        files = (await fs.readdir(MIGRATIONS_DIR))
            .filter(f => f.endsWith('.sql'))
            .sort();
    } catch { /* no dir */ }
    const appliedNames = new Set((rows || []).map((r: any) => r.file_name));
    const pending = files.filter(f => !appliedNames.has(f));
    return {
        applied: rows || [],
        pending,
        totalApplied: (rows || []).length,
        totalPending: pending.length,
    };
}
