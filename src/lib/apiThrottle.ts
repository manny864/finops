import { registrarLlamadaAzure } from "@/lib/azureApiMetrics";
import { prioridadActual, type Prioridad } from "@/lib/prioridadDeLlamada";
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
    /**
     * Slots de `maxConcurrent` que el trabajo de fondo NO puede ocupar.
     *
     * La fila de prioridad sola no alcanza: con `maxConcurrent: 2`, si dos
     * consultas de un prewarm ya estan corriendo --y bajo throttling cada una
     * se puede quedar decenas de segundos-- la consulta interactiva que llega
     * despues espera a que se libere un turno igual, por mas que sea la
     * primera de la fila.
     *
     * Con 1 reservado, el fondo se serializa y siempre queda un turno para
     * quien esta mirando la pantalla. Que el prewarm vaya mas lento es el
     * objetivo, no un efecto colateral: es justamente lo que estaba generando
     * los 429.
     */
    reservaInteractiva?: number;
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
    /**
     * Pisa la prioridad que viene del `AsyncLocalStorage` de la request. Casi
     * nunca hace falta: lo normal es que la marque `requireTenantAccess`.
     */
    prioridad?: Prioridad;
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

/**
 * PAUSA COMPARTIDA ENTRE REPLICAS
 *
 * El problema que resuelve: todo el estado de esta cola --`activos`,
 * `pausadoHasta`, las dos filas-- vive en variables del modulo, o sea en el
 * PROCESO. Y `web_max_replicas = 5`.
 *
 * Con cinco replicas eso significa cinco colas independientes, cada una
 * creyendo que es la unica:
 *
 *   - La concurrencia real contra Cost Management no es `maxConcurrent` (2),
 *     es 5 x 2 = 10.
 *   - Peor: cuando la replica A se come un 429 y frena su cola, las otras
 *     cuatro NO se enteran y siguen golpeando --que es exactamente el modo de
 *     falla que el comentario de arriba dice que esta cola vino a evitar
 *     ("mientras una espera las otras siguen golpeando y renuevan la
 *     penalidad"). Lo resolvia, pero solo dentro de un proceso.
 *
 * La solucion es publicar el `Retry-After` en Redis --que ya esta conectado y
 * es compartido-- para que las cinco replicas frenen juntas.
 *
 * DOS RELOJES. Adentro del proceso todo se mide con `performance.now()`
 * (monotonico, ver el comentario de `ahoraMs`), pero ese reloj arranca en un
 * punto distinto en cada proceso, asi que no se puede compartir. En Redis va el
 * epoch de pared (`Date.now()`), y al leerlo se convierte de vuelta a
 * monotonico calculando lo que FALTA: `restante = epochRemoto - Date.now()`.
 * Asi el valor viaja entre procesos sin depender de que sus relojes monotonicos
 * coincidan, y el reloj de pared solo se usa para una resta de duracion corta,
 * donde un ajuste de NTP es despreciable.
 *
 * BEST-EFFORT SIEMPRE. Si Redis no esta, cada replica se comporta como antes
 * --cola local, que ya funcionaba-- en vez de romperse. La pausa compartida es
 * una mejora, no una dependencia.
 */
const PAUSA_REMOTA_REFRESCO_MS = 1000;

/**
 * Import perezoso de ioredis.
 *
 * `@/lib/redis` abre la conexion al importarse. Esta cola la usan tanto Cost
 * Management como Resource Graph, y se importa desde muchos lados; un import
 * estatico obligaria a abrir un socket incluso donde no hace falta. Con el
 * import adentro de la funcion, quien no llega a pausarse nunca lo carga.
 */
async function clienteRedis(): Promise<typeof import("@/lib/redis").redis | null> {
    try {
        const { redis } = await import("@/lib/redis");
        // `enableOfflineQueue: false` hace que los comandos fallen en vez de
        // encolarse cuando la conexion no esta lista, asi que se chequea antes.
        if (redis?.status !== "ready" && redis?.status !== "connect") return null;
        return redis;
    } catch {
        return null;
    }
}

