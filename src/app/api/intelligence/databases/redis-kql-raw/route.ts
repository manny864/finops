// Simple KQL test: List all resources of any type

import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireRequestIdentity } from "@/lib/requestAuth";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await requireRequestIdentity(request);
    console.log(`[redis-kql-raw] tenantId=${tenantId}`);

    const credential = await getAzureCredential(tenantId);

    // Use ResourceGraphClient directly (same as working queries elsewhere)
    const argClient = new ResourceGraphClient(credential);

    const subscriptionId = "0beb7800-aa59-4220-a603-b1861c7b9a27";

    // Query 1: All resources, top 100, get only names and types
    const query1 = `
      Resources
      | take 100
      | project name, type
    `;

    console.log(`[redis-kql-raw] Running query 1: List 100 resources (all types)`);
    try {
      const result1: any = await argClient.resources({
        subscriptions: [subscriptionId],
        query: query1,
        options: { resultFormat: "objectArray", top: 100 },
      });
      const rows1 = result1.data || [];
      console.log(`[redis-kql-raw] Query 1 returned ${rows1.length} rows`);

      // Find any with "redis" or "cache"
      const redisRows = rows1.filter((r: any) => {
        const type = (r.type || "").toLowerCase();
        const name = (r.name || "").toLowerCase();
        return type.includes("redis") || type.includes("cache") || name.includes("redis");
      });

      console.log(`[redis-kql-raw] Found ${redisRows.length} Redis-like rows:`, redisRows);

      return NextResponse.json({
        success: true,
        totalRows: rows1.length,
        redisLike: redisRows.length,
        redisLikeDetails: redisRows,
        allTypes: [...new Set(rows1.map((r: any) => r.type))].sort(),
      });
    } catch (qerr: any) {
      console.error(`[redis-kql-raw] Query 1 error:`, qerr.message);
      return NextResponse.json({
        success: false,
        error: qerr.message,
        queryType: "KQL",
      }, { status: 500 });
    }
  } catch (err: any) {
    console.error("[redis-kql-raw] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
