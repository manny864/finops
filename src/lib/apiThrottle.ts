import { registrarLlamadaAzure } from "@/lib/azureApiMetrics";
/**
 * Limitador global de concurrencia con pausa compartida ante 429.
 *
 * POR QUE EXISTE
 * `argConcurrency.ts` ya tenia exactamente esto para Resource Graph, y funciona:
 * en los logs de produccion del 2026-09-03, durante la media hora del barrido,
 * ARG registro 5 respuestas 429 y Cost Management 314 --con un pico de 122 en un
 * solo tramo de cinco minutos--. La diferencia no es la cuota de cada servicio,
 * es que ARG tiene cola y Cost Management no.
 *
 * `withRetry` de billingHelpers reintentaba por llamada, con backoff y todo,
 * pero sin nada global: cada llamador esperaba su propio rato y volvia a
 * disparar, asi que entre los prewarm --que corren cada 10, 15 y 20 minutos-- y
 * el barrido nocturno mantenian el throttle vivo entre todos. El sync perdia:
 * tres de cada cuatro tenants venian venciendo el techo de 6 minutos todas las
 * noches, y el 3 de septiembre no se ingirio una sola fila.
 *
 * Lo que agrega una cola global sobre un backoff por llamada: cuando UNA
 * consulta se come un 429, se frenan TODAS hasta que pase el `Retry-After`. Sin
 * eso, mientras una espera las otras siguen golpeando y renuevan la penalidad.
 *
 * El estado es POR INSTANCIA a proposito. ARG y Cost Management tienen cuotas
 * independientes; compartir el `pausedUntil` haria que un 429 de uno frenara al
 * otro sin motivo.
 */

export interface OpcionesLimitador {
    /** Prefijo de los logs, p.ej. "ARG" o "BillingService". */
    nombre: string;
    /** Consultas simultaneas. */
    maxConcurrent: number;
    /** Separacion minima entre dos arranques, para no salir en rafaga. */
    pacingMs: number;
    /** Piso del backoff cuando el servicio no manda `Retry-After`. */
    minBackoffMs: number;
    /** Techo del backoff. */
    maxBackoffMs: number;
    /** Base exponencial del backoff. */
    factor: number;
    /** Amplitud del jitter, para que N llamadores no reintenten al unisono. */
    jitterMs: number;
    /** Piso a aplicar sobre el `Retry-After` que manda el servicio. */
    minRetryAfterMs: number;
}

export interface OpcionesLlamada {
    /**
     * Tenant en cuyo nombre se hace la llamada. Sólo para la telemetría: sin
     * esto el consumo queda agregado por servicio y no se puede ver qué cliente
     * gasta la cuota de API de todos.
     */
    tenantId?: string;
    maxRetries?: number;
    label?: string;
    signal?: AbortSignal;
    /** Pisa `minBackoffMs` solo para esta llamada. */
    minBackoffMs?: number;
}

export interface Limitador {
    <T>(fn: () => Promise<T>, opts?: OpcionesLlamada): Promise<T>;
}

/**
 * Reloj MONOTONICO, no `Date.now()`.
 *
 * Todo lo que mide esta cola es tiempo transcurrido --cuanto falta para la
 * proxima largada, hasta cuando dura la pausa-- y para eso el reloj de pared es
 * el equivocado: lo mueven los ajustes de NTP y los cambios de hora. Un salto
 * hacia atras dejaria `pausadoHasta` en el futuro y la cola frenada hasta que el
 * reloj lo alcance.
 *
 * Lo destapo un test que congela `Date` pero no `setTimeout`
 * (`billingServiceScope.test.ts`): con el reloj quieto, la resta daba 0 para
 * siempre y `siguiente()` se reprogramaba en un bucle infinito. El monotonico
 * avanza igual.
 */
const ahoraMs = () => performance.now();

