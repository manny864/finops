import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { redis } from "@/lib/redis";
import { AuthError, requireLoadTestServicePrincipal } from "@/lib/requestAuth";

export const runtime = "nodejs";

/**
 * Endpoint dedicado a pruebas de carga EXTERNAS (JMeter/k6) — ver
 * docs/loadtest.md. A diferencia de /api/health (público, sin DB/Redis, solo
 * confirma que el proceso Next.js responde) y /api/status (público, pensado
 * para la página de estado), este endpoint:
 *  1) exige un token de Service Principal válido (client credentials, sin
 *     usuario/MFA — ver requireLoadTestServicePrincipal), y
 *  2) toca los 3 contenedores reales del stack (app + MySQL + Redis) para
 *     que la latencia medida represente la infraestructura real bajo carga,
 *     no solo el proceso Node.js.
 */
export async function GET(request: NextRequest) {
    try {
        await requireLoadTestServicePrincipal(request);

        const dbStart = Date.now();
        await pool.query("SELECT 1");
        const dbMs = Date.now() - dbStart;

        const redisStart = Date.now();
        await redis.ping();
        const redisMs = Date.now() - redisStart;

        return NextResponse.json({ status: "ok", dbMs, redisMs }, { status: 200 });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[loadtest/probe] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
