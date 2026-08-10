// Check which subscriptions are being returned for the tenant

import { NextRequest, NextResponse } from "next/server";
import { getSubscriptionsForTenant } from "@/lib/azure";
import { requireRequestIdentity } from "@/lib/requestAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await requireRequestIdentity(request);
    console.log(`[redis-check-subs] tenantId=${tenantId}`);

    const subscriptionIds = await getSubscriptionsForTenant(tenantId);
    console.log(`[redis-check-subs] Found ${subscriptionIds.length} subscriptions:`, subscriptionIds);

    return NextResponse.json({
      tenantId,
      subscriptionIds,
      count: subscriptionIds.length,
      expectedRedisSubscription: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      hasRedisSubscription: subscriptionIds.includes("ec03e8ce-ceee-4638-b303-64ae431d5b1e"),
    });
  } catch (err: any) {
    console.error("[redis-check-subs] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
