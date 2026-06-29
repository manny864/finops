import { NextRequest, NextResponse } from "next/server";
import { getCurrentMonthAmortizedCosts, getCostForecast } from "@/modules/collectors/azure/billingService";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";

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
        const subscriptionId = searchParams.get('subscriptionId') || 'All';

        if (!tenantId) {
            return NextResponse.json({ error: "Faltan parámetros: tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

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

    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        console.error("Error fetching forecast:", e);
        return NextResponse.json({ error: "Error fetching forecast" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, monthlyBudget } = body;

        if (!tenantId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        // Validate Tier
        const [tenants] = await pool.query('SELECT tier FROM Tenants WHERE tenant_id = ?', [tenantId]);
        if (!Array.isArray(tenants) || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }

        const tier = (tenants[0] as { tier?: string }).tier;
        if (!tier) {
            return NextResponse.json({ error: "Tier inválido para tenant." }, { status: 400 });
        }
        const normalizedTier = tier.toLowerCase();
        if (normalizedTier === 'starter' || normalizedTier === 'essential') {
             return NextResponse.json({ error: "Feature bloqueada. Requiere plan Pro o superior." }, { status: 403 });
        }

        // Real historical series from CostSnapshots (FOCUS) for the current month.
        const today = new Date();
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthStartStr = monthStart.toISOString().split('T')[0];

        const [costRows] = await pool.query(
            `SELECT DATE(ChargePeriodStart) AS day_date, SUM(EffectiveCost) AS daily
             FROM CostSnapshots
             WHERE tenant_id = ? AND ChargePeriodStart >= ?
             GROUP BY DATE(ChargePeriodStart)
             ORDER BY day_date ASC`,
            [tenantId, monthStartStr]
        );

        const dailyByDay = new Map<number, number>();
        (Array.isArray(costRows) ? costRows as any[] : []).forEach(r => {
            const d = r.day_date instanceof Date ? r.day_date : new Date(r.day_date);
            dailyByDay.set(d.getDate(), Number(r.daily) || 0);
        });

        if (dailyByDay.size === 0) {
            return NextResponse.json({
                success: true,
                empty: true,
                message: "Sin datos históricos del mes actual para proyectar. Ejecute el sync de costos.",
                chartData: [],
                projectedEndOfMonthCost: 0,
                isBreachPredicted: false,
                breachDate: null,
                budgetLimit: monthlyBudget || null
            });
        }

        const currentDay = today.getDate();
        const dailyCosts: { day: number; cost: number; dailySpend: number }[] = [];
        let accumulated = 0;
        for (let i = 1; i <= currentDay; i++) {
            const dailySpend = dailyByDay.get(i) ?? 0;
            accumulated += dailySpend;
            if (dailySpend > 0 || dailyCosts.length > 0) {
                dailyCosts.push({ day: i, cost: accumulated, dailySpend });
            }
        }

        if (dailyCosts.length < 2) {
            return NextResponse.json({
                success: true,
                empty: true,
                message: "Se requieren al menos 2 días con costo para proyectar.",
                chartData: [],
                projectedEndOfMonthCost: accumulated,
                isBreachPredicted: false,
                breachDate: null,
                budgetLimit: monthlyBudget || null
            });
        }

        const prediction = predictCost(dailyCosts, daysInMonth);

        let breachDate = null;
        // Si no se provee presupuesto explícito, no inventamos uno (8000 era arbitrario).
        const budget = (typeof monthlyBudget === 'number' && monthlyBudget > 0) ? monthlyBudget : null;

        if (prediction && budget != null && prediction.projectedCost > budget && prediction.slope > 0) {
            // Find when Y = Budget -> X = (Budget - Intercept) / Slope
            const breachDay = Math.round((budget - prediction.intercept) / prediction.slope);
            if (breachDay <= daysInMonth && breachDay > currentDay) {
                breachDate = new Date(today.getFullYear(), today.getMonth(), breachDay).toISOString().split('T')[0];
            }
        }

        const chartData = [];
        const accumByDay = new Map<number, number>();
        dailyCosts.forEach(p => accumByDay.set(p.day, p.cost));
        for (let i = 1; i <= daysInMonth; i++) {
            chartData.push({
                day: i,
                actualSpend: i <= currentDay ? (accumByDay.get(i) ?? null) : null,
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

    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Forecast API Error:", error);
        return NextResponse.json({ error: "Fallo al generar forecasting predictivo." }, { status: 500 });
    }
}
