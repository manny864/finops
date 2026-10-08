import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { suggestTagsForResource } from "@/services/azureTagGovernance.service";
import { errorMessage } from "@/lib/apiErrors";

export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: NextRequest) {
  try {
    // Sin fallback a "default" ni bypass por `?mock=true`: cualquiera podía
    // saltear la autenticación agregando ese parámetro. La demo entra por
    // isMockTenant, que es una lista fija.
    const tenantId = new URL(req.url).searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId requerido" }, { status: 400 });
    }
    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(req, tenantId);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }
    const resourceName = str(body?.resourceName).trim();
    if (!resourceName) {
      return NextResponse.json({ error: "resourceName requerido" }, { status: 400 });
    }

    const suggestedTags = suggestTagsForResource(resourceName, str(body.resourceType), str(body.resourceGroup));

    // `method` dice la verdad: es una heurística por convención de nombres, no
    // un modelo. Antes devolvía `confidence: 0.94` fijo, que no medía nada.
    return NextResponse.json({ success: true, suggestedTags, method: "heuristic" });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/governance/tags/suggest] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
