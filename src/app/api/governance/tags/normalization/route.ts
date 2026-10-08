import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import { AuthError, requireTenantAccess, requireTenantRole } from "@/lib/requestAuth";
import { errorMessage } from "@/lib/apiErrors";
import { getTenantTagPolicies } from "@/services/azureTagGovernance.service";
import {
  getMockTagNormalizationKpis,
  getTagNormalizationKpis,
  recordTagNormalizationDecision,
  type TagNormalizationDecisionInput,
} from "@/services/tagNormalization.service";

export const dynamic = "force-dynamic";

const SOURCES = ["rule", "ai"];
const METHODS = ["exact", "alias", "fuzzy", "ai"];
const MAX_VALUE = 256;

/** Valor opcional: null si no vino, undefined si vino mal. */
function opcional(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "string" && v.length <= MAX_VALUE ? v : undefined;
}

function parseDecision(b: Record<string, unknown>): TagNormalizationDecisionInput | string {
  const tagName = typeof b.tagName === "string" ? b.tagName.trim() : "";
  if (!tagName || tagName.length > 128) return "tagName inválido";
  if (typeof b.originalValue !== "string" || b.originalValue.length > MAX_VALUE) return "originalValue inválido";
  const suggestedValue = opcional(b.suggestedValue);
  const appliedValue = opcional(b.appliedValue);
  if (suggestedValue === undefined || appliedValue === undefined) return "suggestedValue/appliedValue inválidos";
  if (!suggestedValue && !appliedValue) return "Falta suggestedValue o appliedValue";
  const source = b.suggestionSource ?? null;
  if (source !== null && !SOURCES.includes(source as string)) return "suggestionSource inválido";
  const method = b.suggestedMethod ?? null;
  if (method !== null && !METHODS.includes(method as string)) return "suggestedMethod inválido";
  const confidence = b.suggestedConfidence ?? null;
  if (confidence !== null && (typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1))) {
    return "suggestedConfidence inválido";
  }
  const count = b.resourceCount ?? 0;
  if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > 100000) return "resourceCount inválido";
  return {
    tagName,
    originalValue: b.originalValue,
    suggestedValue,
    suggestionSource: source as TagNormalizationDecisionInput["suggestionSource"],
    suggestedMethod: method as string | null,
    suggestedConfidence: confidence as number | null,
    appliedValue,
    resourceCount: count as number,
    saveAlias: b.saveAlias === true,
  };
}

/** KPIs de normalización de valores de etiquetas (últimos KPI_PERIOD_DAYS días). */
export async function GET(req: NextRequest) {
  try {
    const tenantId = new URL(req.url).searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "tenantId requerido" }, { status: 400 });
    if (isMockTenant(tenantId)) return NextResponse.json(getMockTagNormalizationKpis());
    await requireTenantAccess(req, tenantId);
    return NextResponse.json(await getTagNormalizationKpis(tenantId));
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/governance/tags/normalization] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * Registra la decisión sobre un valor no conforme: corrección aplicada (por
 * /api/tags/apply-bulk, que es donde está la confirmación) o sugerencia
 * descartada. Con `saveAlias` la corrección queda como alias del tenant, así
 * que pide Admin/Owner, igual que editar las políticas.
 */
export async function POST(req: NextRequest) {
  try {
    const tenantId = new URL(req.url).searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "tenantId requerido" }, { status: 400 });
    const mock = isMockTenant(tenantId);
    const identity = mock ? null : await requireTenantRole(req, tenantId, ["Admin", "Owner"]);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }
    const input = parseDecision((body && typeof body === "object" ? body : {}) as Record<string, unknown>);
    if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });

    if (mock) {
      return NextResponse.json({ success: true, mock: true, aliasSaved: Boolean(input.saveAlias && input.appliedValue) });
    }

    const policy = (await getTenantTagPolicies(tenantId)).find(
      (p) => p.tagName.toLowerCase() === input.tagName.toLowerCase(),
    );
    if (!policy) return NextResponse.json({ error: "La etiqueta no tiene política" }, { status: 400 });
    if (input.appliedValue && policy.allowedValues?.length && !policy.allowedValues.includes(input.appliedValue)) {
      return NextResponse.json({ error: "El valor aplicado no está entre los permitidos" }, { status: 400 });
    }

    const { aliasSaved } = await recordTagNormalizationDecision(
      tenantId,
      { ...input, tagName: policy.tagName },
      identity?.email || identity?.claims?.oid || null,
    );
    return NextResponse.json({ success: true, aliasSaved });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/governance/tags/normalization:POST] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
