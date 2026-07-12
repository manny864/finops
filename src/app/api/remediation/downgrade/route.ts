import { NextRequest, NextResponse } from "next/server";
import { downgradeVirtualMachine } from "@/services/remediationService";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, subscriptionId, resourceGroup, resourceName, newSku } = body;

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    const identity = await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
    const email = identity.email;

    await downgradeVirtualMachine(tenantId, email, subscriptionId, resourceGroup, resourceName, newSku);

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Downgrade error:", e);
    const err = e as { code?: string; statusCode?: number; message?: string };
    if (err.code === "AuthorizationFailed" || err.statusCode === 403 || (err.message && err.message.includes("AuthorizationFailed"))) {
      return NextResponse.json({ 
          error: "MISSING_CONTRIBUTOR_ROLE", 
          clientId: process.env.AZURE_CLIENT_ID 
      }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
