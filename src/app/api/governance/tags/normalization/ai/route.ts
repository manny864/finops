import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { isMockTenant } from "@/lib/mockData";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { exigirSuscripcionDelTenant } from "@/lib/scopeDelTenant";
import { errorMessage } from "@/lib/apiErrors";
import {
  DEFAULT_MANDATORY_TAG_POLICIES,
  getTenantTagPolicies,
  scanTagGovernanceLive,
} from "@/services/azureTagGovernance.service";
import {
  getMockTagAiSuggestions,
  policyForAi,
  suggestTagValuesWithAi,
} from "@/services/tagValueAiSuggestion.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const POLICY_ERROR = "La etiqueta no tiene una política que admita ese modo.";

/**
 * Sugerencias con IA para lo que la normalización determinista no resolvió
 * (propuesta de IA, Fase 2b). Sólo propone: aplicar sigue siendo
 * /api/tags/apply-bulk o apply-inheritance, con su confirmación. Un denegado
 * responde 200 con `aiAvailable: false` y el motivo, como la explicación de
 * anomalías.
 */
export async function POST(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get("tenantId");
    const body = await req.json().catch(() => null);
    const mode = body?.mode;
    const tagName = typeof body?.tagName === "string" ? body.tagName.trim() : "";
    const subscriptionId =
      typeof body?.subscriptionId === "string" && body.subscriptionId && body.subscriptionId !== "All"
        ? body.subscriptionId
        : undefined;
    if (!tenantId || (mode !== "normalize" && mode !== "fill") || !tagName) {
      return NextResponse.json({ error: "Faltan tenantId, mode (normalize|fill) o tagName." }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      const policy = policyForAi(DEFAULT_MANDATORY_TAG_POLICIES, mode, tagName);
      if (!policy) return NextResponse.json({ error: POLICY_ERROR }, { status: 400 });
      return NextResponse.json({
        success: true,
        mock: true,
        ...getMockTagAiSuggestions(mode, policy, DEFAULT_MANDATORY_TAG_POLICIES),
      });
    }

    const identity = await requireTenantAccess(req, tenantId);
    await exigirSuscripcionDelTenant(tenantId, subscriptionId);
    const policies = await getTenantTagPolicies(tenantId);
    const policy = policyForAi(policies, mode, tagName);
    if (!policy) return NextResponse.json({ error: POLICY_ERROR }, { status: 400 });

    const result = await suggestTagValuesWithAi({
      tenantId,
      userKey: identity.email,
      mode,
      policy,
      policies,
      loadSummary: async () => {
        const subs = subscriptionId ? [subscriptionId] : await getSubscriptionsForTenant(tenantId);
        return scanTagGovernanceLive(await getAzureCredential(tenantId), subs, tenantId);
      },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/governance/tags/normalization/ai] Error:", errorMessage(err));
    return NextResponse.json({ error: "No se pudieron generar las sugerencias." }, { status: 500 });
  }
}
