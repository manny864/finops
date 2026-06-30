/**
 * GET /api/intelligence/forecast/by-service
 *
 * Decomposes the tenant's cost forecast by service, producing one independent
 * projection per service name. Lets users see which services drive the
 * projected month-end overrun, not just the total.
 *
 * Query params:
 *   - tenantId (required)
 *   - days (optional, default 30, max 90)
 *   - method (linear | ema | holt_winters | damped_holt | ensemble | auto), default 'auto'
 *   - topN (optional, default 10) — keep the top-N services by recent spend,
 *     bucket the rest into a synthetic "Other" line.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import {
    linearForecast,
    emaForecast,
    holtWintersForecast,
    dampedHoltForecast,
    ensembleForecast,
    selectBestMethodExtended,
    type HistoryPoint,
    type ForecastPoint,
} from "@/lib/forecasting";

type Method = "linear" | "ema" | "holt_winters" | "damped_holt" | "ensemble" | "auto";

const SUPPORTED: Method[] = ["linear", "ema", "holt_winters", "damped_holt", "ensemble", "auto"];

function runMethod(
    method: Exclude<Method, "auto">,
    history: HistoryPoint[],
    days: number
): ForecastPoint[] {
    if (method === "linear") return linearForecast(history, days);
    if (method === "ema") return emaForecast(history, days);
    if (method === "holt_winters") return holtWintersForecast(history, days);
    if (method === "damped_holt") return dampedHoltForecast(history, days);
    return ensembleForecast(history, days);
}

interface DailyServiceRow {
    service_name: string;
    day_date: string | Date;
    daily: string | number;
}

export async function GET(request: NextRequest) {
    try {
        const sp = request.nextUrl.searchParams;
        const tenantId = sp.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const days = Math.min(Math.max(Number(sp.get("days") || 30), 1), 90);
        const requestedMethod = (sp.get("method") || "auto") as Method;
        if (!SUPPORTED.includes(requestedMethod)) {
            return NextResponse.json({ error: `method debe ser uno de ${SUPPORTED.join(", ")}` }, { status: 400 });
        }
        const topN = Math.min(Math.max(Number(sp.get("topN") || 10), 1), 50);

        // Pull last 60 days of daily costs per service for this tenant.
        const [rows] = await pool.query(
            `SELECT service_name,
                    DATE(ChargePeriodStart) AS day_date,
                    SUM(EffectiveCost) AS daily
               FROM CostSnapshots
              WHERE tenant_id = ?
                AND ChargePeriodStart >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
              GROUP BY service_name, DATE(ChargePeriodStart)
              ORDER BY service_name ASC, day_date ASC`,
            [tenantId]
        );

        const raw = (rows as DailyServiceRow[]) || [];
        if (raw.length === 0) {
            return NextResponse.json({
                success: true,
                empty: true,
                message: "Sin datos históricos. Ejecutá el sync de costos.",
                services: [],
            });
        }

        // Bucket by service
        const byService = new Map<string, HistoryPoint[]>();
        for (const r of raw) {
            const d = r.day_date instanceof Date ? r.day_date : new Date(r.day_date);
            const dateStr = d.toISOString().slice(0, 10);
            const v = Number(r.daily) || 0;
            const name = r.service_name || "Unallocated";
            const arr = byService.get(name) || [];
            arr.push({ date: dateStr, value: v.toFixed(2) });
            byService.set(name, arr);
        }

        // Rank by total recent spend, keep topN, group rest as "Other"
        const ranked = [...byService.entries()]
            .map(([name, hist]) => {
                const total = hist.reduce((acc, p) => acc + parseFloat(p.value), 0);
                return { name, hist, total };
            })
            .sort((a, b) => b.total - a.total);

        const top = ranked.slice(0, topN);
        const rest = ranked.slice(topN);

        // Bucket "rest" into a single Other-time-series by summing per day
        if (rest.length > 0) {
            const otherMap = new Map<string, number>();
            for (const r of rest) {
                for (const p of r.hist) {
                    otherMap.set(p.date, (otherMap.get(p.date) || 0) + parseFloat(p.value));
                }
            }
            const otherHist: HistoryPoint[] = [...otherMap.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, v]) => ({ date, value: v.toFixed(2) }));
            const total = otherHist.reduce((acc, p) => acc + parseFloat(p.value), 0);
            top.push({ name: "Other", hist: otherHist, total });
        }

        // Forecast each
        const services = top.map(({ name, hist, total }) => {
            // Need at least 2 history points
            if (hist.length < 2) {
                return {
                    serviceName: name,
                    history: hist,
                    forecast: [],
                    methodUsed: null,
                    historyTotal: Math.round(total * 100) / 100,
                    forecastTotal: 0,
                    note: "Historial insuficiente (<2 puntos).",
                };
            }
            const methodToUse = requestedMethod === "auto" ? selectBestMethodExtended(hist) : requestedMethod;
            let fc: ForecastPoint[] = [];
            try {
                fc = runMethod(methodToUse, hist, days);
            } catch {
                fc = [];
            }
            const fcTotal = fc.reduce((acc, p) => acc + parseFloat(p.value), 0);
            return {
                serviceName: name,
                history: hist,
                forecast: fc,
                methodUsed: methodToUse,
                historyTotal: Math.round(total * 100) / 100,
                forecastTotal: Math.round(fcTotal * 100) / 100,
            };
        });

        return NextResponse.json({
            success: true,
            tenantId,
            days,
            method: requestedMethod,
            services,
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        const msg = e instanceof Error ? e.message : "Error";
        console.error("forecast/by-service error:", e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
