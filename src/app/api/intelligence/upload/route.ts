import { NextRequest, NextResponse } from "next/server";
import { getAssessment, extractAiErrorMessage } from "@/modules/core/aiProvider";
import { CsvMappingError, csvCurrency, normalizeBillingCsv } from "@/services/billingCsvMapping.service";
import { FocusCostEntry } from "@/modules/core/focusMapper";
import { requireRequestIdentity, assertTenantTier, AuthError } from "@/lib/requestAuth";
import rateLimiter from "@/lib/rateLimiter";
import { errorMessage, errorStatus, serverError } from '@/lib/apiErrors';
import { AI_FEATURES, checkAiFeature } from "@/lib/aiFeatureGate";
import { BodyLimitError, readJsonCapped } from "@/lib/readJsonCapped";

/** Max rows accepted to prevent CPU/memory abuse and AI token drain. */
const MAX_ROWS = 10_000;
/** Rate limit: 5 uploads per user per 5 minutes (Denial-of-Wallet). */
const RL_LIMIT = 5;
const RL_WINDOW_MS = 5 * 60_000;
const ASSESSMENT_FEATURE = "billing-upload-assessment";

/**
 * AISEC-06: topes antes de parsear y por celda. Holgados para un export completo de
 * Azure (60-100 columnas, Tags/AdditionalInfo en JSON, 10.000 filas con la clave
 * repetida en cada una); configurables por env.
 */
const envInt = (name: string, def: number) => {
    const n = Number(process.env[name]);
    return Number.isInteger(n) && n > 0 ? n : def;
};
const MAX_BODY_BYTES = envInt("BILLING_UPLOAD_MAX_BYTES", 32 * 1024 * 1024);
const MAX_COLUMNS = envInt("BILLING_UPLOAD_MAX_COLUMNS", 200);
const MAX_CELL_CHARS = envInt("BILLING_UPLOAD_MAX_CELL_CHARS", 4096);
const MAX_KEY_CHARS = 128;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** null = filas válidas; si no, el motivo (400). */
function unsafeRowsReason(rows: unknown[]): string | null {
    for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) return "Fila inválida: se esperaba un objeto.";
        const keys = Object.keys(row);
        if (keys.length === 0 || keys.length > MAX_COLUMNS) return `Número de columnas fuera de rango (máx. ${MAX_COLUMNS}).`;
        for (const k of keys) {
            if (FORBIDDEN_KEYS.has(k) || k.length > MAX_KEY_CHARS) return "Nombre de columna no permitido.";
            const v = (row as Record<string, unknown>)[k];
            if (v !== null && typeof v !== "string" && typeof v !== "number") return "Tipo de celda inválido.";
            if (typeof v === "string" && v.length > MAX_CELL_CHARS) return `Celda demasiado larga (máx. ${MAX_CELL_CHARS} caracteres).`;
        }
    }
    return null;
}

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

        const body = (await readJsonCapped(request, MAX_BODY_BYTES)) as { data?: unknown; locale?: unknown } | null;

        if (!body || typeof body !== "object" || !body.data || !Array.isArray(body.data)) {
            return NextResponse.json({ error: "Invalid CSV payload. Expected JSON array in 'data' field." }, { status: 400 });
        }

        const rawData: any[] = body.data;

        if (rawData.length > MAX_ROWS) {
            return NextResponse.json(
                { error: `Payload too large. Maximum ${MAX_ROWS.toLocaleString()} rows allowed; received ${rawData.length}.` },
                { status: 413 }
            );
        }

        const unsafe = unsafeRowsReason(rawData);
        if (unsafe) return NextResponse.json({ error: unsafe }, { status: 400 });

        const focusData = await normalizeBillingCsv(rawData, tenantId, email);

        // Aggregate by ServiceName and ChargeCategory to keep the payload sent to the
        // tenant's configured AI provider small (getAssessment -> AIProviderFactory).
        const aggregated: Record<string, FocusCostEntry> = {};
        
        focusData.forEach(entry => {
            // JSON y no "a-b": con guion, ("a-b","c") y ("a","b-c") caían en el mismo grupo.
            const key = JSON.stringify([entry.ServiceName, entry.ChargeCategory]);
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
        if (error instanceof BodyLimitError) {
            return NextResponse.json(
                { error: error.status === 413 ? `Payload demasiado grande (máx. ${Math.round(MAX_BODY_BYTES / 1048576)} MB).` : error.message },
                { status: error.status }
            );
        }
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
