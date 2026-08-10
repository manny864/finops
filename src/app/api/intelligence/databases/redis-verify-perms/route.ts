// Verify if Service Principal has Reader role on the subscription

import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireRequestIdentity } from "@/lib/requestAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await requireRequestIdentity(request);
    console.log(`[redis-verify-perms] tenantId=${tenantId}`);

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

    // Try to list all role assignments on the subscription
    const roleAssignmentsUrl = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleAssignments?api-version=2020-10-01`;
    
    console.log(`[redis-verify-perms] Checking role assignments on subscription ${subscriptionId}`);
    try {
      const response = await fetch(roleAssignmentsUrl, {
        method: "GET",
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        console.warn(`[redis-verify-perms] HTTP ${response.status} checking role assignments`);
        return NextResponse.json({ 
          error: `HTTP ${response.status} checking role assignments`,
          canListRoles: false 
        }, { status: response.status });
      }

      const json: any = await response.json();
      const roleAssignments = Array.isArray(json.value) ? json.value : [];
      console.log(`[redis-verify-perms] Found ${roleAssignments.length} role assignments`);

      // Look for Reader role
      const readerRoles = roleAssignments.filter((ra: any) => {
        const roleId = (ra.properties?.roleDefinitionId || "").toLowerCase();
        // Reader role ID ends with /acf72b34-7ee2-49b9-be74-a8073da8bcf9
        return roleId.includes("acf72b34-7ee2-49b9-be74-a8073da8bcf9");
      });

      console.log(`[redis-verify-perms] Found ${readerRoles.length} Reader roles`);

      return NextResponse.json({
        success: true,
        totalRoleAssignments: roleAssignments.length,
        readerRolesCount: readerRoles.length,
        readerRoleIds: readerRoles.map((r: any) => ({
          principalId: r.properties?.principalId,
          roleDefinitionId: r.properties?.roleDefinitionId,
        })),
        allRoleDefinitionIds: [...new Set(roleAssignments.map((r: any) => r.properties?.roleDefinitionId))],
      });
    } catch (err) {
      console.error(`[redis-verify-perms] Error:`, err);
      return NextResponse.json({
        success: false,
        error: String(err),
      }, { status: 500 });
    }
  } catch (err: any) {
    console.error("[redis-verify-perms] Auth error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
