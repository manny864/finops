import { NextRequest, NextResponse } from "next/server";
import { getCurrentMonthAmortizedCosts, getCostForecast } from "@/modules/collectors/azure/billingService";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros: tenantId, subscriptionId" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

        const metricType = (request.headers.get('x-metric-type') as 'ActualCost' | 'AmortizedCost') || 'ActualCost';

        // First get historical (Focus schema)
        const historicalEntries = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId, metricType);
        
        // Then get forecast
        const forecast = await getCostForecast(tenantId, subscriptionId, metricType);

        // Combine into one array
        const combinedMap: Record<string, any> = {};

        historicalEntries.forEach(item => {
            if (item.UsageDate) {
                const dateStr = String(item.UsageDate);
                const formattedDate = dateStr.length === 8 ? `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}` : dateStr;
                if (!combinedMap[formattedDate]) {
                    combinedMap[formattedDate] = { date: formattedDate, actualCost: 0 };
                }
                combinedMap[formattedDate].actualCost += item.EffectiveCost;
            }
        });

        forecast.forEach(item => {
            if (!combinedMap[item.date]) {
                combinedMap[item.date] = { date: item.date };
            }
            combinedMap[item.date].forecastCost = item.forecastCost;
        });

        const combinedData = Object.values(combinedMap).sort((a: any, b: any) => a.date.localeCompare(b.date));

        return NextResponse.json({ data: combinedData });

    } catch (e: any) {
        console.error("Error fetching forecast:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
