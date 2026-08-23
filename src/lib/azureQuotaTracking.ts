/**
 * Medición real de la cuota de APIs de Azure.
 *
 * Azure devuelve en CADA respuesta cuánto le queda al llamador antes del
 * throttling. Hasta ahora no se leía en ningún lado y el panel de Estado de
 * Cuenta mostraba un 94% fijo inventado.
 *
 * Se mide de lo que ya se llama, sin sondeos extra:
 *   - Resource Graph  → `x-ms-user-quota-remaining` / `x-ms-user-quota-resets-after`
 *   - Cost Management → `x-ms-ratelimit-remaining-microsoft.costmanagement-*`
 *   - ARM genérico    → `x-ms-ratelimit-remaining-subscription-reads`
 *
 * Los tres tienen semánticas y magnitudes distintas (ARG cuenta queries por
 * ventana de segundos; ARM, lecturas por 5 min), así que no se promedian: se
 * normaliza cada uno a % contra su techo conocido y el KPI muestra **el más
 * ajustado**, que es el que va a throttlear primero.
 *
 * Escritura amortiguada: con 130 call sites de ARG, un INSERT por respuesta
 * sería miles de filas por sync. Se guarda en memoria el MÍNIMO observado por
 * (tenant, fuente) y se vuelca a lo sumo una fila por ventana — el mínimo es lo
 * que responde "¿estuve cerca del límite?", que es la pregunta del panel.
 */
import type { PipelinePolicy } from '@azure/core-rest-pipeline';
import pool from '@/modules/storage/db';

export type QuotaSource = 'RESOURCE_GRAPH' | 'COST_MANAGEMENT' | 'ARM';

/**
 * Techos por fuente, para normalizar a porcentaje.
 *
 * ARG no publica el techo en el header (sólo el remanente), y el límite real
 * depende del tipo de query; 15 por ventana de 5 s es el valor documentado para
 * el caso general y el que usa el propio SDK para su backoff.
 * ARM: 12000 lecturas por 5 min por suscripción.
 * Cost Management no publica techo estable; se usa el máximo observado por
 * tenant como referencia móvil (ver `observedCeiling`).
 */
const KNOWN_CEILINGS: Record<QuotaSource, number | null> = {
    RESOURCE_GRAPH: 15,
    ARM: 12000,
    COST_MANAGEMENT: null,
};

/** Ventana mínima entre escrituras por (tenant, fuente). */
const FLUSH_INTERVAL_MS = 60_000;

interface PendingSample {
    remaining: number;
    ceiling: number | null;
    resetsAfterSeconds: number | null;
    observedAt: number;
    lastFlushedAt: number;
}

const pending = new Map<string, PendingSample>();
/** Techo observado por (tenant, fuente) cuando Azure no lo publica. */
const observedCeiling = new Map<string, number>();

function key(tenantId: string, source: QuotaSource): string {
    return `${tenantId}::${source}`;
}

function readHeader(headers: { get(name: string): string | undefined } | Headers, name: string): string | null {
    try {
        const value = (headers as { get(n: string): string | undefined | null }).get(name);
        return value == null ? null : String(value);
    } catch {
        return null;
    }
}

/**
 * Extrae el remanente de cuota de un juego de headers. Devuelve null si esa
 * respuesta no trae información de cuota (no todas las llamadas la incluyen).
 */
export function extractQuota(
    headers: { get(name: string): string | undefined } | Headers,
    source: QuotaSource
): { remaining: number; resetsAfterSeconds: number | null } | null {
    if (source === 'RESOURCE_GRAPH') {
        const raw = readHeader(headers, 'x-ms-user-quota-remaining');
        if (raw == null) return null;
        const remaining = Number(raw);
        if (!Number.isFinite(remaining)) return null;
        const resetRaw = readHeader(headers, 'x-ms-user-quota-resets-after');
        // Viene como HH:MM:SS.
        let resetsAfterSeconds: number | null = null;
        if (resetRaw) {
            const parts = resetRaw.split(':').map(Number);
            if (parts.length === 3 && parts.every((p) => Number.isFinite(p))) {
                resetsAfterSeconds = parts[0] * 3600 + parts[1] * 60 + Math.floor(parts[2]);
            }
        }
        return { remaining, resetsAfterSeconds };
    }

    if (source === 'ARM') {
        const raw = readHeader(headers, 'x-ms-ratelimit-remaining-subscription-reads');
        if (raw == null) return null;
        const remaining = Number(raw);
        return Number.isFinite(remaining) ? { remaining, resetsAfterSeconds: null } : null;
    }

    // Cost Management publica varios headers con sufijo variable; se toma el
    // más restrictivo de los que aparezcan.
    const candidates = [
        'x-ms-ratelimit-remaining-microsoft.costmanagement-entity-requests',
        'x-ms-ratelimit-remaining-microsoft.costmanagement-tenant-requests',
        'x-ms-ratelimit-remaining-microsoft.costmanagement-client-requests',
    ];
    let min: number | null = null;
    for (const name of candidates) {
        const raw = readHeader(headers, name);
        if (raw == null) continue;
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        min = min == null ? value : Math.min(min, value);
    }
    return min == null ? null : { remaining: min, resetsAfterSeconds: null };
}

