import { redis } from "@/lib/redis";
import { errorMessage } from "@/lib/apiErrors";

/**
 * Lock con latido y estado para los crons de contrato `async_poll`.
 *
 * EL AGUJERO QUE CIERRA (prod, 2026-09-13)
 * Los ocho crons asíncronos tenían la misma forma copiada: tomar un lock `NX`
 * con TTL largo (15 a 60 min), escribir `{done:false}`, lanzar el trabajo en
 * background y responder 202. El poller del job consulta `?status=1` hasta ver
 * `done:true`.
 *
 * Si el proceso moría con el trabajo adentro --y un deploy apaga la revisión
 * vieja con todo lo que esté corriendo--, nadie volvía a escribir ese estado.
 * El `{done:false}` quedaba clavado y el lock seguía vivo hasta agotar su TTL,
 * así que las ejecuciones siguientes recibían `already_running` y sus pollers
 * esperaban un `done` QUE YA NADIE IBA A ESCRIBIR, hasta agotar su presupuesto
 * completo. Con `prewarm-dashboard` --cada 10 min, poll de 29,5 min, lock de 30
 * min-- eso son exactamente tres ejecuciones fallidas seguidas después de cada
 * deploy, y la cuarta en verde cuando el lock por fin expira. Está en los logs:
 * fallas a las 19:50, 20:00 y 20:10 tras el deploy de las 19:34, y el mismo
 * trío a las 13:00, 13:10 y 13:20 tras el anterior.
 *
 * LAS DOS PIEZAS
 *
 * 1. **Latido.** El lock pasa a tener un TTL corto que el propio trabajo
 *    renueva mientras vive. Si el proceso muere, el lock expira en minutos en
 *    vez de en media hora, y el disparo siguiente arranca limpio. Un trabajo
 *    largo y sano no se ve afectado: sigue renovando.
 *
 * 2. **Huérfano.** `leerEstado` mira el lock antes de contestar: un
 *    `{done:false}` sin lock vivo no es un trabajo en curso, es uno que se
 *    murió. Devuelve `done:true, ok:false, orphan:true`, así el poller sale con
 *    una falla explicada en el primer poll en vez de colgarse media hora.
 *
 * Se reporta como falla a propósito: el barrido se interrumpió de verdad y no
 * corrió. Taparlo con un 0 sería perder la señal de que ese ciclo no se hizo.
 */

/** TTL corto por defecto. Lo renueva el latido, así que no acota al trabajo. */
export const TTL_LOCK_SEGUNDOS = Number(process.env.CRON_LOCK_TTL_SECONDS || 180);

/** Cada cuánto late. Un tercio del TTL deja margen para dos latidos perdidos. */
const INTERVALO_LATIDO_MS = Math.max(15_000, Math.floor((TTL_LOCK_SEGUNDOS * 1000) / 3));

/** El estado vive 24 h: el panel de Ops muestra la última corrida del día. */
const TTL_ESTADO_SEGUNDOS = 86400;

export interface EstadoAsync {
    startedAt: number;
    finishedAt: number | null;
    done: boolean;
    ok: boolean | null;
    error?: string;
    /** `true` cuando el trabajo se interrumpió y nadie va a terminarlo. */
    orphan?: true;
    [extra: string]: unknown;
}

function disponible(): boolean {
    return redis?.status === "ready" || redis?.status === "connect";
}

/**
 * Las claves las arma el helper para que no se pueda tomar el lock de un job y
 * escribir el estado de otro. `sufijo` es para los crons que corren por tenant
 * (`sync`), donde cada tenant tiene su propio lock.
 */
export function clavesDe(job: string, sufijo?: string): { estado: string; lock: string } {
    const cola = sufijo ? `:${sufijo}` : "";
    return { estado: `cron:${job}:status:v1${cola}`, lock: `cron:${job}:lock:v1${cola}` };
}

export async function escribirEstado(job: string, estado: EstadoAsync, sufijo?: string): Promise<void> {
    try {
        if (!disponible()) return;
        await redis.set(clavesDe(job, sufijo).estado, JSON.stringify(estado), "EX", TTL_ESTADO_SEGUNDOS);
    } catch (e) {
        console.warn(`[${job}] no se pudo escribir el estado:`, errorMessage(e));
    }
}

