import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { verifyApiKey, requireScope } from "@/lib/publicApiAuth";
import rateLimiter from "@/lib/rateLimiter";
import { collectAdvisorData } from "@/modules/collectors/azure/advisorCollector";
import { parseAzureNumber } from "@/lib/advisorModel";
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
      requireScope(authResult, "read:recommendations");
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
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 1000);
    const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

    let data: any[] = [];
    try {
      const advisorData = await collectAdvisorData(authResult.tenantId, "en");
      const grouped: Record<string, any[]> = advisorData?.recommendations || {};
      const flat = Object.entries(grouped).flatMap(([category, recs]) =>
        (recs as any[]).map((r) => ({
          id: r.id || r.recommendationId || `${category}-${r.impactedField || ""}`,
          type: category,
          resource: r.impactedValue || r.impactedField || "unknown",
          estimated_savings_usd: String(parseAzureNumber(r.extendedProperties?.annualSavingsAmount || r.extendedProperties?.savingsAmount || 0).toFixed(2)),
          priority: r.impact || "medium",
          details: {
            problem: r.shortDescription?.problem || null,
            solution: r.shortDescription?.solution || null,
          },
        }))
      );
      data = flat.slice(offset, offset + limit);
    } catch (e) {
      console.warn("[v1/recommendations] collectAdvisorData falló, devolviendo lista vacía:", errorMessage(e));
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
    console.error("Error in GET /api/v1/recommendations:", error);
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
