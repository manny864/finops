/**
 * anomalyDetectionService — motor de detección de anomalías de gasto
 * (Z-Score sobre CostSnapshots) + persistencia + notificación con dedup.
 *
 * Antes esta lógica vivía duplicada e inline en
 * /api/intelligence/anomalies (on-demand: solo corría cuando alguien abría
 * la página) y nunca escribía en la tabla `Anomalies` — el resultado se
 * devolvía en el JSON y se descartaba. Ahora:
 *  - /api/intelligence/anomalies (on-demand) sigue funcionando igual para
 *    el dashboard, pero reusa este servicio.
 *  - /api/cron/anomaly-detection (nuevo, corre cada ≥5 min) evalúa todos
 *    los tenants Professional+ SIN esperar a que nadie abra la página,
 *    persiste en `Anomalies` y dispara el webhook/notificación una sola
 *    vez por anomalía (columna `notified_at`, evita spam en cada corrida).
 */
import pool from "@/modules/storage/db";
import { redis } from "@/lib/redis";
import { sendWebhookAlert } from "@/lib/notifications";
import { createNotification } from "@/lib/notify";
import { recordDailySnapshotAsync } from "@/services/snapshotService";
import { getHistoricalDailyCosts, AZURE_COST_HISTORY_MAX_MONTHS } from "@/modules/collectors/azure/billingService";

// Ventana de detección "reciente": los últimos N días se evalúan contra la
// línea base (todo lo anterior, hasta AZURE_COST_HISTORY_MAX_MONTHS de
// historial).
export const DETECTION_WINDOW_DAYS = 30;
const Z_SCORE_THRESHOLD = 2.5;

export interface DailyCost {
    date: string;
    amount: number;
}

export interface DetectedAnomaly {
    date: string;
    amount: number;
    expected_amount: number;
    z_score: number;
    subscription_id: string;
}

export interface AnomalyContributor {
    resource_group: string;
    service_name: string;
    /** Costo real de este grupo en el día de la anomalía. */
    cost: number;
    /** Promedio diario de este mismo grupo en la ventana previa (baseline). */
    baseline_avg: number;
    /** cost - baseline_avg. Solo se incluyen contribuyentes con delta > 0. */
    delta: number;
    /** % del delta TOTAL del día (suma de todos los deltas positivos) que explica este grupo. */
    delta_pct_of_total: number;
}

