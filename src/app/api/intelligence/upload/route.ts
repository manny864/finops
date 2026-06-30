import { NextRequest, NextResponse } from "next/server";
import { getAssessment, normalizeBillingCsv } from "@/modules/core/aiProvider";
import { FocusCostEntry } from "@/modules/core/focusMapper";
import { requireRequestIdentity, AuthError } from "@/lib/requestAuth";
import rateLimiter from "@/lib/rateLimiter";

/** Max rows accepted to prevent CPU/memory abuse and Gemini token drain. */
const MAX_ROWS = 10_000;
/** Rate limit: 5 uploads per user per 5 minutes. */
const RL_LIMIT = 5;
const RL_WINDOW_MS = 5 * 60_000;

export async function POST(request: NextRequest) {
    try {
        // Auth: requires valid JWT. Tenant + email resolved from token.
        const identity = await requireRequestIdentity(request);
        const { email, tenantId } = identity;

        // Rate limit per (tenant, email) to prevent Denial-of-Wallet on Gemini.
        const rl = rateLimiter.checkByKey(`upload:${tenantId}:${email}`, RL_LIMIT, RL_WINDOW_MS);
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

        const focusData = await normalizeBillingCsv(rawData);

        // Aggregate by ServiceName and ChargeCategory to prevent huge payloads going to Gemini
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

        // Call AI Provider
        const assessmentMarkdown = await getAssessment(summaryData);

        return NextResponse.json({ success: true, assessment: assessmentMarkdown, mappedEntries: summaryData.length });

    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Error processing CSV upload:", error);
        return NextResponse.json({ error: "Internal server error processing CSV", details: error.message }, { status: 500 });
    }
}
