// List all subscriptions the SP can access + verify Redis subscription

import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireRequestIdentity } from "@/lib/requestAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await requireRequestIdentity(request);

    const credential = await getAzureCredential(tenantId);
    const token = await credential.getToken("https://management.azure.com/.default");
    if (!token?.token) {
      return NextResponse.json({ error: "No token" }, { status: 401 });
    }

    // List all accessible subscriptions
    const response = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
      headers: { Authorization: `Bearer ${token.token}` },
    });

    if (!response.ok) {
      return NextResponse.json({ error: `HTTP ${response.status}` }, { status: response.status });
    }

    const json: any = await response.json();
    const allSubs = (json.value || []).map((s: any) => s.subscriptionId);

    // Check if Redis subscription is accessible
    const redisSubscriptionId = "ec03e8ce-ceee-4638-b303-64ae431d5b1e";
    const hasRedisSubscription = allSubs.includes(redisSubscriptionId);

    // Try to verify access to Redis subscription by listing resources
    let canAccessRedisSubscription = false;
    if (hasRedisSubscription) {
      try {
        const testUrl = `https://management.azure.com/subscriptions/${redisSubscriptionId}/resources?api-version=2021-04-01&$top=1`;
        const testResp = await fetch(testUrl, {
          headers: { Authorization: `Bearer ${token.token}` },
        });
        canAccessRedisSubscription = testResp.ok;
      } catch {
        canAccessRedisSubscription = false;
      }
    }

    return NextResponse.json({
      allAccessibleSubscriptions: allSubs,
      totalCount: allSubs.length,
      redisSubscriptionId,
      isInAccessibleList: hasRedisSubscription,
      canAccessRedisSubscription,
      diagnostic: hasRedisSubscription
        ? canAccessRedisSubscription
          ? "✅ Redis subscription is accessible"
          : "⚠️ Redis subscription in list but cannot access resources"
        : "❌ Redis subscription NOT in accessible subscriptions list. Service Principal needs Reader role on that subscription.",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
