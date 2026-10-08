import { NextRequest, NextResponse } from "next/server";
import { getAssessment, extractAiErrorMessage } from "@/modules/core/aiProvider";
import { CsvMappingError, csvCurrency, normalizeBillingCsv } from "@/services/billingCsvMapping.service";
import { FocusCostEntry } from "@/modules/core/focusMapper";
import { requireRequestIdentity, assertTenantTier, AuthError } from "@/lib/requestAuth";
import rateLimiter from "@/lib/rateLimiter";
import { errorMessage, errorStatus, serverError } from '@/lib/apiErrors';
import { AI_FEATURES, checkAiFeature } from "@/lib/aiFeatureGate";

/** Max rows accepted to prevent CPU/memory abuse and AI token drain. */
const MAX_ROWS = 10_000;
/** Rate limit: 5 uploads per user per 5 minutes (Denial-of-Wallet). */
const RL_LIMIT = 5;
const RL_WINDOW_MS = 5 * 60_000;
const ASSESSMENT_FEATURE = "billing-upload-assessment";

export async function POST(request: NextRequest) {
    try {
        // Auth: requires valid JWT. Tenant + email resolved from token.
        const identity = await requireRequestIdentity(request);
        const { email, tenantId } = identity;
        // La pantalla es Business (routeTiers); sin esto un Professional
        // llamaba la API directo y gastaba IA que su plan no incluye.
        await assertTenantTier(identity, tenantId, "Business", request.nextUrl.pathname);

        // Rate limit per (tenant, email) to prevent Denial-of-Wallet on the AI provider.
        const rl = await rateLimiter.checkByKeyDistributed(`upload:${tenantId}:${email}`, RL_LIMIT, RL_WINDOW_MS);
        if (!rl.allowed) {
            return NextResponse.json(
                { error: `Rate limit exceeded. Max ${RL_LIMIT} uploads per 5 minutes. Retry after ${rl.resetAt.toISOString()}.` },
                { status: 429 }
            );
        }

        const body = await request.json();

        if (!body.data || !Array.isArray(body.data)) {
            return NextResponse.json({ error: "Invalid CSV payload. Expected JSON array in 'data' field." }, { status: 400 });
        }

        const rawData: any[] = body.data;

        if (rawData.length > MAX_ROWS) {
            return NextResponse.json(
                { error: `Payload too large. Maximum ${MAX_ROWS.toLocaleString()} rows allowed; received ${rawData.length}.` },
                { status: 413 }
            );
        }

        const focusData = await normalizeBillingCsv(rawData, tenantId, email);

        // Aggregate by ServiceName and ChargeCategory to keep the payload sent to the
        // tenant's configured AI provider small (getAssessment -> AIProviderFactory).
        const aggregated: Record<string, FocusCostEntry> = {};
        
        focusData.forEach(entry => {
            const key = `${entry.ServiceName}-${entry.ChargeCategory}`;
            if (!aggregated[key]) {
                aggregated[key] = {
                    BilledCost: 0,
                    EffectiveCost: 0,
                    ChargeCategory: entry.ChargeCategory,
                    ProviderName: entry.ProviderName,
                    SubAccountId: entry.SubAccountId,
                    ServiceName: entry.ServiceName,
                    UsageDate: entry.UsageDate
                };
            }
            aggregated[key].BilledCost += entry.BilledCost;
            aggregated[key].EffectiveCost += entry.EffectiveCost;
        });

        const summaryData = Object.values(aggregated).sort((a, b) => b.BilledCost - a.BilledCost).slice(0, 50);

        const currency = csvCurrency(rawData);

        // Sin IA, la carga igual sirve: devuelve el resumen calculado y el motivo.
        const gate = await checkAiFeature(tenantId, ASSESSMENT_FEATURE, email);
        if (!gate.allowed) {
            return NextResponse.json({
                success: true,
                assessment: null,
                aiUnavailable: gate.reason,
                summary: summaryData,
                currency,
                mappedEntries: summaryData.length,
            });
        }

        const assessmentMarkdown = await getAssessment(summaryData, tenantId, {
            feature: ASSESSMENT_FEATURE,
            maxOutputTokens: AI_FEATURES[ASSESSMENT_FEATURE].maxOutputTokens,
            locale: typeof body.locale === "string" ? body.locale : undefined,
            currency,
        });

        return NextResponse.json({ success: true, assessment: assessmentMarkdown, mappedEntries: summaryData.length });

    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        if (error instanceof CsvMappingError) {
            // La UI traduce `reason`; `error` queda para quien llame a la API directo.
            const status = error.reason === "invalid_mapping" ? 422 : error.reason === "quota" || error.reason === "rate_limited" ? 429 : 403;
            return NextResponse.json({ error: error.message, reason: error.reason }, { status });
        }
        console.error("Error processing CSV upload:", error);

        // Un fallo del proveedor de IA (deployment inexistente, credencial
        // inválida, 429) no es un error interno del servidor: es configuración
        // del tenant y el admin puede arreglarlo. Devolver un 500 genérico
        // ocultaba el motivo — el caso real fue un 404 DeploymentNotFound que
        // en pantalla se leía "Internal server error processing CSV".
        const aiMessage = extractAiErrorMessage(error);
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 401 || status === 403 || status === 429) {
            return NextResponse.json(
                { error: `El proveedor de IA rechazó la solicitud (${status}): ${aiMessage}. Revisá la configuración en Configuración Global → IA.` },
                { status: 502 }
            );
        }

        return serverError(error, { message: "Internal server error processing CSV", status: 500 });
    }
}
