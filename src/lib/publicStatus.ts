/**
 * Estado público de la plataforma (PERIM-02).
 *
 * La ruta `/api/status` y la página `/status` son anónimas: no pueden medir
 * dependencias por petición. Leen el último snapshot que escribe el cron
 * autorizado `status-snapshot` (cada 5 min) y lo sirven desde una caché de
 * proceso con clave fija —ignora query strings—, single-flight y backoff ante
 * fallos. Si no hay un snapshot reciente y válido, el estado es desconocido
 * (`null`), nunca "100% operativo".
 *
 * Límite: la caché es por réplica; reinicios y autoscaling la vacían. Como
 * máximo hay una lectura cada CACHE_TTL_MS por réplica.
 */

import type { RowDataPacket } from "mysql2";
import pool from "@/modules/storage/db";

export type PublicComponentStatus = "operational" | "degraded" | "down";

export interface PublicStatusDto {
  status: PublicComponentStatus;
  timestamp: string;
  components: Array<{ name: string; status: PublicComponentStatus }>;
  uptime_30d_pct: number;
  degraded_30d_pct: number;
  incidents_last_30d: number;
}

export const CACHE_TTL_MS = 30_000;
export const FAILURE_BACKOFF_MS = 30_000;
/** Tres ciclos del cron (*\/5): un snapshot más viejo indica que el job no corre. */
export const MAX_SNAPSHOT_AGE_MS = 15 * 60_000;
const MAX_CLOCK_SKEW_MS = 60_000;

/** Nombres que escribe el cron; cualquier otro se descarta antes de publicarlo. */
const PUBLIC_COMPONENTS = new Set(["API", "Database", "Azure Sync", "AI Provider", "Paddle Billing"]);

type SnapshotRow = RowDataPacket & {
  overall_status: string;
  captured_at: Date | string;
  components_json: unknown;
};
type StatsRow = RowDataPacket & {
  total: number | string;
  down_count: number | string | null;
  degraded_count: number | string | null;
  incidents: number | string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function isStatus(value: unknown): value is PublicComponentStatus {
  return value === "operational" || value === "degraded" || value === "down";
}

function sanitizeComponents(raw: unknown): PublicStatusDto["components"] {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const out: PublicStatusDto["components"] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { name, status } = item as { name?: unknown; status?: unknown };
    if (typeof name === "string" && PUBLIC_COMPONENTS.has(name) && isStatus(status)) {
      out.push({ name, status });
    }
  }
  return out;
}

async function loadSnapshot(): Promise<PublicStatusDto> {
  const [snapshots] = await pool.query<SnapshotRow[]>(
    "SELECT overall_status, captured_at, components_json FROM PlatformStatusSnapshots " +
      "ORDER BY captured_at DESC LIMIT 1"
  );
  const row = snapshots[0];
  if (!row) throw new Error("Status snapshot unavailable");
  const captured = new Date(row.captured_at);
  const age = Date.now() - captured.getTime();
  if (!Number.isFinite(age) || age > MAX_SNAPSHOT_AGE_MS || age < -MAX_CLOCK_SKEW_MS) {
    throw new Error("Status snapshot stale");
  }
  if (!isStatus(row.overall_status)) throw new Error("Invalid status snapshot");

  const [stats] = await pool.query<StatsRow[]>(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(overall_status = 'down'), 0) AS down_count,
       COALESCE(SUM(overall_status = 'degraded'), 0) AS degraded_count,
       (SELECT COUNT(*) FROM PlatformIncidents
        WHERE started_at > DATE_SUB(NOW(), INTERVAL 30 DAY)) AS incidents
     FROM PlatformStatusSnapshots
     WHERE captured_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`
  );
  const stat = stats[0];
  const total = Number(stat?.total);
  const down = Number(stat?.down_count);
  const degraded = Number(stat?.degraded_count);
  const incidents = Number(stat?.incidents);
  if (!stat || !Number.isFinite(total) || total <= 0 ||
      ![down, degraded, incidents].every(Number.isFinite)) {
    throw new Error("Status statistics unavailable");
  }

  return {
    status: row.overall_status,
    timestamp: captured.toISOString(),
    components: sanitizeComponents(row.components_json),
    uptime_30d_pct: round2((100 * (total - down)) / total),
    degraded_30d_pct: round2((100 * degraded) / total),
    incidents_last_30d: incidents,
  };
}

let cached: { expiresAt: number; data: PublicStatusDto } | undefined;
let pending: Promise<PublicStatusDto | null> | undefined;
let retryAfter = 0;

/** Devuelve el último estado público válido, o `null` si es desconocido. */
export async function readPublicStatus(): Promise<PublicStatusDto | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;
  if (pending) return pending;
  if (now < retryAfter) return null;
  pending = loadSnapshot()
    .then((data) => {
      cached = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      return data;
    })
    .catch((error: unknown) => {
      cached = undefined;
      retryAfter = Date.now() + FAILURE_BACKOFF_MS;
      console.error("[public-status] snapshot read failed", {
        reason: error instanceof Error ? error.message : "UnknownError",
      });
      return null;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

export function __resetPublicStatusCacheForTests(): void {
  cached = undefined;
  pending = undefined;
  retryAfter = 0;
}
