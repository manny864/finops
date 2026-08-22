import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { verifyApiKey, requireScope } from "@/lib/publicApiAuth";
import rateLimiter from "@/lib/rateLimiter";
import pool from "@/modules/storage/db";
import { errorMessage } from '@/lib/apiErrors';

// Mismo cálculo Z-score que /api/intelligence/anomalies (no exportado desde
// ahí porque esa ruta no expone las funciones; se replica acá compacto en
// vez de fabricar datos falsos).
function computeStats(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

export async function GET(request: NextRequest) {
  const requestId = uuidv4();
  try {
    const authResult = await verifyApiKey(request);

    if (!authResult) {
      return NextResponse.json(
        {
          error: {
            code: "unauthorized",
            message: "Invalid or missing API key",
            request_id: requestId,
          },
        },
        { status: 401, headers: { "X-Request-Id": requestId } }
      );
    }

    try {
      requireScope(authResult, "read:anomalies");
    } catch (error) {
      return NextResponse.json(
        {
          error: {
            code: "insufficient_scope",
            message: errorMessage(error),
            request_id: requestId,
          },
        },
        { status: 403, headers: { "X-Request-Id": requestId } }
      );
    }

    const { allowed, remaining, resetAt } = await rateLimiter.checkByKeyDistributed(
      `apikey:${authResult.keyId}`,
      authResult.rateLimitPerMin
    );

    if (!allowed) {
      return NextResponse.json(
        {
          error: {
            code: "rate_limit_exceeded",
            message: "Rate limit exceeded",
            request_id: requestId,
          },
        },
        {
          status: 429,
          headers: {
            "X-Request-Id": requestId,
            "X-RateLimit-Limit": String(authResult.rateLimitPerMin),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": resetAt.toISOString(),
          },
        }
      );
    }

    let data: any[] = [];
    try {
      const [rows]: any = await pool.query(
        `SELECT DATE(COALESCE(ChargePeriodStart, date)) AS d,
                SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total,
                MAX(service_name) AS service
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
         GROUP BY d ORDER BY d ASC`,
        [authResult.tenantId]
      );
      const series = (rows as any[]).map((r) => ({
        date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
        amount: Number(r.total) || 0,
        service: r.service || "unknown",
      }));
      const baseline = series.slice(0, Math.max(0, series.length - 14)).map((s) => s.amount);
      const { mean, stdDev } = computeStats(baseline);
      if (stdDev > 0) {
        data = series.slice(-14)
          .filter((s) => (s.amount - mean) / stdDev > 2.5)
          .map((s) => {
            const z = (s.amount - mean) / stdDev;
            return {
              id: `anom-${s.date}`,
              detected_at: new Date(s.date).toISOString(),
              severity: z > 5 ? "high" : z > 3.5 ? "medium" : "low",
              description: `Gasto de $${s.amount.toFixed(2)} vs promedio esperado de $${mean.toFixed(2)} (z-score ${z.toFixed(2)})`,
              affected_service: s.service,
            };
          });
      }
    } catch (e) {
      console.warn("[v1/anomalies] query falló, devolviendo lista vacía:", errorMessage(e));
    }

    return NextResponse.json(
      {
        data,
        meta: {
          request_id: requestId,
          rate_limit: {
            limit: authResult.rateLimitPerMin,
            remaining,
            reset: resetAt.toISOString(),
          },
        },
      },
      {
        status: 200,
        headers: {
          "X-Request-Id": requestId,
          "X-RateLimit-Limit": String(authResult.rateLimitPerMin),
          "X-RateLimit-Remaining": String(remaining),
          "X-RateLimit-Reset": resetAt.toISOString(),
        },
      }
    );
  } catch (error) {
    console.error("Error in GET /api/v1/anomalies:", error);
    return NextResponse.json(
      {
        error: {
          code: "internal_error",
          message: "Internal server error",
          request_id: requestId,
        },
      },
      { status: 500, headers: { "X-Request-Id": requestId } }
    );
  }
}
