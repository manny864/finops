// Search by instance name instead of type filter

import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireRequestIdentity } from "@/lib/requestAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await requireRequestIdentity(request);
    console.log(`[redis-search-by-name] tenantId=${tenantId}`);

    const credential = await getAzureCredential(tenantId);
    const token = await credential.getToken("https://management.azure.com/.default");
    if (!token?.token) {
      return NextResponse.json({ error: "No token" }, { status: 401 });
    }

    const subscriptionId = "0beb7800-aa59-4220-a603-b1861c7b9a27";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.token}`,
    };

    // Search for resources with "cscs-finops-prod-westus2-redis" or "cscs-finops-stg-westus2-redis" in the name
    const targetNames = ["cscs-finops-prod-westus2-redis", "cscs-finops-stg-westus2-redis"];
    const found: any[] = [];

    for (const name of targetNames) {
      const url = `https://management.azure.com/subscriptions/${subscriptionId}/resources?api-version=2021-04-01&$filter=name eq '${name}'`;
      
      console.log(`[redis-search-by-name] Searching for ${name}`);
      try {
        const response = await fetch(url, {
          method: "GET",
          headers,
          cache: "no-store",
        });

        if (!response.ok) {
          console.warn(`[redis-search-by-name] HTTP ${response.status} for ${name}`);
          continue;
        }

        const json: any = await response.json();
        const values = Array.isArray(json.value) ? json.value : [];
        console.log(`[redis-search-by-name] Found ${values.length} resources with name ${name}`);
        found.push(...values);
      } catch (err) {
        console.error(`[redis-search-by-name] Error searching for ${name}:`, err);
      }
    }

    console.log(`[redis-search-by-name] Total found: ${found.length}`);

    return NextResponse.json({
      totalFound: found.length,
      resources: found.map((r: any) => ({
        name: r.name,
        type: r.type,
        id: r.id,
        location: r.location,
        resourceGroup: r.resourceGroup,
      })),
    });
  } catch (err: any) {
    console.error("[redis-search-by-name] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