export function crearLimitadorGlobal(
    cfg: OpcionesLimitador,
    es429: (err: unknown) => boolean,
    retryAfterMs: (err: unknown) => number | null,
): Limitador {
    let activos = 0;
    let pausadoHasta = 0;
    let ultimoArranque = 0;
    // Dos filas y no una con orden: lo interactivo se atiende entero antes que
    // el fondo, y dentro de cada una se respeta el orden de llegada.
    const colaAlta: Array<() => void> = [];
    const colaBaja: Array<() => void> = [];
    const reserva = Math.max(0, Math.min(cfg.reservaInteractiva ?? 0, cfg.maxConcurrent - 1));

    // La clave lleva el nombre del limitador a proposito: ARG y Cost Management
    // tienen cuotas independientes y compartir la pausa haria que un 429 de uno
    // frenara al otro sin motivo (misma razon por la que el estado local es por
    // instancia de limitador).
    const clavePausa = `throttle:${cfg.nombre}:pausedUntil`;
    let ultimaLecturaRemota = 0;

    /** Aplica una pausa expresada en epoch de pared al reloj monotonico local. */
    function aplicarPausaRemota(epochRemoto: number) {
        const restante = epochRemoto - Date.now();
        if (restante <= 0) return;
        pausadoHasta = Math.max(pausadoHasta, ahoraMs() + restante);
    }

    /** Avisa a las otras replicas. Best-effort: un fallo no afecta la llamada. */
    async function publicarPausa(esperaMs: number) {
        const redis = await clienteRedis();
        if (!redis) return;
        try {
            const hasta = Date.now() + esperaMs;
            const actual = await redis.get(clavePausa);
            // Nunca acortar una pausa que otra replica ya extendio mas lejos.
            if (actual && Number(actual) >= hasta) return;
            // El PX deja que la clave se limpie sola al vencer la pausa: no hay
            // que borrarla, y una replica que arranca despues no hereda una
            // pausa vieja.
            await redis.set(clavePausa, String(hasta), "PX", Math.ceil(esperaMs) + 1000);
        } catch {
            // Redis caido: se sigue con la pausa local, que es lo que habia antes.
        }
    }

    /** Lee la pausa que hayan publicado las otras replicas. */
    async function leerPausaRemota() {
        // Como maximo una lectura por segundo: con `pacingMs: 250` una consulta
        // a Redis por llamada seria mas trafico que el que se quiere ahorrar, y
        // un segundo de retraso en enterarse es irrelevante frente a backoffs
        // que van de 2 a 45 segundos.
        const ahora = ahoraMs();
        if (ahora - ultimaLecturaRemota < PAUSA_REMOTA_REFRESCO_MS) return;
        ultimaLecturaRemota = ahora;
        const redis = await clienteRedis();
        if (!redis) return;
        try {
            const valor = await redis.get(clavePausa);
            if (valor) aplicarPausaRemota(Number(valor));
        } catch {
            // Ver `publicarPausa`.
        }
    }

    function siguiente() {
        if (activos >= cfg.maxConcurrent) return;
        if (colaAlta.length === 0 && colaBaja.length === 0) return;
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
        // El fondo solo arranca si no hay nadie interactivo esperando Y si deja
        // libres los turnos reservados. Cuando no puede, se sale sin
        // reprogramar: al terminar cualquier llamada activa se vuelve a llamar
        // a `siguiente()`, que es cuando el turno realmente se libera.
        let correr = colaAlta.shift();
        if (!correr) {
            if (activos >= cfg.maxConcurrent - reserva) return;
            correr = colaBaja.shift();
        }
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
        // Se resuelve UNA vez, al entrar: los reintentos tienen que volver a la
        // misma fila. Si se leyera el ALS en cada vuelta, un reintento podria
        // caer en otro contexto async y cambiar de prioridad a mitad de camino.
        const prioridad = opts.prioridad ?? prioridadActual();
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
            // Y se les avisa a las otras replicas, que tienen su propia cola en
            // su propio proceso y de otro modo seguirian golpeando durante todo
            // el backoff. No se espera el await: la pausa local ya quedo puesta
            // en la linea de arriba y lo remoto es best-effort.
            void publicarPausa(esperaPendiente);
        };

        // Telemetría: cuántas llamadas hacemos y cuántas nos frenan. El
        // denominador es lo que faltaba para decidir cadencias con datos en vez
        // de a ojo -- contar 429 sin saber sobre cuántas llamadas no distingue
        // "hacemos demasiadas" de "Azure cerró la ventana".
        const arranque = ahoraMs();
        let esperaAcumulada = 0;

        while (true) {
            if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("Aborted");
            // Ver si otra replica se comio un 429 y publico una pausa.
            //
            // SIN `await` A PROPOSITO. Esto es coordinacion best-effort, no un
            // paso del algoritmo: lo unico que hace es adelantar `pausadoHasta`,
            // que `siguiente()` vuelve a mirar en cada largada. Esperar la ida y
            // vuelta a Redis metia latencia de red en el camino critico de TODAS
            // las llamadas --incluidas las que no estan throttleadas, que son la
            // enorme mayoria-- para un dato que sirve igual si llega 50 ms
            // despues. Con `void`, la pausa remota se aplica apenas responde
            // Redis y frena la cola desde ese momento.
            void leerPausaRemota();
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
                    (prioridad === "fondo" ? colaBaja : colaAlta).push(correr);
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
