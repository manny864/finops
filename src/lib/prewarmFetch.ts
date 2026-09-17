/**
 * `fetch` con techo de tiempo para los self-fetch de los prewarm.
 *
 * POR QUÉ EXISTE
 * Los diez crons de prewarm se llaman a sí mismos por HTTP
 * (`fetch(`${getInternalBaseUrl()}/api/...`)`) y ninguno pasaba `signal`. Sin
 * `signal`, el techo es el default de undici: **300 s de headers timeout**. No
 * está configurado en ningún lado del repo —se verificó que no hay
 * `setGlobalDispatcher`, `headersTimeout` ni `bodyTimeout`—, es simplemente el
 * valor por omisión.
 *
 * Eso es lo que se ve en los logs de producción del 2026-09-16:
 *
 *   [prewarm-databases] [ERR] tenant=81ebe027 ep=sql-metrics (300495ms): fetch failed
 *   [cron-prewarm] tenant=99d6b2c5 threw: fetch failed (UND_ERR_HEADERS_TIMEOUT)
 *
 * 300.495 ms = los 300 s del default, más el redondeo. Media hora de reloj
 * repartida entre unos pocos tenants, con el agravante de que el trabajo corre
 * DENTRO del pool de réplicas que atiende a los usuarios: cada self-fetch
 * colgado mantiene ocupado un turno del limitador de Cost Management
 * (`COST_MAX_CONCURRENT=2`, con 1 slot reservado para lo interactivo) mientras
 * espera algo que ya no va a llegar.
 *
 * 90 s y no 300: una consulta de costos que no respondió en minuto y medio ya
 * está en el pozo del throttling, y seguir esperándola sólo retiene el turno.
 * Abortar libera el slot para el siguiente tenant —o para el usuario que está
 * mirando la pantalla— y el próximo tick del schedule reintenta solo.
 */
export const PREWARM_FETCH_TIMEOUT_MS = Number(
    process.env.PREWARM_FETCH_TIMEOUT_MS || 90_000,
);

/**
 * `fetch` idéntico al nativo salvo por el `signal` de timeout, que se agrega
 * sólo si el llamador no trajo el suyo.
 *
 * Al vencer, undici lanza un `TimeoutError`; los prewarm ya envuelven cada
 * llamada en su propio `try/catch` por tenant, así que el barrido sigue con el
 * siguiente en vez de cortarse.
 */
export function prewarmFetch(
    url: string,
    init: RequestInit = {},
    timeoutMs: number = PREWARM_FETCH_TIMEOUT_MS,
): Promise<Response> {
    return fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
}
