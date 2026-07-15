import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { verifyApiKey, requireScope } from "@/lib/publicApiAuth";
import rateLimiter from "@/lib/rateLimiter";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";

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

    // Rate limit distribuido (Redis) — antes en memoria (per-proceso), lo que
    // permitía saltear el límite escalando horizontalmente o tras un restart
    // del contenedor. checkByKeyDistributed ya degrada a memoria si Redis
    // no responde (ver rateLimiter.ts).
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
      const credential = await getAzureCredential(authResult.tenantId);
      const subs = await getSubscriptionsForTenant(authResult.tenantId, credential);
      if (subs.length > 0) {
        const client = new ResourceGraphClient(credential);
        const result = await client.resources({
          subscriptions: subs,
          query: `Resources | project id, name, type, subscriptionId, resourceGroup, location, tags | order by name asc | skip ${offset} | take ${limit}`,
        });
        data = ((result.data as any[]) || []).map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          subscription_id: r.subscriptionId,
          resource_group: r.resourceGroup,
          location: r.location,
          tags: r.tags || {},
        }));
      }
    } catch (e: any) {
      console.warn("[v1/resources] Resource Graph query falló, devolviendo lista vacía:", e?.message);
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
