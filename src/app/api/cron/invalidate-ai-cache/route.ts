import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/requestAuth";
import { invalidateCachePattern } from "@/lib/cache";

/**
 * Internal cron endpoint to invalidate AI analytics cache for a specific tenant.
 * Used when models/costs change and we need to force a fresh fetch.
 * 
 * RBAC: requireSuperAdmin (internal-only, no tenant scope)
 * Usage: curl -X POST http://localhost:3000/api/cron/invalidate-ai-cache \
 *   -H "Authorization: Bearer $CRON_SECRET" \
 *   -H "Content-Type: application/json" \
 *   -d '{"tenantId": "..."}'
 */

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin(request);

    const body = await request.json();
    const { tenantId } = body;

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    // Invalidate all ai-analytics cache keys for this tenant (all day parameters)
    const pattern = `ai-analytics:v11:${tenantId}:*`;
    await invalidateCachePattern(pattern);

    return NextResponse.json({
      success: true,
      message: `Cache invalidated for pattern: ${pattern}`,
      tenantId,
    });
  } catch (error) {
    const msg = (error as Error)?.message || String(error);
    if (msg.includes("SuperAdmin")) {
      return NextResponse.json(
        { error: "Forbidden. Requires SuperAdmin role." },
        { status: 403 }
      );
    }
    console.error("[invalidate-ai-cache] Error:", msg);
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
