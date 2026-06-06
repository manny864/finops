import { NextRequest, NextResponse } from "next/server";
import { getCurrentMonthAmortizedCosts, getCostForecast } from "@/services/billingService";
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

        // First get historical
        const historical = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId);
        
        // Then get forecast
        const forecast = await getCostForecast(tenantId, subscriptionId);

        // Combine into one array
        const combinedMap: Record<string, any> = {};

        historical.dailyTrend.forEach(item => {
            combinedMap[item.date] = { date: item.date, actualCost: item.cost };
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
