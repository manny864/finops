import { NextRequest, NextResponse } from "next/server";
import { getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, resourceIds } = body;

    if (!tenantId || !resourceIds || !Array.isArray(resourceIds) || resourceIds.length === 0) {
      return NextResponse.json({ error: "Missing or invalid tenantId/resourceIds" }, { status: 400 });
    }

    // Requiere acceso básico al tenant para consultar
    await requireTenantRole(request, tenantId, ["Reader", "Contributor", "Admin", "Owner"]);

    const client = await getResourceGraphClient(tenantId);
    
    // Obtenemos todas las suscripciones del tenant (ARG requiere scope)
    const subscriptions = await getSubscriptionsForTenant(tenantId);
    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ existingResourceIds: [] });
    }

    const subIds = subscriptions.map((s: any) => s.subscriptionId);

    // Formatear IDs para query de Kusto
    const idListStr = resourceIds.map(id => `'${String(id).toLowerCase()}'`).join(',');
    const query = `
      Resources 
      | where tolower(id) in (${idListStr})
      | project id
    `;

    const response = await client.resources({
      query,
      subscriptions: subIds
    });

    const existingResourceIds = (response.data as any[]).map(row => String(row.id).toLowerCase());

    return NextResponse.json({ existingResourceIds });
  } catch (e: any) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Error fetching resource status:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
