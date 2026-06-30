import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
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
      requireScope(authResult, "read:resources");
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

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 1000);
    const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

    return NextResponse.json(
      {
        data: [
          {
            id: "placeholder-1",
            name: "Placeholder Resource",
            type: "Microsoft.Compute/virtualMachines",
            subscription_id: "sub-123",
            resource_group: "default",
            location: "eastus",
            tags: {},
          },
        ],
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
    console.error("Error in GET /api/v1/resources:", error);
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
