import pool from "@/modules/storage/db";
import type { RowDataPacket } from "mysql2";

/**
 * Framework de historial diario genérico ("de todo").
 *
 * Persiste un snapshot por día para cada (tenant, subscription_scope, domain) en la
 * tabla DailySnapshots, con retención >= 1 año. La captura es write-through: cada vez
 * que una página trae datos frescos, se hace upsert del snapshot de HOY. La lectura
 * histórica se sirve por /api/history y se consume con el componente <HistoryButton/>.
 *
 * Regla Cero (precisión): el payload se guarda como JSON exacto; no se hacen cálculos
 * con floats aquí. Los números que ya vengan calculados (DECIMAL/strings) se preservan.
 */

// Ventana de retención: ~13 meses para garantizar "al menos 1 año" con margen.
export const SNAPSHOT_RETENTION_DAYS = 400;

// Tamaño máximo de payload serializado (evita almacenar blobs accidentales).
const MAX_PAYLOAD_BYTES = 1_000_000;

// Dominios conocidos (una página = un dominio). Extensible: cualquier string es válido,
// esta lista sirve de referencia y para el selector de dominios del historial.
export const SNAPSHOT_DOMAINS = [
    "dashboard_summary",
    "commitments",
    "rightsizing",
    "anomalies",
    "budgets",
    "governance",
    "sustainability",
    "zombies",
] as const;

export type SnapshotDomain = (typeof SNAPSHOT_DOMAINS)[number] | (string & {});

export interface SnapshotPoint {
    date: string;      // YYYY-MM-DD
    payload: unknown;  // JSON parseado del snapshot de ese día
}

function toIsoDate(value: unknown): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value ?? "").slice(0, 10);
}

function safeParse(raw: unknown): unknown {
    if (typeof raw !== "string") return raw ?? null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Registra (upsert) el snapshot de HOY para (tenant, scope, domain) y poda lo viejo.
 * Best-effort: nunca lanza; loguea y sigue para no romper el request principal.
 */
export async function recordDailySnapshot(
    tenantId: string,
    domain: string,
    payload: unknown,
    subscriptionScope: string = "All",
): Promise<void> {
    if (!tenantId || !domain) return;
    try {
        const json = JSON.stringify(payload ?? null);
        if (json.length > MAX_PAYLOAD_BYTES) {
            console.warn(`[snapshot] payload de '${domain}' excede ${MAX_PAYLOAD_BYTES} bytes — se omite`);
            return;
        }
        const scope = subscriptionScope || "All";

        await pool.query(
            `INSERT INTO DailySnapshots (tenant_id, subscription_scope, domain, snapshot_date, payload)
             VALUES (?, ?, ?, CURDATE(), ?)
             ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
            [tenantId, scope, domain, json],
        );

        // Retención por tenant+dominio: barato con el índice idx_tenant_domain_date.
        await pool.query(
            `DELETE FROM DailySnapshots
             WHERE tenant_id = ? AND domain = ? AND snapshot_date < (CURDATE() - INTERVAL ? DAY)`,
            [tenantId, domain, SNAPSHOT_RETENTION_DAYS],
        );
    } catch (e) {
        console.warn(`[snapshot] record falló (${domain}):`, (e as Error)?.message);
    }
}

/**
 * Fire-and-forget: registra el snapshot sin que el caller tenga que await-earlo.
 * Ideal para hookear al final de un route handler sin agregar latencia perceptible.
 */
export function recordDailySnapshotAsync(
    tenantId: string,
    domain: string,
    payload: unknown,
    subscriptionScope: string = "All",
): void {
    void recordDailySnapshot(tenantId, domain, payload, subscriptionScope).catch(() => { });
}

/** Devuelve la serie histórica diaria de un dominio en el rango [from, to]. */
export async function getSnapshotHistory(
    tenantId: string,
    domain: string,
    from?: string,
    to?: string,
    subscriptionScope?: string,
): Promise<SnapshotPoint[]> {
    if (!tenantId || !domain) return [];
    const conds = ["tenant_id = ?", "domain = ?"];
    const params: (string | number)[] = [tenantId, domain];
    if (subscriptionScope) {
        conds.push("subscription_scope = ?");
        params.push(subscriptionScope);
    }
    if (from) {
        conds.push("snapshot_date >= ?");
        params.push(from);
    }
    if (to) {
        conds.push("snapshot_date <= ?");
        params.push(to);
    }
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT snapshot_date, payload
           FROM DailySnapshots
          WHERE ${conds.join(" AND ")}
          ORDER BY snapshot_date ASC`,
        params,
    );
    return rows.map((r) => ({ date: toIsoDate(r.snapshot_date), payload: safeParse(r.payload) }));
}

/** Metadatos del rango disponible para un dominio (para el selector de fechas). */
export async function getSnapshotRange(
    tenantId: string,
    domain: string,
): Promise<{ min: string | null; max: string | null; count: number }> {
    if (!tenantId || !domain) return { min: null, max: null, count: 0 };
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT MIN(snapshot_date) AS minD, MAX(snapshot_date) AS maxD, COUNT(*) AS c
           FROM DailySnapshots WHERE tenant_id = ? AND domain = ?`,
        [tenantId, domain],
    );
    const r = rows[0] || {};
    return {
        min: r.minD ? toIsoDate(r.minD) : null,
        max: r.maxD ? toIsoDate(r.maxD) : null,
        count: Number(r.c || 0),
    };
}

/** Lista los dominios con historial disponible para un tenant. */
export async function getSnapshotDomains(tenantId: string): Promise<string[]> {
    if (!tenantId) return [];
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT DISTINCT domain FROM DailySnapshots WHERE tenant_id = ? ORDER BY domain ASC`,
        [tenantId],
    );
    return rows.map((r) => String(r.domain));
}
