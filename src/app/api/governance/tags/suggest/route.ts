import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import {
  DEFAULT_MANDATORY_TAG_POLICIES,
  MOCK_TAG_VALUE_ALIASES,
  getTagValueAliases,
  getTenantTagPolicies,
  suggestTagValues,
} from "@/services/azureTagGovernance.service";
import { errorMessage } from "@/lib/apiErrors";

export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Etiquetas actuales del recurso: sólo pares string, con un tope (Azure admite 50). */
function currentTagsOf(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === "string" && e[0].length <= 512 && e[1].length <= 256)
      .slice(0, 50)
  );
}

export async function POST(req: NextRequest) {
  try {
    // Sin fallback a "default" ni bypass por `?mock=true`: cualquiera podía
    // saltear la autenticación agregando ese parámetro. La demo entra por
    // isMockTenant, que es una lista fija.
    const tenantId = new URL(req.url).searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId requerido" }, { status: 400 });
    }
    const isDemo = isMockTenant(tenantId);
    if (!isDemo) {
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

    const [policies, aliases] = isDemo
      ? [DEFAULT_MANDATORY_TAG_POLICIES, MOCK_TAG_VALUE_ALIASES]
      : await Promise.all([getTenantTagPolicies(tenantId), getTagValueAliases(tenantId)]);
    const details = suggestTagValues(
      {
        resourceName,
        resourceType: str(body.resourceType),
        resourceGroup: str(body.resourceGroup),
        currentTags: currentTagsOf(body.currentTags),
      },
      policies,
      aliases
    );
    const suggestedTags = Object.fromEntries(Object.entries(details).map(([tag, d]) => [tag, d.value]));

    // `method` dice la verdad: son reglas (normalizador y convención de nombres),
    // no un modelo. El método y la confianza de cada etiqueta van en `details`;
    // antes había un `confidence: 0.94` fijo que no medía nada.
    return NextResponse.json({ success: true, suggestedTags, details, method: "heuristic" });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/governance/tags/suggest] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