/**
 * Registra una observación. No hace I/O en el camino caliente: acumula el
 * mínimo en memoria y vuelca como mucho una fila por ventana.
 */
export function recordQuotaObservation(
    tenantId: string,
    source: QuotaSource,
    headers: { get(name: string): string | undefined } | Headers
): void {
    if (!tenantId) return;
    const quota = extractQuota(headers, source);
    if (!quota) return;

    const k = key(tenantId, source);

    // Techo móvil para las fuentes que no lo publican: el mayor remanente que
    // vimos es, por definición, al menos el techo.
    let ceiling = KNOWN_CEILINGS[source];
    if (ceiling == null) {
        const prev = observedCeiling.get(k) ?? 0;
        const next = Math.max(prev, quota.remaining);
        observedCeiling.set(k, next);
        ceiling = next > 0 ? next : null;
    }

    const now = Date.now();
    const current = pending.get(k);

    if (!current) {
        pending.set(k, {
            remaining: quota.remaining,
            ceiling,
            resetsAfterSeconds: quota.resetsAfterSeconds,
            observedAt: now,
            lastFlushedAt: 0,
        });
    } else {
        // Nos quedamos con el peor momento de la ventana.
        if (quota.remaining < current.remaining) {
            current.remaining = quota.remaining;
            current.resetsAfterSeconds = quota.resetsAfterSeconds;
        }
        current.ceiling = ceiling;
        current.observedAt = now;
    }

    const sample = pending.get(k)!;
    if (now - sample.lastFlushedAt >= FLUSH_INTERVAL_MS) {
        sample.lastFlushedAt = now;
        const toWrite = { ...sample };
        pending.delete(k);
        // Fire-and-forget: la telemetría no puede demorar ni romper la llamada
        // de negocio que la generó.
        void persistSample(tenantId, source, toWrite).catch((err) => {
            console.warn('[azureQuotaTracking] no se pudo guardar la muestra:', err?.message ?? err);
        });
    }
}

