/**
 * AWS Cost Explorer thin wrapper.
 *
 * Returns daily cost rows grouped by service + region, ready to be mapped to
 * FOCUS via mapCeDailyToFocus(). Used as the "lightweight" sync path. For
 * higher-fidelity per-resource billing, use the CUR S3 ingestion path
 * (lib/aws/cur.ts).
 *
 * COSTO: Cost Explorer cobra USD 0.01 por request, y cada pagina de la
 * paginacion es un request aparte. Un tenant con varias cuentas y un dashboard
 * que refresca solo puede generar una factura de CE mayor que el ahorro que la
 * herramienta le encuentra. Por eso este modulo:
 *   - Pide granularidad DAILY en una sola llamada (cubre hasta un anio).
 *   - Agrupa en una unica pasada de dimensiones; la UI reagrega localmente.
 *   - Cachea el resultado en Redis por cuenta y rango (ver getCostAndUsage).
 *   - Reintenta con backoff exponencial ante throttling, en vez de propagar el
 *     error y hacer que el usuario reintente a mano (lo que vuelve a cobrar).
 */

import { CostExplorerClient, GetCostAndUsageCommand, type GroupDefinition } from '@aws-sdk/client-cost-explorer';
import type { AwsTempCredentials } from './sts';
import { redis } from '@/lib/redis';

/** Version del formato cacheado. Subirla invalida las entradas viejas. */
const CACHE_VERSION = 'v1';

/**
 * TTL segun si el rango ya cerro. Los dias pasados no cambian salvo ajustes de
 * facturacion; el dia en curso se actualiza varias veces al dia.
 */
const CLOSED_RANGE_TTL_SECONDS = 24 * 60 * 60;
const OPEN_RANGE_TTL_SECONDS = 60 * 60;

/** Errores de AWS que justifican reintentar: throttling y fallos transitorios. */
const RETRYABLE_ERROR_NAMES = new Set([
    'ThrottlingException',
    'TooManyRequestsException',
    'RequestLimitExceeded',
    'ServiceUnavailable',
    'InternalServerError',
    'RequestTimeout',
]);

const MAX_ATTEMPTS = 4;

/**
 * Error de permisos con remediacion accionable. Sin esto, el usuario recibe
 * "AccessDeniedException" crudo y no tiene forma de saber que le falta
 * `ce:GetCostAndUsage` en el rol que creo durante el onboarding.
 */
export class AwsCostExplorerAccessError extends Error {
    readonly actionable = true;
    constructor(originalMessage: string) {
        super(
            'El rol de AWS no tiene permiso para leer Cost Explorer. ' +
            'Agrega la accion "ce:GetCostAndUsage" a la politica del rol ' +
            '(la plantilla de onboarding ya la incluye) y volve a probar la conexion. ' +
            `Detalle de AWS: ${originalMessage}`
        );
        this.name = 'AwsCostExplorerAccessError';
    }
}

function errorName(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
        const e = error as { name?: string; Code?: string; __type?: string };
        return e.name || e.Code || e.__type || '';
    }
    return '';
}

function isRetryable(error: unknown): boolean {
    const name = errorName(error);
    if (RETRYABLE_ERROR_NAMES.has(name)) return true;
    // Algunos SDK exponen el codigo HTTP en vez del nombre.
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    return status === 429 || (typeof status === 'number' && status >= 500);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backoff exponencial con jitter. El jitter evita que varias cuentas del mismo
 * tenant, que se sincronizan juntas, reintenten todas en el mismo instante y
 * se vuelvan a throttlear entre si.
 */
async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (errorName(error) === 'AccessDeniedException') {
                throw new AwsCostExplorerAccessError(
                    error instanceof Error ? error.message : String(error)
                );
            }
            if (!isRetryable(error) || attempt === MAX_ATTEMPTS) throw error;
            const backoffMs = Math.min(2 ** attempt * 250, 4000);
            await sleep(backoffMs + Math.floor(Math.random() * 250));
        }
    }
    throw lastError;
}

function cacheKey(accountId: string, start: string, end: string): string {
    return `aws:ce:${CACHE_VERSION}:${accountId}:${start}:${end}`;
}

/** Un rango esta cerrado si termina hoy o antes (`end` es exclusivo en AWS). */
function isClosedRange(end: string, now: Date): boolean {
    return end <= now.toISOString().slice(0, 10);
}

