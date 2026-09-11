import { NextRequest, NextResponse } from "next/server";
import { downgradeVirtualMachine } from "@/services/remediationService";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { azureErrorResponse } from "@/lib/apiErrors";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, subscriptionId, resourceGroup, resourceName, newSku, direction } = body;

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    // Sin esto, un campo vacío llegaba al SDK de Azure y reventaba con un 500
    // opaco en vez de decir qué faltaba.
    if (!GUID.test(String(subscriptionId || ""))) {
      return NextResponse.json({ error: "subscriptionId inválido o ausente" }, { status: 400 });
    }
    for (const [key, value] of Object.entries({ resourceGroup, resourceName, newSku })) {
      if (!value || typeof value !== "string") {
        return NextResponse.json({ error: `Falta ${key}` }, { status: 400 });
      }
    }

    const identity = await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

    // El endpoint conserva el nombre por compatibilidad; el resize de ARM es el
    // mismo en las dos direcciones y solo cambia lo que se audita.
    await downgradeVirtualMachine(
      tenantId, identity.email, subscriptionId, resourceGroup, resourceName, newSku,
      direction === "UPGRADE" ? "UPGRADE" : "DOWNGRADE"
    );

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return azureErrorResponse(e, "POST /api/remediation/downgrade");
  }
}