/** Espera abortable: sin esto, un deadline vencido igual paga el backoff entero. */
function dormir(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
        const t = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(t);
            reject(signal?.reason ?? new Error("Aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export function crearLimitadorGlobal(
    cfg: OpcionesLimitador,
    es429: (err: unknown) => boolean,
    retryAfterMs: (err: unknown) => number | null,
): Limitador {
    let activos = 0;
    let pausadoHasta = 0;
    let ultimoArranque = 0;
    const cola: Array<() => void> = [];

    function siguiente() {
        if (activos >= cfg.maxConcurrent) return;
        const ahora = ahoraMs();
        if (ahora < pausadoHasta) {
            setTimeout(siguiente, Math.max(50, pausadoHasta - ahora));
            return;
        }
        const desdeElUltimo = ahora - ultimoArranque;
        if (desdeElUltimo < cfg.pacingMs) {
            setTimeout(siguiente, cfg.pacingMs - desdeElUltimo);
            return;
        }
        const correr = cola.shift();
        if (!correr) return;
        activos++;
        ultimoArranque = ahoraMs();
        correr();
    }

    return async function conLimite<T>(
        fn: () => Promise<T>,
        opts: OpcionesLlamada = {},
    ): Promise<T> {
        const maxRetries = opts.maxRetries ?? 4;
        const minBackoff = opts.minBackoffMs ?? cfg.minBackoffMs;
        let intento = 0;
        let esperaPendiente = 0;

        /**
         * Fija la pausa global. Se llama al DETECTAR el 429, no al manejarlo.
         *
         * Si esperara al `catch`, el orden seria: rechaza -> `siguiente()`
         * arranca la proxima de la cola -> recien ahi se pausa. O sea que por
         * cada 429 se cuela una consulta mas, justo cuando el servicio esta
         * pidiendo que paremos. Con concurrencia 2 y la cola llena, eso es
         * exactamente el goteo que mantiene vivo el throttle.
         */
        const pausarCola = (err: unknown) => {
            const delServicio = retryAfterMs(err);
            const jitter = Math.floor(Math.random() * cfg.jitterMs);
            esperaPendiente = delServicio
                ? Math.max(delServicio, cfg.minRetryAfterMs) + jitter
                : Math.min(cfg.maxBackoffMs, minBackoff * Math.pow(cfg.factor, intento) + jitter);
            pausadoHasta = Math.max(pausadoHasta, ahoraMs() + esperaPendiente);
        };

        // Telemetría: cuántas llamadas hacemos y cuántas nos frenan. El
        // denominador es lo que faltaba para decidir cadencias con datos en vez
        // de a ojo -- contar 429 sin saber sobre cuántas llamadas no distingue
        // "hacemos demasiadas" de "Azure cerró la ventana".
        const arranque = ahoraMs();
        let esperaAcumulada = 0;

        while (true) {
            if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("Aborted");
            try {
                return await new Promise<T>((resolve, reject) => {
                    const soltarTurno = (error: unknown) => {
                        if (es429(error)) pausarCola(error);
                        activos--;
                        siguiente();
                        reject(error);
                    };
                    const correr = () => {
                        // `Promise.resolve(fn())` y no `fn().then(...)`: si `fn`
                        // lanza SINCRONICAMENTE --antes de devolver la promesa--
                        // el `.then` no llega a existir, nadie decrementa
                        // `activos` y el turno queda tomado para siempre. A los
                        // `maxConcurrent` errores asi, la cola se traba entera y
                        // el proceso no vuelve a consultar costos hasta que lo
                        // reinicien.
                        try {
                            Promise.resolve(fn()).then(
                                (valor) => {
                                    activos--;
                                    siguiente();
                                    registrarLlamadaAzure(cfg.nombre, opts.label, "ok", esperaAcumulada, opts.tenantId);
                                    resolve(valor);
                                },
                                soltarTurno,
                            );
                        } catch (error) {
                            soltarTurno(error);
                        }
                    };
                    cola.push(correr);
                    siguiente();
                });
            } catch (err) {
                if (!es429(err) || intento >= maxRetries) {
                    registrarLlamadaAzure(cfg.nombre, opts.label, es429(err) ? "throttle" : "error", ahoraMs() - arranque, opts.tenantId);
                    throw err;
                }
                // La cola ya quedo frenada en `pausarCola`; aca solo se espera.
                const backoff = esperaPendiente;
                console.warn(
                    `[${cfg.nombre}] 429 on ${opts.label || "azure call"}. Pausing global queue & retrying ${intento + 1}/${maxRetries} in ${backoff}ms`,
                );
                esperaAcumulada += backoff;
                await dormir(backoff, opts.signal);
                intento++;
            }
        }
    };
}
