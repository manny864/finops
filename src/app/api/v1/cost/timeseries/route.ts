import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import pool from "@/modules/storage/db";
import { verifyApiKey, requireScope } from "@/lib/publicApiAuth";
import rateLimiter from "@/lib/rateLimiter";
import { errorMessage } from '@/lib/apiErrors';

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

    const { searchParams } = new URL(request.url);
    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const granularity = searchParams.get("granularity") || "daily";

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

    const dateGroup = granularity === "monthly" ? "%Y-%m" : "%Y-%m-%d";

    const query = `
      SELECT 
        DATE_FORMAT(date, ?) as period,
        SUM(CAST(cost_usd AS DECIMAL(14,4))) as total_cost
      FROM CostSnapshots
      WHERE tenant_id = ? AND date >= ? AND date <= ?
      GROUP BY DATE_FORMAT(date, ?)
      ORDER BY period ASC
    `;

    const [rows] = await pool.query(query, [
      dateGroup,
      authResult.tenantId,
      from.toISOString().split("T")[0],
      to.toISOString().split("T")[0],
      dateGroup,
    ]);

    const series = (rows as any[]).map((row) => ({
      period: row.period,
      cost_usd: parseFloat(row.total_cost || 0).toFixed(2),
    }));

    return NextResponse.json(
      {
        data: {
          granularity,
          period_start: from.toISOString().split("T")[0],
          period_end: to.toISOString().split("T")[0],
          series,
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
  } catch (error) {
    console.error("Error in GET /api/v1/cost/timeseries:", error);
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
