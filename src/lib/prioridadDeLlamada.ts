/**
 * Prioridad de la request en curso, para las colas de Azure (`apiThrottle`).
 *
 * POR QUE EXISTE
 * Los prewarm no llaman funciones: pegan HTTP contra las MISMAS rutas que usa
 * una persona (`/api/intelligence/compute/workloads?...`), con el header
 * `X-Cron-Auth`. O sea que el handler no puede distinguir por el código quién
 * lo llamó, y la cola de Cost Management --que es FIFO y global-- terminaba
 * atendiendo por orden de llegada el pedido de alguien mirando la pantalla y el
 * de un job que precalienta cachés.
 *
 * Medido en prod el 2026-09-15: tres jobs de prewarm arrancan en el mismo
 * minuto (:00 y :30), cada uno dispara trabajo que sigue corriendo dentro del
 * web app durante minutos (189 s y 244 s por familia y tenant), y entre eso, el
 * backfill histórico y el audit dejaron 48 respuestas 429 en 13 minutos. El
 * whiteboard esperaba detrás de todo eso.
 *
 * COMO SE PROPAGA
 * `AsyncLocalStorage`: `requireTenantAccess` marca la request como de fondo
 * apenas valida el `X-Cron-Auth`, y todo lo que cuelga de ese scope async
 * --incluidas las llamadas a Cost Management y Resource Graph-- lo hereda sin
 * que haya que pasar un parámetro por 28 call sites.
 *
 * El default es `interactiva` A PROPOSITO: lo único que se despriorizA es lo
 * que se marcó explícitamente. Si mañana aparece un job que no pasa por
 * `requireTenantAccess`, se comporta como hoy en vez de quedar postergado sin
 * que nadie se entere.
 *
 * TECHO CONOCIDO. La prioridad se fija al ENCOLAR. Si un prewarm ya arrancó una
 * consulta y una persona llega mientras está en vuelo, la deduplicación
 * (`COST_INFLIGHT`, `getWithStaleWhileRevalidate`) la engancha a esa consulta
 * de baja prioridad y espera lo mismo que el job. No es una regresión --antes
 * la cola era FIFO y pasaba igual-- y la alternativa, repetir la consulta para
 * que vaya por la fila rápida, agrega justo la carga que causa los 429.
 * ponytail: si esto llega a doler, promover la llamada en vuelo re-encolándola.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type Prioridad = "interactiva" | "fondo";

const almacen = new AsyncLocalStorage<Prioridad>();

/**
 * Marca el resto del scope async en curso como trabajo de fondo.
 *
 * Va `enterWith` y no `run` porque el llamador es `requireTenantAccess`, que
 * devuelve una identidad en el medio del handler: no tiene un callback que
 * envolver. `enterWith` alcanza al resto de ESTE contexto async y a los que
 * nazcan de él, que es exactamente el resto de la request.
 */
export function marcarComoFondo(): void {
    almacen.enterWith("fondo");
}

/** Para jobs que corren fuera de una request HTTP y sí tienen un callback. */
export function conPrioridadDeFondo<T>(fn: () => T): T {
    return almacen.run("fondo", fn);
}

export function prioridadActual(): Prioridad {
    return almacen.getStore() ?? "interactiva";
}
