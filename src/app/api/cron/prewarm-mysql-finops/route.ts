import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";
import { redis } from "@/lib/redis";
import { errorMessage } from "@/lib/apiErrors";

export const dynamic = "force-dynamic";

const STATUS_KEY = "cron:prewarm-mysql-finops:status:v1";
const LOCK_KEY = "cron:prewarm-mysql-finops:lock:v1";
const LOCK_TTL_SECONDS = Number(process.env.CRON_PREWARM_MYSQL_LOCK_TTL_SECONDS || 900);

export type PrewarmMysqlStatus = {
  startedAt: number;
  finishedAt: number | null;
  done: boolean;
  ok: boolean | null;
  tenantsTotal?: number;
  tenantsOk?: number;
  tenantsFailed?: number;
  error?: string;
};

async function writeStatus(status: PrewarmMysqlStatus): Promise<void> {
  try {
    if (redis?.status === "ready" || redis?.status === "connect") {
      await redis.set(STATUS_KEY, JSON.stringify(status), "EX", 86400);
    }
  } catch (e) {
    console.warn("[prewarm-mysql-finops] no se pudo escribir el estado:", errorMessage(e));
  }
}

async function readStatus(): Promise<PrewarmMysqlStatus | null> {
  try {
    if (redis?.status === "ready" || redis?.status === "connect") {
      const raw = await redis.get(STATUS_KEY);
      return raw ? JSON.parse(raw) : null;
    }
  } catch (e) {
    console.warn("[prewarm-mysql-finops] no se pudo leer el estado:", errorMessage(e));
  }
  return null;
}

/**
 * Fire-and-forget: NO se espera acá.
 *
 * El barrido pide las métricas de MySQL de cada tenant en serie, y supera los
 * ~240s que tolera el ingress de Container Apps. Devolvía `504 stream timeout`
 * y Azure marcaba la ejecución fallida --14 en 24 h-- aunque el prewarm
 * terminara bien. Mismo techo de plataforma y misma solución que `sync`,
 * `prewarm-dashboard` y `anomaly-detection`.
 */
function launchPrewarm(startedAt: number, cronSecret: string): void {
  runPrewarmSweep(cronSecret)
    .then(async (results) => {
      const okCount = results.filter((r) => r.ok).length;
      await writeStatus({
        startedAt,
        finishedAt: Date.now(),
        done: true,
        ok: okCount === results.length,
        tenantsTotal: results.length,
        tenantsOk: okCount,
        tenantsFailed: results.length - okCount,
      });
    })
    .catch(async (e) => {
      await writeStatus({
        startedAt, finishedAt: Date.now(), done: true, ok: false,
        error: errorMessage(e) || String(e),
      });
    })
    .finally(async () => {
      try {
        if (redis?.status === "ready" || redis?.status === "connect") await redis.del(LOCK_KEY);
      } catch { /* el lock expira solo por TTL */ }
    });
}

export async function GET(request: NextRequest) {
  return runPrewarmMysqlFinops(request);
}

export async function POST(request: NextRequest) {
  return runPrewarmMysqlFinops(request);
}

async function runPrewarmMysqlFinops(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.length < 16) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    // Polling de estado: sin este contrato el runner no puede esperar un
    // barrido largo sin que el ingress lo corte a los 240s.
    if (request.nextUrl.searchParams.get("status") === "1") {
      const status = await readStatus();
      return NextResponse.json(status ?? { done: false, ok: null, status: "idle" });
    }

    // Lock: el job corre cada 20 minutos y el barrido puede pasarse. Sin esto,
    // dos barridos concurrentes duplicarían las consultas de métricas.
    const lockAcquired = await redis
      .set(LOCK_KEY, String(Date.now()), "EX", LOCK_TTL_SECONDS, "NX")
      .catch(() => "OK");
    if (!lockAcquired) {
      return NextResponse.json(
        { status: "already_running", message: "Hay un prewarm de MySQL activo.", current: await readStatus() },
        { status: 200 }
      );
    }

    await writeStatus({ startedAt, finishedAt: null, done: false, ok: null });
    launchPrewarm(startedAt, cronSecret);

    return NextResponse.json(
      {
        message: "MySQL FinOps prewarm started in background",
        statusPollUrl: "/api/cron/prewarm-mysql-finops?status=1",
        startedAt,
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    try {
      if (redis?.status === "ready" || redis?.status === "connect") await redis.del(LOCK_KEY);
    } catch { /* el lock expira solo */ }
    return NextResponse.json(
      { error: "Internal Server Error", details: errorMessage(error) },
      { status: 500 }
    );
  }
}

/** El barrido real. Antes vivía inline en el handler y por eso lo mataba el ingress. */
async function runPrewarmSweep(cronSecret: string) {
  const [tenants] = await pool.query<any[]>(
    'SELECT tenant_id AS id FROM Tenants WHERE status = "active"'
  );

  const origin = getInternalBaseUrl();
  const headers: Record<string, string> = { "X-Cron-Auth": cronSecret };
  const results: Array<{ tenantId: string; ok: boolean; ms: number; error?: string }> = [];

  for (const tenant of tenants) {
    const start = Date.now();
    try {
      const url = `${origin}/api/intelligence/databases/mysql-metrics?tenantId=${encodeURIComponent(tenant.id)}&bust=1`;
      const res = await fetch(url, { headers, cache: "no-store" });
      const ms = Date.now() - start;
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        results.push({ tenantId: tenant.id, ok: false, ms, error: `HTTP ${res.status}: ${detail.slice(0, 200)}` });
        continue;
      }
      results.push({ tenantId: tenant.id, ok: true, ms });
    } catch (error: unknown) {
      results.push({ tenantId: tenant.id, ok: false, ms: Date.now() - start, error: errorMessage(error) });
    }
  }
  return results;
}