/**
 * El estado que ve el poller, con el huérfano ya resuelto.
 *
 * Sin Redis devuelve `null` (el llamador responde "idle"), que es lo mismo que
 * hacía cada endpoint por su cuenta: sin estado no se puede afirmar nada.
 */
export async function leerEstado(job: string, sufijo?: string): Promise<EstadoAsync | null> {
    try {
        if (!disponible()) return null;
        const { estado: claveEstado, lock } = clavesDe(job, sufijo);
        const crudo = await redis.get(claveEstado);
        if (!crudo) return null;

        const estado = JSON.parse(crudo) as EstadoAsync;
        if (estado.done) return estado;

        // `done:false` + lock vivo = sigue corriendo. Sin lock, el proceso que lo
        // estaba corriendo ya no existe.
        const lockVivo = await redis.exists(lock);
        if (lockVivo) return estado;

        return {
            ...estado,
            done: true,
            ok: false,
            orphan: true,
            error: "La ejecución se interrumpió (probable reinicio del contenedor) y ningún proceso la va a terminar.",
        };
    } catch (e) {
        console.warn(`[${job}] no se pudo leer el estado:`, errorMessage(e));
        return null;
    }
}

/**
 * Toma el lock del job. `false` si ya hay una ejecución viva.
 *
 * Si Redis no está disponible se devuelve `true` y el trabajo corre igual: la
 * alternativa sería no ejecutar ningún cron cuando se cae el cache, que es peor
 * que ejecutar dos veces un prewarm.
 */
export async function tomarLock(job: string, sufijo?: string, ttlSegundos = TTL_LOCK_SEGUNDOS): Promise<boolean> {
    try {
        if (!disponible()) return true;
        const res = await redis.set(clavesDe(job, sufijo).lock, String(Date.now()), "EX", ttlSegundos, "NX");
        return res === "OK";
    } catch {
        return true;
    }
}

/**
 * Latidos vivos, por clave de lock.
 *
 * El registro existe para que soltar el lock corte SIEMPRE su latido. Con el
 * stopper devuelto al llamador, cada endpoint tenía que acordarse de invocarlo
 * en todos sus caminos de salida --éxito, error y el catch del handler--, y el
 * que se olvidara dejaba un intervalo renovando el lock de un trabajo muerto:
 * el cron quedaría bloqueado hasta que el proceso se reinicie, que es peor que
 * el bug que este archivo viene a arreglar.
 */
const latidos = new Map<string, ReturnType<typeof setInterval>>();

function detenerLatido(clave: string): void {
    const timer = latidos.get(clave);
    if (timer) {
        clearInterval(timer);
        latidos.delete(clave);
    }
}

/** Suelta el lock y corta su latido. Es el único final del trabajo. */
export async function soltarLock(job: string, sufijo?: string): Promise<void> {
    const { lock } = clavesDe(job, sufijo);
    detenerLatido(lock);
    try {
        if (disponible()) await redis.del(lock);
    } catch (e) {
        console.warn(`[${job}] no se pudo soltar el lock:`, errorMessage(e));
    }
}

/**
 * Empieza a renovar el lock mientras el trabajo corre. Se llama justo después
 * de tomarlo; lo corta `soltarLock`, que es el único final.
 */
export function iniciarLatido(job: string, sufijo?: string, ttlSegundos = TTL_LOCK_SEGUNDOS): void {
    const { lock } = clavesDe(job, sufijo);
    detenerLatido(lock);

    const timer = setInterval(() => {
        if (!disponible()) return;
        redis.expire(lock, ttlSegundos).catch((e) => {
            console.warn(`[${job}] no se pudo renovar el lock:`, errorMessage(e));
        });
    }, INTERVALO_LATIDO_MS);

    // No retiene el proceso vivo por sí solo: lo que lo mantiene es el trabajo.
    if (typeof timer.unref === "function") timer.unref();
    latidos.set(lock, timer);
}