export interface CeDailyRow {
  date: string;                  // YYYY-MM-DD
  serviceCode: string;           // e.g. "AmazonEC2"
  region: string;                // e.g. "us-east-1" or "NoRegion"
  unblendedCost: number;         // USD
  amortizedCost: number;         // USD (RIs / Savings Plans amortized)
  usageQuantity: number;
}

/** Opciones de caché. Sin `accountId` no se cachea: la clave sería ambigua. */
export interface GetCostAndUsageOptions {
  /** Cuenta AWS (12 dígitos). Habilita el cacheo por cuenta y rango. */
  accountId?: string;
  /** Fuerza ir a AWS aunque haya entrada en caché (botón "refrescar"). */
  bypassCache?: boolean;
}

/**
 * Pulls daily costs grouped by SERVICE + REGION between [start, end).
 * Dates are ISO YYYY-MM-DD. end is exclusive per AWS convention.
 *
 * Cachea en Redis cuando se informa `accountId`. La caché es lo que separa un
 * costo de CE acotado de uno que crece con cada refresh de la UI.
 */
export async function getCostAndUsage(
  creds: AwsTempCredentials,
  start: string,
  end: string,
  options: GetCostAndUsageOptions = {}
): Promise<CeDailyRow[]> {
  const { accountId, bypassCache } = options;
  const key = accountId ? cacheKey(accountId, start, end) : null;

  if (key && !bypassCache) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Se valida la forma: una entrada corrupta o de un formato viejo debe
        // provocar una lectura fresca, no romper el sync.
        if (Array.isArray(parsed)) return parsed as CeDailyRow[];
      }
    } catch {
      // Redis caído no puede impedir leer costos: se sigue contra AWS.
    }
  }

  // Cost Explorer is global (us-east-1).
  const client = new CostExplorerClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
  });

  const groupBy: GroupDefinition[] = [
    { Type: 'DIMENSION', Key: 'SERVICE' },
    { Type: 'DIMENSION', Key: 'REGION' },
  ];

  const rows: CeDailyRow[] = [];
  let nextToken: string | undefined;
  do {
    const out = await withRetry(() =>
      client.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: start, End: end },
          Granularity: 'DAILY',
          Metrics: ['UnblendedCost', 'AmortizedCost', 'UsageQuantity'],
          GroupBy: groupBy,
          NextPageToken: nextToken,
        })
      )
    );

    for (const period of out.ResultsByTime || []) {
      const date = period.TimePeriod?.Start || '';
      for (const g of period.Groups || []) {
        const [serviceCode = 'Unknown', region = 'NoRegion'] = g.Keys || [];
        rows.push({
          date,
          serviceCode,
          region,
          unblendedCost: parseFloat(g.Metrics?.UnblendedCost?.Amount || '0'),
          amortizedCost: parseFloat(g.Metrics?.AmortizedCost?.Amount || '0'),
          usageQuantity: parseFloat(g.Metrics?.UsageQuantity?.Amount || '0'),
        });
      }
    }

    nextToken = out.NextPageToken;
  } while (nextToken);

  if (key) {
    try {
      const ttl = isClosedRange(end, new Date())
        ? CLOSED_RANGE_TTL_SECONDS
        : OPEN_RANGE_TTL_SECONDS;
      await redis.set(key, JSON.stringify(rows), 'EX', ttl);
    } catch {
      // No poder cachear no invalida el resultado ya obtenido.
    }
  }

  return rows;
}

/**
 * Invalida la caché de una cuenta. Se llama al borrar o reconfigurar la cuenta:
 * si cambia el bucket del CUR o el rol, lo cacheado dejó de ser representativo.
 */
export async function invalidateCostExplorerCache(accountId: string): Promise<number> {
  try {
    // SCAN en vez de KEYS: KEYS bloquea el servidor Redis entero mientras
    // recorre el keyspace, y este código corre en el request path.
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, batch] = await redis.scan(
        cursor, 'MATCH', `aws:ce:${CACHE_VERSION}:${accountId}:*`, 'COUNT', 100
      );
      cursor = next;
      if (batch.length > 0) deleted += await redis.del(...batch);
    } while (cursor !== '0');
    return deleted;
  } catch {
    return 0;
  }
}
