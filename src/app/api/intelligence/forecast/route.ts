import { NextRequest, NextResponse } from "next/server";
import { getCurrentMonthAmortizedCosts, getCostForecast } from "@/modules/collectors/azure/billingService";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import {
  linearForecast,
  emaForecast,
  holtWintersForecast,
  dampedHoltForecast,
  ensembleForecast,
  forecastWithConfidence,
  evaluateForecast,
  selectBestMethod,
  selectBestMethodExtended,
  detectAnomalies,
  type HistoryPoint,
} from "@/lib/forecasting";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId') || 'All';
        const method = (searchParams.get('method') || 'auto') as 'linear' | 'ema' | 'holt_winters' | 'damped_holt' | 'ensemble' | 'auto';
        const daysParam = searchParams.get('days');
        const days = daysParam ? Math.min(parseInt(daysParam), 90) : 30;
        const withConfidence = searchParams.get('withConfidence') !== 'false';
        const withBacktest = searchParams.get('withBacktest') === 'true';

        if (!tenantId) {
            return NextResponse.json({ error: "Faltan parámetros: tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const metricType = (request.headers.get('x-metric-type') as 'ActualCost' | 'AmortizedCost') || 'ActualCost';

        // Get historical data — resilient: no credentials or Azure failure returns []
        let historicalEntries: Awaited<ReturnType<typeof getCurrentMonthAmortizedCosts>> = [];
        try {
            historicalEntries = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId, metricType);
        } catch (azureErr: any) {
            console.warn('[Forecast] getCurrentMonthAmortizedCosts failed (Azure unavailable):', azureErr?.message);
        }

        // Get forecast — getCostForecast is already resilient (returns [] instead of throwing)
        const forecastData = await getCostForecast(tenantId, subscriptionId, metricType);

        // If both are empty, return gracefully so dashboard/summary does NOT mark forecast as failed
        if (historicalEntries.length === 0 && forecastData.length === 0) {
            return NextResponse.json({ data: [], azureUnavailable: true });
        }

        // Combine into one array
        const combinedMap: Record<string, any> = {};

        historicalEntries.forEach(item => {
            const usageDate = item.UsageDate || item.ChargePeriodStart;
            if (usageDate) {
                const dateStr = String(usageDate);
                const formattedDate = dateStr.length === 8 ? `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}` : dateStr.slice(0, 10);
                if (!combinedMap[formattedDate]) {
                    combinedMap[formattedDate] = { date: formattedDate, actualCost: 0 };
                }
                combinedMap[formattedDate].actualCost += Number(item.EffectiveCost || item.BilledCost || 0);
            }
        });

        forecastData.forEach(item => {
            if (!combinedMap[item.date]) {
                combinedMap[item.date] = { date: item.date };
            }
            combinedMap[item.date].forecastCost = item.forecastCost;
        });

        const combinedData = Object.values(combinedMap).sort((a: any, b: any) => a.date.localeCompare(b.date));

        // For backwards compatibility, return simple response if no advanced params
        if (method === 'auto' && days === 30 && !withConfidence && !withBacktest) {
            return NextResponse.json({ data: combinedData });
        }

        // Build history from combined data (actual costs)
        const history: HistoryPoint[] = combinedData
            .filter((item: any) => item.actualCost && item.actualCost > 0)
            .map((item: any) => ({
                date: item.date,
                value: item.actualCost.toFixed(2),
            }));

        if (history.length < 2) {
            return NextResponse.json({
                data: combinedData,
                method_used: 'linear',
                forecast: [],
                metrics: { rmse: '0', mape: '0', history_points: history.length, forecast_horizon_days: days },
                backtest: null,
            });
        }

        // Determine which method to use
        let methodToUse: 'linear' | 'ema' | 'holt_winters' | 'damped_holt' | 'ensemble';
        if (method === 'auto') {
            methodToUse = selectBestMethodExtended(history);
        } else {
            methodToUse = method;
        }

        // Generate forecast
        let result;
        if (withConfidence && (methodToUse === 'linear' || methodToUse === 'ema' || methodToUse === 'holt_winters')) {
            result = forecastWithConfidence(history, days, methodToUse);
        } else {
            let forecast;
            if (methodToUse === 'linear') {
                forecast = linearForecast(history, days);
            } else if (methodToUse === 'ema') {
                forecast = emaForecast(history, days);
            } else if (methodToUse === 'damped_holt') {
                forecast = dampedHoltForecast(history, days);
            } else if (methodToUse === 'ensemble') {
                forecast = ensembleForecast(history, days);
            } else {
                forecast = holtWintersForecast(history, days);
            }
            result = {
                points: forecast,
                lower: [] as typeof forecast,
                upper: [] as typeof forecast,
                rmse: '0',
                mape: '0',
                method: methodToUse,
            };
        }

        // Generate forecast response with confidence bands
        const forecastResponse = result.points.map((point, idx) => ({
            date: point.date,
            value: point.value,
            lower: result.lower[idx]?.value || null,
            upper: result.upper[idx]?.value || null,
            method: methodToUse,
        }));

        // Calculate backtest metrics if requested
        let backtestMetrics = null;
        if (withBacktest && history.length >= 3) {
            try {
                // backtest only supports classical methods; for damped/ensemble we
                // approximate via holt_winters MAPE which tends to bound them.
                const backtestMethod = (methodToUse === 'damped_holt' || methodToUse === 'ensemble')
                    ? 'holt_winters' as const
                    : methodToUse;
                backtestMetrics = evaluateForecast(history, 0.8, backtestMethod);
            } catch (e) {
                console.warn('Backtest failed:', e);
            }
        }

        // Detect anomalies
        const anomalies = detectAnomalies(history, result);

        return NextResponse.json({
            // `data` tambien va en la respuesta avanzada: ningun consumidor
            // pasa withConfidence=false, asi que la rama simple de arriba es
            // inalcanzable desde la UI. Sin esto, admin/report (que arma
            // forecastSeries con `forecast?.data`) salia siempre vacio, en
            // Azure y en AWS.
            data: combinedData,
            method_used: methodToUse,
            forecast: forecastResponse,
            metrics: {
                rmse: result.rmse,
                mape: result.mape,
                history_points: history.length,
                forecast_horizon_days: days,
            },
            anomalies: anomalies.filter((a) => a.is_anomaly),
            backtest: backtestMetrics,
        });

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
        const { tenantId, monthlyBudget, method = 'holt_winters' } = body;

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
            // TZ-safe: si el driver devuelve string 'YYYY-MM-DD', parsear el día
            // directamente (new Date(str).getDate() corre el día en TZ detrás de UTC).
            let dayOfMonth: number;
            if (r.day_date instanceof Date) {
                dayOfMonth = r.day_date.getDate();
            } else {
                const m = String(r.day_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (!m) return;
                dayOfMonth = Number(m[3]);
            }
            dailyByDay.set(dayOfMonth, Number(r.daily) || 0);
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
        const history: HistoryPoint[] = [];
        let accumulated = 0;

        for (let i = 1; i <= currentDay; i++) {
            const dailySpend = dailyByDay.get(i) ?? 0;
            accumulated += dailySpend;
            if (dailySpend > 0 || history.length > 0) {
                const dateStr = new Date(today.getFullYear(), today.getMonth(), i).toISOString().split('T')[0];
                history.push({ date: dateStr, value: accumulated.toFixed(2) });
            }
        }

        if (history.length < 2) {
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

        // Use forecasting library for month-end projection
        const methodToUse = method === 'auto' ? selectBestMethod(history) : method;
        const daysToForecast = daysInMonth - currentDay;

        let forecast;
        if (methodToUse === 'linear') {
            forecast = linearForecast(history, daysToForecast);
        } else if (methodToUse === 'ema') {
            forecast = emaForecast(history, daysToForecast);
        } else {
            forecast = holtWintersForecast(history, daysToForecast);
        }

        let breachDate = null;
        const budget = (typeof monthlyBudget === 'number' && monthlyBudget > 0) ? monthlyBudget : null;

        // Get end-of-month projection
        const projectedEndOfMonthCost = forecast.length > 0
            ? parseFloat(forecast[forecast.length - 1].value)
            : accumulated;

        if (budget != null && projectedEndOfMonthCost > budget) {
            // Find the first forecast day that exceeds budget
            for (const point of forecast) {
                if (parseFloat(point.value) > budget) {
                    breachDate = point.date;
                    break;
                }
            }
        }

        // Build chart data
        const chartData = [];
        const accumByDay = new Map<number, number>();
        history.forEach((p) => {
            const d = new Date(p.date);
            accumByDay.set(d.getDate(), parseFloat(p.value));
        });

        for (let i = 1; i <= daysInMonth; i++) {
            const dataPoint: any = {
                day: i,
                actualSpend: i <= currentDay ? (accumByDay.get(i) ?? null) : null,
                budgetLimit: budget,
            };

            if (i > currentDay && forecast.length >= i - currentDay) {
                dataPoint.forecastedSpend = parseFloat(forecast[i - currentDay - 1].value);
            }

            chartData.push(dataPoint);
        }

        return NextResponse.json({
            success: true,
            method_used: methodToUse,
            projectedEndOfMonthCost,
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
