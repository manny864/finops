import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { sendWebhookAlert } from "@/lib/notifications";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { recordDailySnapshotAsync } from "@/services/snapshotService";
import { redis } from "@/lib/redis";
import { getHistoricalDailyCosts, AZURE_COST_HISTORY_MAX_MONTHS } from "@/modules/collectors/azure/billingService";

// Ventana de detección "reciente": los últimos N días se evalúan contra la
// línea base (todo lo anterior, hasta AZURE_COST_HISTORY_MAX_MONTHS de
// historial). 30 días da una ventana de revisión razonable sin diluir el
// panel con anomalías demasiado viejas para accionar.
const DETECTION_WINDOW_DAYS = 30;

// ── Z-Score helpers ─────────────────────────────────────────────────────────
function computeStats(values: number[]): { mean: number; stdDev: number } {
    if (values.length === 0) return { mean: 0, stdDev: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
    return { mean, stdDev: Math.sqrt(variance) };
}

function detectAnomalies(
    dailyCosts: { date: string; amount: number }[],
    mean: number,
    stdDev: number,
    subscriptionId: string,
    threshold = 2.5
) {
    if (stdDev === 0) return [];
    return dailyCosts
        .filter(d => {
            const z = (d.amount - mean) / stdDev;
            return z > threshold;
        })
        .map((d, i) => ({
            id: i + 1,
            date: d.date,
            amount: d.amount,
            expected_amount: mean,
            z_score: (d.amount - mean) / stdDev,
            status: 'Open',
            subscription_id: subscriptionId,
            detected_at: new Date().toISOString()
        }));
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const tier = searchParams.get('tier') || 'Essential';
        const subscriptionId = searchParams.get('subscriptionId') || 'All';

        if (!tenantId) {
            return NextResponse.json({ error: "Tenant ID requerido" }, { status: 400 });
        }

        // Auth antes de cualquier branch (incl. mock), consistente con el resto de rutas.
        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        // ── MOCK ──────────────────────────────────────────────────────────────
        if (isMockTenant(tenantId)) {
            const today = new Date();
            // Días con picos de gasto simulados, repartidos en la ventana de 60 días
            // para poder mostrar anomalías en distintos estados (Open/Postponed/
            // Dismissed/Completed) en el demo.
            const spikeIndices = [59, 55, 47, 39, 30, 21, 12];
            const spikeSet = new Set(spikeIndices);
            const dailyCosts = Array.from({ length: 60 }).map((_, i) => {
                const date = new Date(today.getTime() - (59 - i) * 24 * 60 * 60 * 1000);
                const baseCost = 150 + Math.random() * 50;
                const spikeCost = 600 + Math.random() * 500;
                return { date: date.toISOString().split('T')[0], amount: spikeSet.has(i) ? spikeCost : baseCost };
            });
            const baseline = dailyCosts.filter((_, i) => !spikeSet.has(i)).slice(0, 40).map(d => d.amount);
            const { mean, stdDev } = computeStats(baseline);

            const STATUS_CYCLE = ['Open', 'Postponed', 'Dismissed', 'Completed', 'Completed', 'Open', 'Dismissed'];
            const SUBS = ['sub-prod-eastus', 'sub-dev-westeurope', 'sub-shared-services', 'sub-prod-brazilsouth'];
            const anomalies = [...spikeIndices].sort((a, b) => b - a).map((idx, i) => {
                const d = dailyCosts[idx];
                const detectedAt = new Date(new Date(d.date).getTime() + 6 * 60 * 60 * 1000);
                const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
                const resolvedAt = status !== 'Open'
                    ? new Date(detectedAt.getTime() + (4 + Math.random() * 36) * 60 * 60 * 1000)
                    : null;
                return {
                    id: i + 1,
                    date: d.date,
                    amount: d.amount,
                    expected_amount: mean,
                    z_score: stdDev > 0 ? (d.amount - mean) / stdDev : 0,
                    status,
                    subscription_id: SUBS[i % SUBS.length],
                    detected_at: detectedAt.toISOString(),
                    resolved_at: resolvedAt ? resolvedAt.toISOString() : null,
                };
            });
            if (anomalies.length > 0) {
                const dashboardUrl = `${request.nextUrl.origin}/intelligence/anomalies`;
                await sendWebhookAlert(tenantId,
                    "🚨 Anomalía de Gasto Detectada (Z-Score Alert)",
                    `Gasto anormal de **$${anomalies[0].amount.toFixed(2)}** en *${subscriptionId}*. Promedio esperado: $${mean.toFixed(2)}.\n\n<a href="${dashboardUrl}">🔍 Investigar</a>`,
                    'warning'
                ).catch(() => {});
            }
            return NextResponse.json({ success: true, dailyCosts, anomalies, mean, stdDev });
        }

        // ── REAL TENANT ───────────────────────────────────────────────────────
        const [tierRows] = await pool.query(
            "SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        if (!Array.isArray(tierRows) || tierRows.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }

        const resolvedTier = String((tierRows[0] as { tier?: string }).tier || tier);
        const isPro = ["professional", "business", "enterprise"].includes(resolvedTier.toLowerCase());
        if (!isPro) {
            return NextResponse.json({
                success: true, dailyCosts: [], anomalies: [],
                message: "La detección de anomalías requiere Tier Professional o superior."
            });
        }

        // ── Obtener costos diarios desde CostSnapshots, hasta el máximo histórico
        // que permite Azure Cost Management (AZURE_COST_HISTORY_MAX_MONTHS = 13
        // meses), con backfill live desde Azure cuando el snapshot local no
        // cubre toda la ventana (mismo patrón que /api/intelligence/cost-projection).
        // Cuanta más profundidad histórica tenga la línea base, más robusto es
        // el panel de detección de anomalías (menos falsos positivos por
        // estacionalidad, picos legítimos de fin de mes, etc.).
        const subFilter = subscriptionId && subscriptionId !== 'All'
            ? `AND LOWER(subscription_id) IN (${subscriptionId.split(',').map(() => '?').join(',')})`
            : '';
        const subParams: string[] = subscriptionId !== 'All'
            ? subscriptionId.split(',').map(s => s.trim().toLowerCase())
            : [];

        const cacheKey = `anomalies:dailyCosts:v1:${tenantId}:${subscriptionId.toLowerCase()}`;
        let dailyCosts: { date: string; amount: number }[] | null = null;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) dailyCosts = JSON.parse(cached);
        } catch (e: any) {
            console.warn("[anomalies] Redis read failed:", e?.message);
        }

        if (!dailyCosts) {
            const query = `
                SELECT
                    DATE(COALESCE(ChargePeriodStart, date)) AS day_date,
                    SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS daily_total
                FROM CostSnapshots
                WHERE tenant_id = ?
                  AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL ${AZURE_COST_HISTORY_MAX_MONTHS} MONTH)
                  ${subFilter}
                GROUP BY day_date
                ORDER BY day_date ASC
            `;
            const [costRows] = await pool.query(query, [tenantId, ...subParams]);
            const rows = Array.isArray(costRows) ? costRows as any[] : [];

            const costMap = new Map<string, number>();
            rows.forEach(r => {
                const d = r.day_date instanceof Date
                    ? r.day_date.toISOString().split('T')[0]
                    : String(r.day_date).split('T')[0];
                costMap.set(d, Number(r.daily_total) || 0);
            });

            // Backfill desde Azure si el snapshot local no arranca donde debería
            // (tenant nuevo o gaps por cron caído) — Azure gana en fechas
            // superpuestas (viene en USD normalizado vía CostUSD).
            const requiredFrom = new Date();
            requiredFrom.setMonth(requiredFrom.getMonth() - AZURE_COST_HISTORY_MAX_MONTHS);
            const sortedDates = Array.from(costMap.keys()).sort();
            const needsBackfill = sortedDates.length === 0 || new Date(sortedDates[0]) > requiredFrom;
            let backfillOk = true;
            if (needsBackfill) {
                try {
                    const historical = await getHistoricalDailyCosts(tenantId, subscriptionId, AZURE_COST_HISTORY_MAX_MONTHS);
                    for (const { date, cost } of historical) {
                        costMap.set(date, cost);
                    }
                    backfillOk = historical.length > 0;
                } catch (e: any) {
                    console.warn("[anomalies] historical Azure backfill failed:", e?.message);
                    backfillOk = false;
                }
            }

            // Serie continua desde el primer día con datos hasta hoy (huecos = 0).
            const allDates = Array.from(costMap.keys()).sort();
            if (allDates.length === 0) {
                dailyCosts = [];
            } else {
                const start = new Date(allDates[0]);
                const end = new Date();
                const built: { date: string; amount: number }[] = [];
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    const ds = d.toISOString().split('T')[0];
                    built.push({ date: ds, amount: costMap.get(ds) ?? 0 });
                }
                dailyCosts = built;
            }

            // TTL adaptativo: 6h con backfill sano; 10 min si Azure falló, para
            // reintentar pronto en vez de dejar 6h un panel incompleto cacheado.
            const ttl = backfillOk ? 6 * 3600 : 600;
            redis.set(cacheKey, JSON.stringify(dailyCosts), "EX", ttl)
                .catch((e: any) => console.warn("[anomalies] Redis write failed:", e?.message));
        }

        if (dailyCosts.length < 7) {
            return NextResponse.json({
                success: true,
                dailyCosts: [],
                anomalies: [],
                mean: 0,
                stdDev: 0,
                message: `Historial insuficiente (${dailyCosts.length} días). Se requieren al menos 7 días de datos.`
            });
        }

        // Baseline: todo excepto la ventana de detección reciente
        const baselineSlice = dailyCosts.length > DETECTION_WINDOW_DAYS
            ? dailyCosts.slice(0, -DETECTION_WINDOW_DAYS)
            : dailyCosts;
        const baseline = baselineSlice.map(d => d.amount).filter(v => v > 0);
        if (baseline.length < 7) {
            return NextResponse.json({
                success: true, dailyCosts, anomalies: [], mean: 0, stdDev: 0,
                message: "Baseline insuficiente para calcular Z-Score."
            });
        }

        const { mean, stdDev } = computeStats(baseline);
        const recentWindow = dailyCosts.slice(-DETECTION_WINDOW_DAYS);
        const anomalies = detectAnomalies(recentWindow, mean, stdDev, subscriptionId, 2.5);

        // Enviar webhook si hay anomalías nuevas
        for (const anomaly of anomalies.slice(0, 3)) {
            const dashboardUrl = `${request.nextUrl.origin}/intelligence/anomalies`;
            await sendWebhookAlert(tenantId,
                "🚨 Anomalía de Gasto Detectada",
                `Gasto anormal de **$${anomaly.amount.toFixed(2)}** el ${anomaly.date} (sub: *${subscriptionId}*). Promedio esperado: $${mean.toFixed(2)} | Z-Score: ${anomaly.z_score.toFixed(2)}.\n\n<a href="${dashboardUrl}">🔍 Investigar</a>`,
                'warning'
            ).catch(() => {});
        }

        // Write-through de historial diario (best-effort, solo tenants reales con datos).
        recordDailySnapshotAsync(tenantId, 'anomalies', {
            anomaliesCount: anomalies.length,
            mean: Number(mean.toFixed(2)),
            stdDev: Number(stdDev.toFixed(2)),
        }, subscriptionId);

        return NextResponse.json({ success: true, dailyCosts, anomalies, mean, stdDev });

    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Anomaly Detection API Error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

