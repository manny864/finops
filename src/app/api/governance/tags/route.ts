import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import {
  scanTagGovernanceLive,
  getMockTagGovernanceSummary,
  saveLocalCachedTags,
} from "@/services/azureTagGovernance.service";
import { TagUpdatePayload } from "@/types/azureTagGovernance.types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "default";
    const subscriptionId = searchParams.get("subscriptionId") || undefined;
    const isMock = isMockTenant(tenantId) || searchParams.get("mock") === "true";

    // 1. Mock Tenant check PRIMERO
    if (isMock) {
      const mockData = getMockTagGovernanceSummary(tenantId);
      return NextResponse.json(mockData);
    }

    // 2. Tenant Real: Validación obligatoria de RBAC
    await requireTenantAccess(req, tenantId);

    const credential = await getAzureCredential(tenantId);
    let subs: string[] = [];
    if (subscriptionId && subscriptionId !== "All") {
      subs = [subscriptionId];
    } else {
      subs = await getSubscriptionsForTenant(tenantId);
    }

    const liveData = await scanTagGovernanceLive(credential, subs, tenantId);
    return NextResponse.json(liveData);
  } catch (err: any) {
    console.error("[api/governance/tags] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "default";
    const isMock = isMockTenant(tenantId) || searchParams.get("mock") === "true";

    const body = (await req.json()) as TagUpdatePayload;
    if (!body || !Array.isArray(body.resourceIds) || !body.tags) {
      return NextResponse.json({ error: "Invalid payload: resourceIds and tags are required" }, { status: 400 });
    }

    if (isMock) {
      // Demo mode: simulate success
      return NextResponse.json({
        success: true,
        message: `Etiquetas actualizadas correctamente (${body.resourceIds.length} recursos)`,
        updatedCount: body.resourceIds.length,
      });
    }

    // Tenant Real: RBAC check
    await requireTenantAccess(req, tenantId);

    // Save optimistically to LocalResourceTagsCache
    for (const resId of body.resourceIds) {
      await saveLocalCachedTags(tenantId, resId, body.tags);
    }

    return NextResponse.json({
      success: true,
      message: `Etiquetas sincronizadas en caché local (${body.resourceIds.length} recursos)`,
      updatedCount: body.resourceIds.length,
    });
  } catch (err: any) {
    console.error("[api/governance/tags:POST] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
