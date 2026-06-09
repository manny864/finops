import { NextRequest, NextResponse } from "next/server";
import { downgradeVirtualMachine } from "@/services/remediationService";
import jwt from "jsonwebtoken";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return NextResponse.json({ error: "No auth" }, { status: 401 });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const body = await request.json();
    const { tenantId, subscriptionId, resourceGroup, resourceName, newSku } = body;

    const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";

    await downgradeVirtualMachine(tenantId, email, subscriptionId, resourceGroup, resourceName, newSku);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("Downgrade error:", e);
    if (e.code === "AuthorizationFailed" || e.statusCode === 403 || (e.message && e.message.includes("AuthorizationFailed"))) {
      return NextResponse.json({ 
          error: "MISSING_CONTRIBUTOR_ROLE", 
          clientId: process.env.AZURE_CLIENT_ID 
      }, { status: 403 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
