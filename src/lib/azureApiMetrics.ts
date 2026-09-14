import { redis } from "@/lib/redis";

/**
 * Cuántas veces le pegamos a las APIs de Azure, y cuántas nos frenan.
 *
 * POR QUÉ EXISTE
 * Cost Management venía throttleando de forma sostenida y la única evidencia
 * eran los `console.warn` del backoff en Log Analytics: se podían contar los
 * 429, pero no CUÁNTAS llamadas hacíamos en total ni desde qué operación. Sin
 * denominador, "429 por cuarto de hora" no dice si el problema es el volumen o
 * la ventana de Azure -- y se terminan tocando cadencias a ojo.
 *
 * Va en el limitador y no en cada llamador: `apiThrottle` es el punto único por
 * el que pasan las 28 llamadas de Cost Management y las de Resource Graph, así
 * que instrumentarlo ahí cubre todo sin tocar ningún call site.
 *
 * REDIS Y NO MEMORIA. Los contadores en proceso se pierden en cada deploy
 * --justo cuando más interesa mirar-- y no suman entre réplicas. `INCR` es
 * barato, y las claves expiran solas a los 8 días.
 *
 * NO ES UN CAMINO CRÍTICO: todo va en try/catch y sin await bloqueante. Una
 * falla de Redis no puede tumbar una consulta de costos por no poder contarla.
 */

/**
 * El tenant no lo conoce el limitador: lo pasa quien hace la llamada. Los que
 * no lo pasan caen acá, y es honesto que se vea -- decir "sin-tenant" es mejor
 * que atribuirle el consumo a cualquiera.
 */
export const SIN_TENANT = "sin-tenant";

/** Ventana de agregación: una clave por hora. */
function claveHora(fecha = new Date()): string {
    return fecha.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

const TTL_SEGUNDOS = 8 * 24 * 3600;

/**
 * El label viene con el detalle de la llamada --`cost-mtd(sub 1234-...)`,
 * `historical(chunk 2/5)`-- y agrupar por eso daría miles de claves de una sola
 * muestra. Se corta en el primer paréntesis: queda la operación.
 */
export function normalizarOperacion(label: string | undefined): string {
    if (!label) return "sin-etiqueta";
    const base = label.split("(")[0].trim();
    return base.slice(0, 60) || "sin-etiqueta";
}

export type ResultadoLlamada = "ok" | "throttle" | "error";

/**
 * Registra una llamada terminada. `esperaMs` es lo que estuvo frenada en la
 * cola o en backoff, que es el costo real del throttling: no se pierde la
 * llamada, se pierde el tiempo.
 */
export function registrarLlamadaAzure(
    servicio: string,
    label: string | undefined,
    resultado: ResultadoLlamada,
    esperaMs = 0,
    tenantId?: string
): void {
    try {
        if (redis?.status !== "ready" && redis?.status !== "connect") return;
        const operacion = normalizarOperacion(label);
        // El tenant va en la clave y no en un hash aparte: la pregunta que hay
        // que poder responder es "qué cliente nos hace consumir más cuota de
        // API", y con el consumo agregado por servicio eso no se ve.
        const tenant = (tenantId || SIN_TENANT).slice(0, 64);
        const clave = `azureapi:v1:${claveHora()}:${servicio}:${tenant}:${operacion}`;

        const pipe = redis.pipeline();
        pipe.hincrby(clave, "llamadas", 1);
        pipe.hincrby(clave, resultado, 1);
        if (esperaMs > 0) pipe.hincrby(clave, "esperaMs", Math.round(esperaMs));
        pipe.expire(clave, TTL_SEGUNDOS);
        pipe.exec().catch(() => { /* contar no puede romper la llamada */ });
    } catch {
        /* idem */
    }
}

export interface UsoApiAzure {
    hora: string;
    servicio: string;
    tenantId: string;
    operacion: string;
    llamadas: number;
    ok: number;
    throttle: number;
    error: number;
    esperaMs: number;
}

/**
 * Lee las últimas `horas` de contadores. Usa SCAN y no KEYS: `KEYS` bloquea el
 * servidor entero mientras recorre, y esto se llama desde un panel.
 */
export async function leerUsoApiAzure(horas = 24): Promise<UsoApiAzure[]> {
    if (redis?.status !== "ready" && redis?.status !== "connect") return [];

    const desde = new Date(Date.now() - horas * 3600_000);
    const horasValidas = new Set<string>();
    for (let i = 0; i <= horas; i++) {
        horasValidas.add(claveHora(new Date(desde.getTime() + i * 3600_000)));
    }

    const filas: UsoApiAzure[] = [];
    let cursor = "0";
    do {
        const [siguiente, claves] = await redis.scan(cursor, "MATCH", "azureapi:v1:*", "COUNT", 200);
        cursor = siguiente;
        for (const clave of claves) {
            const [, , hora, servicio, tenantId, ...resto] = clave.split(":");
            if (!horasValidas.has(hora)) continue;
            const datos = await redis.hgetall(clave);
            filas.push({
                hora,
                servicio,
                tenantId: tenantId || SIN_TENANT,
                operacion: resto.join(":"),
                llamadas: Number(datos.llamadas || 0),
                ok: Number(datos.ok || 0),
                throttle: Number(datos.throttle || 0),
                error: Number(datos.error || 0),
                esperaMs: Number(datos.esperaMs || 0),
            });
        }
    } while (cursor !== "0");

    return filas.sort((a, b) => (a.hora === b.hora ? b.llamadas - a.llamadas : b.hora.localeCompare(a.hora)));
}
