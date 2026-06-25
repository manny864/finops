import { NextRequest, NextResponse } from "next/server";
import { getCurrentMonthAmortizedCosts, getCostForecast } from "@/modules/collectors/azure/billingService";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";

// Simple linear regression to predict end of month cost
function predictCost(dailyCosts: { day: number, cost: number }[], daysInMonth: number) {
    if (dailyCosts.length < 2) return null;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    const n = dailyCosts.length;

    dailyCosts.forEach(p => {
        sumX += p.day;
        sumY += p.cost;
        sumXY += (p.day * p.cost);
        sumX2 += (p.day * p.day);
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const projectedCost = slope * daysInMonth + intercept;

    return { slope, intercept, projectedCost };
}

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

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, monthlyBudget } = body;

        if (!tenantId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId" }, { status: 400 });
        }

        // Validate Tier
        const [tenants]: any = await pool.query('SELECT tier FROM Tenants WHERE id = ?', [tenantId]);
        if (!tenants || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }

        const tier = tenants[0].tier;
        const normalizedTier = tier.toLowerCase();
        if (normalizedTier === 'starter' || normalizedTier === 'essential') {
             return NextResponse.json({ error: "Feature bloqueada. Requiere plan Pro o superior." }, { status: 403 });
        }

        // Mock daily accumulated cost data up to today
        const today = new Date();
        const currentDay = Math.min(today.getDate(), 15); // force max 15 to show forecast properly
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        
        const dailyCosts = [];
        let accumulated = 0;
        for (let i = 1; i <= currentDay; i++) {
            // Random daily spend between 300 and 400
            const dailySpend = 300 + Math.random() * 100;
            accumulated += dailySpend;
            dailyCosts.push({ day: i, cost: accumulated, dailySpend });
        }

        const prediction = predictCost(dailyCosts, daysInMonth);

        let breachDate = null;
        const budget = monthlyBudget || 8000;

        if (prediction && prediction.projectedCost > budget && prediction.slope > 0) {
            // Find when Y = Budget -> X = (Budget - Intercept) / Slope
            const breachDay = Math.round((budget - prediction.intercept) / prediction.slope);
            if (breachDay <= daysInMonth && breachDay > currentDay) {
                breachDate = new Date(today.getFullYear(), today.getMonth(), breachDay).toISOString().split('T')[0];
            }
        }

        const chartData = [];
        for (let i = 1; i <= daysInMonth; i++) {
            chartData.push({
                day: i,
                actualSpend: i <= currentDay ? dailyCosts[i-1].cost : null,
                forecastedSpend: prediction ? (prediction.slope * i + prediction.intercept) : null,
                budgetLimit: budget
            });
        }

        return NextResponse.json({
            success: true,
            projectedEndOfMonthCost: prediction ? prediction.projectedCost : accumulated,
            isBreachPredicted: !!breachDate,
            breachDate,
            chartData,
            budgetLimit: budget
        });

    } catch (error: any) {
        console.error("Forecast API Error:", error);
        return NextResponse.json({ error: "Fallo al generar forecasting predictivo.", details: error.message }, { status: 500 });
    }
}