export function computeStats(values: number[]): { mean: number; stdDev: number } {
    if (values.length === 0) return { mean: 0, stdDev: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
    return { mean, stdDev: Math.sqrt(variance) };
}

export function detectAnomalies(
    dailyCosts: DailyCost[],
    mean: number,
    stdDev: number,
    subscriptionId: string,
    threshold = Z_SCORE_THRESHOLD
): DetectedAnomaly[] {
    if (stdDev === 0) return [];
    return dailyCosts
        .filter(d => (d.amount - mean) / stdDev > threshold)
        .map(d => ({
            date: d.date,
            amount: d.amount,
            expected_amount: mean,
            z_score: (d.amount - mean) / stdDev,
            subscription_id: subscriptionId,
        }));
}

const CONTRIBUTORS_BASELINE_DAYS = 30;
const CONTRIBUTORS_LIMIT = 5;

/**
 * Atribución de causa raíz de una anomalía ya detectada: compara, por
 * resource_group + service_name, el gasto del día de la anomalía contra el
 * promedio diario de ese mismo grupo en los `baselineDays` previos (misma
 * fuente que la detección: CostSnapshots). Devuelve los grupos que más
 * explican el delta (cost - baseline_avg), ordenados de mayor a menor, con
 * el % del delta total del día que representa cada uno.
 *
 * Grupos sin gasto en el día de la anomalía pero con baseline > 0 (algo que
 * bajó, no que subió) no aportan al pico y se excluyen — solo interesan los
 * que EMPUJARON el gasto hacia arriba.
 */
export async function getAnomalyTopContributors(
    tenantId: string,
    subscriptionId: string,
    date: string,
    baselineDays = CONTRIBUTORS_BASELINE_DAYS,
    limit = CONTRIBUTORS_LIMIT
): Promise<AnomalyContributor[]> {
    const isAll = !subscriptionId || subscriptionId.toLowerCase() === "all";
    const subFilter = isAll ? "" : `AND LOWER(subscription_id) IN (${subscriptionId.split(",").map(() => "?").join(",")})`;
    const subParams: string[] = isAll ? [] : subscriptionId.split(",").map(s => s.trim().toLowerCase());

    try {
        const [dayRows]: any = await pool.query(
            `SELECT resource_group, service_name, SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS cost
             FROM CostSnapshots
             WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) = ? ${subFilter}
             GROUP BY resource_group, service_name`,
            [tenantId, date, ...subParams]
        );

        const [baseRows]: any = await pool.query(
            `SELECT resource_group, service_name,
                    SUM(COALESCE(EffectiveCost, cost_usd, 0)) / GREATEST(COUNT(DISTINCT DATE(COALESCE(ChargePeriodStart, date))), 1) AS avg_cost
             FROM CostSnapshots
             WHERE tenant_id = ?
               AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(?, INTERVAL ? DAY)
               AND DATE(COALESCE(ChargePeriodStart, date)) < ?
               ${subFilter}
             GROUP BY resource_group, service_name`,
            [tenantId, date, baselineDays, date, ...subParams]
        );

        const baseMap = new Map<string, number>();
        (baseRows || []).forEach((r: any) => {
            baseMap.set(`${r.resource_group}::${r.service_name}`, Number(r.avg_cost) || 0);
        });

        const withDelta = (dayRows || [])
            .map((r: any) => {
                const key = `${r.resource_group}::${r.service_name}`;
                const cost = Number(r.cost) || 0;
                const baseline_avg = baseMap.get(key) || 0;
                return { resource_group: r.resource_group, service_name: r.service_name, cost, baseline_avg, delta: cost - baseline_avg };
            })
            .filter((c: any) => c.delta > 0);

        const totalDelta = withDelta.reduce((sum: number, c: any) => sum + c.delta, 0);

        return withDelta
            .sort((a: any, b: any) => b.delta - a.delta)
            .slice(0, limit)
            .map((c: any) => ({
                resource_group: c.resource_group,
                service_name: c.service_name,
                cost: Number(c.cost.toFixed(2)),
                baseline_avg: Number(c.baseline_avg.toFixed(2)),
                delta: Number(c.delta.toFixed(2)),
                delta_pct_of_total: totalDelta > 0 ? Number(((c.delta / totalDelta) * 100).toFixed(1)) : 0,
            }));
    } catch (e: any) {
        console.warn(`[anomalyDetectionService] getAnomalyTopContributors failed for ${tenantId} ${date}:`, e?.message);
        return [];
    }
}

/**
 * Costos diarios cacheados en Redis (6h TTL, o 10min si el backfill de
 * Azure falló) con fallback/backfill a Azure Cost Management cuando
 * CostSnapshots no cubre toda la ventana histórica requerida. Mismo cache
 * key que usaba /api/intelligence/anomalies — el cron y el on-demand
 * comparten el mismo cache, así que correr el cron cada 5 min NO multiplica
 * las llamadas a Azure (siguen limitadas a ~1 cada 6h por tenant).
 */
export async function getDailyCostsForTenant(tenantId: string, subscriptionId = "All"): Promise<DailyCost[]> {
    const subFilter = subscriptionId && subscriptionId !== "All"
        ? `AND LOWER(subscription_id) IN (${subscriptionId.split(",").map(() => "?").join(",")})`
        : "";
    const subParams: string[] = subscriptionId !== "All"
        ? subscriptionId.split(",").map(s => s.trim().toLowerCase())
        : [];

    const cacheKey = `anomalies:dailyCosts:v1:${tenantId}:${subscriptionId.toLowerCase()}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
    } catch (e: any) {
        console.warn("[anomalyDetectionService] Redis read failed:", e?.message);
    }

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
            ? r.day_date.toISOString().split("T")[0]
            : String(r.day_date).split("T")[0];
        costMap.set(d, Number(r.daily_total) || 0);
    });

    const requiredFrom = new Date();
    requiredFrom.setMonth(requiredFrom.getMonth() - AZURE_COST_HISTORY_MAX_MONTHS);
    const sortedDates = Array.from(costMap.keys()).sort();
    const needsBackfill = sortedDates.length === 0 || new Date(sortedDates[0]) > requiredFrom;
    let backfillOk = true;
    if (needsBackfill) {
        try {
            const historical = await getHistoricalDailyCosts(tenantId, subscriptionId, AZURE_COST_HISTORY_MAX_MONTHS);
            for (const { date, cost } of historical) costMap.set(date, cost);
            backfillOk = historical.length > 0;
        } catch (e: any) {
            console.warn("[anomalyDetectionService] historical Azure backfill failed:", e?.message);
            backfillOk = false;
        }
    }

    const allDates = Array.from(costMap.keys()).sort();
    let dailyCosts: DailyCost[];
    if (allDates.length === 0) {
        dailyCosts = [];
    } else {
        const start = new Date(allDates[0]);
        const end = new Date();
        const built: DailyCost[] = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const ds = d.toISOString().split("T")[0];
            built.push({ date: ds, amount: costMap.get(ds) ?? 0 });
        }
        dailyCosts = built;
    }

    const ttl = backfillOk ? 6 * 3600 : 600;
    redis.set(cacheKey, JSON.stringify(dailyCosts), "EX", ttl)
        .catch((e: any) => console.warn("[anomalyDetectionService] Redis write failed:", e?.message));

    return dailyCosts;
}

export interface AnomalyDetectionResult {
    dailyCosts: DailyCost[];
    anomalies: DetectedAnomaly[];
    mean: number;
    stdDev: number;
    message?: string;
}

/** Corre la detección completa (costos + baseline + Z-Score) para un tenant real. */
export async function runAnomalyDetection(tenantId: string, subscriptionId = "All"): Promise<AnomalyDetectionResult> {
    const dailyCosts = await getDailyCostsForTenant(tenantId, subscriptionId);

    if (dailyCosts.length < 7) {
        return { dailyCosts: [], anomalies: [], mean: 0, stdDev: 0, message: `Historial insuficiente (${dailyCosts.length} días).` };
    }

    const baselineSlice = dailyCosts.length > DETECTION_WINDOW_DAYS
        ? dailyCosts.slice(0, -DETECTION_WINDOW_DAYS)
        : dailyCosts;
    const baseline = baselineSlice.map(d => d.amount).filter(v => v > 0);
    if (baseline.length < 7) {
        return { dailyCosts, anomalies: [], mean: 0, stdDev: 0, message: "Baseline insuficiente para calcular Z-Score." };
    }

    const { mean, stdDev } = computeStats(baseline);
    const recentWindow = dailyCosts.slice(-DETECTION_WINDOW_DAYS);
    const anomalies = detectAnomalies(recentWindow, mean, stdDev, subscriptionId);

    recordDailySnapshotAsync(tenantId, "anomalies", {
        anomaliesCount: anomalies.length,
        mean: Number(mean.toFixed(2)),
        stdDev: Number(stdDev.toFixed(2)),
    }, subscriptionId);

    return { dailyCosts, anomalies, mean, stdDev };
}

export interface AnomalyWithContributors extends DetectedAnomaly {
    top_contributors: AnomalyContributor[];
}

/**
 * Persiste cada anomalía (upsert idempotente por tenant+sub+fecha) junto con
 * su atribución de causa raíz (top_contributors — ver getAnomalyTopContributors)
 * y notifica SOLO la primera vez que se detecta (notified_at IS NULL) — así
 * correr esto cada 5 min mientras la anomalía siga dentro de la ventana de
 * 30 días no reenvía el mismo aviso una y otra vez. Devuelve las anomalías
 * enriquecidas con sus contribuyentes para que el caller (endpoint on-demand)
 * no tenga que volver a calcularlos.
 */
export async function persistAndNotifyAnomalies(
    tenantId: string,
    anomalies: DetectedAnomaly[],
    dashboardUrl: string
): Promise<{ persisted: number; notified: number; anomalies: AnomalyWithContributors[] }> {
    let notified = 0;
    const enriched: AnomalyWithContributors[] = [];

    for (const a of anomalies) {
        const topContributors = await getAnomalyTopContributors(tenantId, a.subscription_id, a.date);
        enriched.push({ ...a, top_contributors: topContributors });

        await pool.query(
            `INSERT INTO Anomalies (tenant_id, subscription_id, date, amount, expected_amount, z_score, top_contributors, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'New')
             ON DUPLICATE KEY UPDATE amount = VALUES(amount), expected_amount = VALUES(expected_amount), z_score = VALUES(z_score), top_contributors = VALUES(top_contributors)`,
            [tenantId, a.subscription_id, a.date, a.amount, a.expected_amount, a.z_score, JSON.stringify(topContributors)]
        );

        const [rows]: any = await pool.query(
            `SELECT id, notified_at FROM Anomalies WHERE tenant_id = ? AND subscription_id = ? AND date = ? LIMIT 1`,
            [tenantId, a.subscription_id, a.date]
        );
        const row = rows?.[0];
        if (!row || row.notified_at) continue;

        const topLine = topContributors.length > 0
            ? `\n\n**Principal causa:** ${topContributors[0].service_name} en *${topContributors[0].resource_group}* — ${topContributors[0].delta_pct_of_total}% del pico (+$${topContributors[0].delta.toFixed(2)} vs. su promedio habitual).`
            : "";
        const message = `Gasto anormal de **$${a.amount.toFixed(2)}** el ${a.date} (sub: *${a.subscription_id}*). Promedio esperado: $${a.expected_amount.toFixed(2)} | Z-Score: ${a.z_score.toFixed(2)}.${topLine}\n\n<a href="${dashboardUrl}">🔍 Investigar</a>`;
        try {
            await sendWebhookAlert(tenantId, "🚨 Anomalía de Gasto Detectada", message, "warning");
            await createNotification({
                tenantId,
                title: `🚨 Anomalía de gasto — $${a.amount.toFixed(2)} el ${a.date}`,
                message,
                href: "/intelligence/anomalies",
                severity: "warning",
                source: "anomaly_detection",
            });
            await pool.query(`UPDATE Anomalies SET notified_at = NOW() WHERE id = ?`, [row.id]);
            notified++;
        } catch (e: any) {
            console.warn(`[anomalyDetectionService] notify failed for tenant ${tenantId} anomaly ${row.id}:`, e?.message);
        }
    }
    return { persisted: anomalies.length, notified, anomalies: enriched };
}
