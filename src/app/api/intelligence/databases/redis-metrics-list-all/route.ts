// Debug endpoint: List ALL resources in subscription to find exact resourceType for Redis

import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireRequestIdentity } from "@/lib/requestAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await requireRequestIdentity(request);
    console.log(`[redis-metrics-list-all] tenantId=${tenantId}`);

    const credential = await getAzureCredential(tenantId);
    const token = await credential.getToken("https://management.azure.com/.default");
    if (!token?.token) {
      return NextResponse.json({ error: "No token" }, { status: 401 });
    }

    // Hardcode the subscription we know has Redis
    const subscriptionId = "0beb7800-aa59-4220-a603-b1861c7b9a27";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.token}`,
    };

    // List ALL resources (no filter) to see what resourceTypes exist
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/resources?api-version=2021-04-01&$top=1000`;

    console.log(`[redis-metrics-list-all] Fetching all resources from ${subscriptionId}`);
    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[redis-metrics-list-all] HTTP ${response.status}:`, text);
      return NextResponse.json({ error: `HTTP ${response.status}`, details: text }, { status: response.status });
    }

    const json: any = await response.json();
    const allResources = Array.isArray(json.value) ? json.value : [];

    // Find resources that contain "redis" or "cache"
    const redisLike = allResources.filter((r: any) => {
      const name = (r.name || "").toLowerCase();
      const type = (r.type || "").toLowerCase();
      return name.includes("redis") || type.includes("redis") || type.includes("cache");
    });

    // Group by resourceType
    const typeGroups: Record<string, any[]> = {};
    for (const res of redisLike) {
      const type = res.type || "unknown";
      if (!typeGroups[type]) typeGroups[type] = [];
      typeGroups[type].push({
        name: res.name,
        id: res.id,
        location: res.location,
        resourceGroup: res.resourceGroup,
      });
    }

    console.log(`[redis-metrics-list-all] Found ${allResources.length} total, ${redisLike.length} Redis-like`);
    console.log(`[redis-metrics-list-all] Grouped by type:`, typeGroups);

    return NextResponse.json({
      totalResources: allResources.length,
      redisLikeResources: redisLike.length,
      byType: typeGroups,
      allTypes: [...new Set(allResources.map((r: any) => r.type))].sort(),
    });
  } catch (err: any) {
    console.error("[redis-metrics-list-all] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
