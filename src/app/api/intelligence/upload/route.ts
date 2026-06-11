import { NextRequest, NextResponse } from "next/server";
import { mapCsvToFocus, FocusCostEntry } from "@/modules/core/focusMapper";
import { getAssessment } from "@/modules/core/aiProvider";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        
        if (!body.data || !Array.isArray(body.data)) {
            return NextResponse.json({ error: "Invalid CSV payload. Expected JSON array in 'data' field." }, { status: 400 });
        }

        const rawData: any[] = body.data;
        const focusData: FocusCostEntry[] = rawData.map(row => mapCsvToFocus(row));

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
        console.error("Error processing CSV upload:", error);
        return NextResponse.json({ error: "Internal server error processing CSV", details: error.message }, { status: 500 });
    }
}