async function persistSample(tenantId: string, source: QuotaSource, sample: PendingSample): Promise<void> {
    const percentage =
        sample.ceiling && sample.ceiling > 0
            ? Math.max(0, Math.min(100, Math.round((sample.remaining / sample.ceiling) * 100)))
            : null;

    await pool.query(
        `INSERT INTO ApiQuotaSamples (tenant_id, source, remaining, ceiling, remaining_percentage, resets_after_seconds)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, source, sample.remaining, sample.ceiling, percentage, sample.resetsAfterSeconds]
    );

    // ponytail: purga probabilística en vez de un cron dedicado. Con un flush
    // por minuto y tenant, 1/200 dispara la limpieza cada varias horas — sobra
    // para una tabla con retención de 30 días. Si el volumen crece, moverla a
    // un cron propio.
    if (Math.random() < 0.005) {
        void purgeOldQuotaSamples().catch(() => { /* la limpieza no es crítica */ });
    }
}

/**
 * Policy de pipeline para los clientes del SDK de Azure, donde los headers no
 * son accesibles de otra forma. Se engancha en `additionalPolicies`.
 */
export function quotaTrackingPolicy(tenantId: string, source: QuotaSource): PipelinePolicy {
    return {
        name: 'finopsQuotaTracking',
        async sendRequest(request, next) {
            const response = await next(request);
            try {
                recordQuotaObservation(tenantId, source, response.headers);
            } catch {
                // Nunca romper la llamada real por la telemetría.
            }
            return response;
        },
    };
}

/**
 * Engancha el policy a un cliente `@azure/arm-*` ya construido.
 *
 * Se hace sobre `client.pipeline` y no vía las opciones del constructor porque
 * el tipo de opciones difiere entre SDKs (`ResourceGraphClientOptions` no
 * acepta `additionalPolicies`), mientras que `.pipeline` es API pública común
 * de `@azure/core-client`.
 *
 * Nunca lanza: si un SDK no expusiera el pipeline, se pierde la medición pero
 * el cliente sigue siendo perfectamente usable.
 */
export function attachQuotaTracking<T>(client: T, tenantId: string, source: QuotaSource): T {
    try {
        const pipeline = (client as { pipeline?: { addPolicy(p: PipelinePolicy): void } }).pipeline;
        if (pipeline?.addPolicy) {
            pipeline.addPolicy(quotaTrackingPolicy(tenantId, source));
        }
    } catch (err) {
        console.warn('[azureQuotaTracking] no se pudo instrumentar el cliente:', (err as Error)?.message);
    }
    return client;
}

/** Para los call sites que usan `fetch()` crudo contra ARM. */
export function recordArmFetchQuota(tenantId: string, response: Response): void {
    try {
        recordQuotaObservation(tenantId, 'ARM', response.headers);
    } catch {
        /* noop */
    }
}

export interface QuotaBreakdownEntry {
    source: QuotaSource;
    remaining: number;
    ceiling: number | null;
    remainingPercentage: number | null;
    observedAt: string;
}

export interface QuotaSummary {
    /** El más ajustado de los medidos. null = todavía no hay mediciones. */
    remainingPercentage: number | null;
    tightestSource: QuotaSource | null;
    breakdown: QuotaBreakdownEntry[];
}

/**
 * Resumen de cuota para el panel: la medición más reciente de cada fuente
 * dentro de la ventana, y el mínimo entre ellas.
 *
 * Si no hay ninguna muestra devuelve null y la UI muestra "Sin medir" — nunca
 * un número inventado.
 */
export async function getQuotaSummary(tenantId: string, windowHours = 24): Promise<QuotaSummary> {
    let rows: any[] = [];
    try {
        const [result] = await pool.query<any[]>(
            `SELECT s.source, s.remaining, s.ceiling, s.remaining_percentage, s.observed_at
             FROM ApiQuotaSamples s
             INNER JOIN (
                 SELECT source, MAX(observed_at) AS latest
                 FROM ApiQuotaSamples
                 WHERE tenant_id = ? AND observed_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
                 GROUP BY source
             ) latest_per_source
                 ON latest_per_source.source = s.source
                AND latest_per_source.latest = s.observed_at
             WHERE s.tenant_id = ?`,
            [tenantId, windowHours, tenantId]
        );
        rows = result || [];
    } catch (err: any) {
        // La tabla llega con 20260822-010; sin ella simplemente no hay medición.
        if (err?.code === 'ER_NO_SUCH_TABLE') return { remainingPercentage: null, tightestSource: null, breakdown: [] };
        throw err;
    }

    const breakdown: QuotaBreakdownEntry[] = rows.map((r) => ({
        source: r.source as QuotaSource,
        remaining: Number(r.remaining),
        ceiling: r.ceiling == null ? null : Number(r.ceiling),
        remainingPercentage: r.remaining_percentage == null ? null : Number(r.remaining_percentage),
        observedAt: r.observed_at ? new Date(r.observed_at).toISOString() : '',
    }));

    const withPct = breakdown.filter((b) => b.remainingPercentage != null);
    if (withPct.length === 0) {
        return { remainingPercentage: null, tightestSource: null, breakdown };
    }

    const tightest = withPct.reduce((min, b) =>
        (b.remainingPercentage as number) < (min.remainingPercentage as number) ? b : min
    );

    return {
        remainingPercentage: tightest.remainingPercentage,
        tightestSource: tightest.source,
        breakdown,
    };
}

/** Retención: el panel mira 24 h y la tendencia, 30 días. */
export async function purgeOldQuotaSamples(retentionDays = 30): Promise<number> {
    const [result] = await pool.query<any>(
        'DELETE FROM ApiQuotaSamples WHERE observed_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
        [retentionDays]
    );
    return result?.affectedRows ?? 0;
}
