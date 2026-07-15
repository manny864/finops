import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import pool from "@/modules/storage/db";
import { verifyApiKey, requireScope } from "@/lib/publicApiAuth";
import rateLimiter from "@/lib/rateLimiter";

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
      requireScope(authResult, "read:cost");
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

    const { searchParams } = new URL(request.url);
    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const groupBy = searchParams.get("groupBy") || "service";

    // Validate dates
    if (!fromStr || !toStr) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "Missing required parameters: from, to (ISO 8601 dates)",
            request_id: requestId,
          },
        },
        { status: 400, headers: { "X-Request-Id": requestId } }
      );
    }

    const from = new Date(fromStr);
    const to = new Date(toStr);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "Invalid date format. Use ISO 8601 (YYYY-MM-DD)",
            request_id: requestId,
          },
        },
        { status: 400, headers: { "X-Request-Id": requestId } }
      );
    }

    if (from > to) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "from date must be before to date",
            request_id: requestId,
          },
        },
        { status: 400, headers: { "X-Request-Id": requestId } }
      );
    }

    const groupByCol =
      groupBy === "resourceGroup"
        ? "resource_group"
        : groupBy === "region"
          ? "service_name"
          : "service_name";

    const query = `
      SELECT 
        ${groupByCol} as group_key,
        SUM(CAST(cost_usd AS DECIMAL(14,4))) as total_cost
      FROM CostSnapshots
      WHERE tenant_id = ? AND date >= ? AND date <= ?
      GROUP BY group_key
      ORDER BY total_cost DESC
    `;

    const [rows] = await pool.query(query, [
      authResult.tenantId,
      from.toISOString().split("T")[0],
      to.toISOString().split("T")[0],
    ]);

    const breakdown = [] as any[];
    let totalCost = 0;

    for (const row of rows as any[]) {
      const cost = parseFloat(row.total_cost || 0);
      totalCost += cost;
      breakdown.push({
        key: row.group_key || "Unknown",
        cost_usd: cost.toFixed(2),
      });
    }

    const dayCount = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaily = (totalCost / dayCount).toFixed(2);

    return NextResponse.json(
      {
        data: {
          total_cost_usd: totalCost.toFixed(2),
          average_daily_usd: avgDaily,
          period_start: from.toISOString().split("T")[0],
          period_end: to.toISOString().split("T")[0],
          group_by: groupBy,
          breakdown,
        },
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
    console.error("Error in GET /api/v1/cost/summary:", error);
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
