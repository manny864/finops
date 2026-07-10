import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { verifyApiKey, requireScope } from "@/lib/publicApiAuth";
import rateLimiter from "@/lib/rateLimiter";
import pool from "@/modules/storage/db";

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
      requireScope(authResult, "read:budgets");
    } catch (error: any) {
      return NextResponse.json(
        {
          error: {
            code: "insufficient_scope",
            message: error.message,
            request_id: requestId,
          },
        },
        { status: 403, headers: { "X-Request-Id": requestId } }
      );
    }

    const { allowed, remaining, resetAt } = rateLimiter.check(
      authResult.keyId,
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
        `SELECT id, budget_month, budget_year, budget_usd, alert_threshold
         FROM TenantMonthlyBudgets
         WHERE tenant_id = ?
         ORDER BY budget_year DESC, budget_month DESC
         LIMIT 100`,
        [authResult.tenantId]
      );
      data = await Promise.all((rows as any[]).map(async (b) => {
        const monthStr = String(b.budget_month).padStart(2, "0");
        const [spendRows]: any = await pool.query(
          `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS spend
           FROM CostSnapshots
           WHERE tenant_id = ? AND DATE_FORMAT(COALESCE(ChargePeriodStart, date), '%Y-%m') = ?`,
          [authResult.tenantId, `${b.budget_year}-${monthStr}`]
        );
        const spent = Number(spendRows?.[0]?.spend || 0);
        const limitUsd = Number(b.budget_usd || 0);
        const percentSpent = limitUsd > 0 ? Math.round((spent / limitUsd) * 100) : 0;
        const alertThreshold = Number(b.alert_threshold || 80);
        return {
          id: b.id,
          name: `${b.budget_year}-${monthStr} Budget`,
          limit_usd: limitUsd.toFixed(2),
          spent_usd: spent.toFixed(2),
          percent_spent: percentSpent,
          status: percentSpent >= 100 ? "exceeded" : percentSpent >= alertThreshold ? "warning" : "ok",
          period: "monthly",
        };
      }));
    } catch (e: any) {
      console.warn("[v1/budgets] query falló, devolviendo lista vacía:", e?.message);
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
  } catch (error: any) {
    console.error("Error in GET /api/v1/budgets:", error);
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
