/**
 * Disponibilidad de la plataforma sobre `PlatformStatusSnapshots`.
 *
 * Downtime es SOLO `down`. Los tres consumidores hacían `operational / total`,
 * así que cualquier snapshot `degraded` entraba como caída: el 2026-09-22 la
 * página pública informaba **22,4%** con la plataforma sirviendo tráfico, porque
 * alcanza una env var ausente (`GEMINI_API_KEY`) para degradar el conjunto
 * entero. Medido sobre 2.017 snapshots de 7 días —1.932 operational, 82
 * degraded, 3 down— lo que no estuvo caído es 99,85%.
 *
 * `degraded` se informa aparte en vez de descontarse: es una señal real, pero no
 * es una caída y no puede leerse como tal en una página pública.
 *
 * La expresión vivía duplicada en `api/status`, `api/cron/status-snapshot` y
 * `superAdminOperations.service`; vive acá para que no vuelvan a divergir.
 */

import type { RowDataPacket } from "mysql2";
import pool from "@/modules/storage/db";

export interface Uptime30d {
  /** % de snapshots que NO estuvieron `down`. */
  uptimePct: number;
  /** % de snapshots `degraded`. Subconjunto de `uptimePct`, no se le resta. */
  degradedPct: number;
  snapshots: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export async function getUptime30d(): Promise<Uptime30d> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        COUNT(*) as total_count,
        COUNT(CASE WHEN overall_status='down' THEN 1 END) as down_count,
        COUNT(CASE WHEN overall_status='degraded' THEN 1 END) as degraded_count
       FROM PlatformStatusSnapshots
       WHERE captured_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );

    const total = Number(rows?.[0]?.total_count || 0);
    if (total === 0) {
      return { uptimePct: 100, degradedPct: 0, snapshots: 0 }; // Sin datos todavía
    }

    return {
      uptimePct: round2(((total - Number(rows[0].down_count || 0)) / total) * 100),
      degradedPct: round2((Number(rows[0].degraded_count || 0) / total) * 100),
      snapshots: total,
    };
  } catch (e) {
    console.error("Uptime calculation failed:", e);
    return { uptimePct: 100, degradedPct: 0, snapshots: 0 };
  }
}
