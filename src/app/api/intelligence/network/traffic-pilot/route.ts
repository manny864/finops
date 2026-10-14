import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage, errorStatus, serverError } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import { getNetworkTrafficPilot, type NetworkTrafficPilotResult } from "@/services/networkTrafficPilot.service";

export const dynamic = "force-dynamic";

const MAX_DAYS = 30;

function demoTraffic(days: number): NetworkTrafficPilotResult & { mock: true } {
  const edges = [
    { source: "Subnet: rg-app/vnet-prod/app", destination: "Subnet: rg-data/vnet-prod/data", sourceRegion: "eastus", destinationRegion: "eastus", flowType: "IntraVNet", bytes: 4_294_967_296, records: 1840 },
    { source: "Subnet: rg-app/vnet-prod/app", destination: "Region: westus2", sourceRegion: "eastus", destinationRegion: "westus2", flowType: "InterVNet", bytes: 1_073_741_824, records: 420 },
    { source: "Internet", destination: "Subnet: rg-edge/vnet-prod/ingress", sourceRegion: "", destinationRegion: "eastus", flowType: "ExternalPublic", bytes: 536_870_912, records: 205 },
  ];
  return {
    status: "ready",
    days,
    configuredFlowLogs: 2,
    activeFlowLogs: 2,
    workspaceCount: 1,
    queriedWorkspaceCount: 1,
    workspacesWithoutId: 0,
    skippedWorkspaceCount: 0,
    truncated: false,
    totalObservedBytes: edges.reduce((sum, edge) => sum + edge.bytes, 0),
    edges,
    issues: [],
    mock: true,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    const requestedDays = Number(searchParams.get("dias"));
    const days = Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(Math.trunc(requestedDays), MAX_DAYS)
      : 7;

    if (isMockTenant(tenantId)) {
      return NextResponse.json(demoTraffic(days));
    }

    await requireTenantAccess(request, tenantId);
    return NextResponse.json(await getNetworkTrafficPilot(tenantId, days));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
    }
    console.error("[/api/intelligence/network/traffic-pilot]", errorMessage(error));
    return serverError(error);
  }
}
