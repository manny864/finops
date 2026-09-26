/**
 * MEJ-34 — acceso a datos de Perspectives.
 *
 * Separado de `perspectives.service.ts` A PROPOSITO: aquel es puro y lo importa
 * `mockData.ts` para que la demo reparta con el mismo evaluador que producción.
 * `mockData.ts` lo importan componentes de cliente, así que un `pool` allá
 * arrastra `fs` al bundle del navegador y nada compila.
 */

import pool from "@/modules/storage/db";
import { evaluarFila } from "./perspectives.service";
import type { FilaDeCosto, ReglaPerspectiva, TipoRegla } from "./perspectives.service";

export interface Perspectiva {
    id: number;
    name: string;
    description: string | null;
    reglas: ReglaPerspectiva[];
}

/**
 * Parsea la columna JSON `Tags`: mysql2 la devuelve ya parseada o como texto
 * segun la version del driver.
 *
 * NULL se conserva NULL -- que es distinto de `{}` -- porque es la señal de
 * "sin etiquetas ingeridas", y de eso depende que `evaluarFila` sepa separar
 * `sin-datos` de `sin-regla`. Vive acá y no en cada llamador porque ese matiz
 * se pierde en la tercera copia.
 */
export function etiquetasDeColumna(valor: unknown): Record<string, string> | null {
    if (valor === null || valor === undefined) return null;
    try {
        return typeof valor === "string" ? JSON.parse(valor) : (valor as Record<string, string>);
    } catch {
        return null;
    }
}

/**
 * Las dimensiones que una regla de Perspective puede mirar, listas para pegar
 * en un `SELECT` y en su `GROUP BY`.
 *
 * Van juntas y con nombre porque un tablero que agregue en TypeScript tiene que
 * traer EXACTAMENTE estas cinco: si le falta una, las reglas de ese tipo dejan
 * de poder evaluarse y las filas se van a `sin-datos` **sin que nada falle** —
 * el tablero mostraría un recorte más chico del que corresponde y nadie se
 * enteraría.
 */
export const DIMENSIONES_DE_ALCANCE = "subscription_id, resource_group, service_name, ResourceId, Tags";

/** Una fila cruda de `CostSnapshots` con esas dimensiones. */
export interface FilaConDimensiones {
    subscription_id?: string | null;
    resource_group?: string | null;
    service_name?: string | null;
    ResourceId?: string | null;
    Tags?: unknown;
}

/** Traduce una fila de `CostSnapshots` a lo que el evaluador de Perspectives mira. */
export function comoFilaDeCosto(r: FilaConDimensiones, costo: number): FilaDeCosto {
    return {
        subscriptionId: r.subscription_id ?? null,
        resourceGroup: r.resource_group ?? null,
        serviceName: r.service_name ?? null,
        resourceId: r.ResourceId ?? null,
        tags: etiquetasDeColumna(r.Tags),
        costo,
    };
}

function normalizarFilas(rows: any[]): FilaDeCosto[] {
    return (rows || []).map((r) => comoFilaDeCosto(r, Number(r.costo) || 0));
}

/**
 * Filas de costo del período, agregadas por las dimensiones que las reglas
 * pueden mirar.
 *
 * Se agrupa para no traer una fila por día: la cardinalidad queda en las
 * combinaciones distintas de (suscripción, grupo de recursos, servicio,
 * etiquetas, recurso), que es la que `CostSnapshots` ya tiene por diseño.
 *
 * `COALESCE(EffectiveCost, BilledCost, cost_usd)` en ese orden, igual que el
 * resto del producto: el amortizado primero.
 */
export async function filasDeCosto(
    tenantId: string,
    desde: string,
    hasta: string,
    subscriptionId?: string,
): Promise<FilaDeCosto[]> {
    const where: string[] = ["tenant_id = ?", "date >= ?", "date <= ?"];
    const params: unknown[] = [tenantId, desde, hasta];
    if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
        where.push("subscription_id = ?");
        params.push(subscriptionId);
    }
    const [rows] = await pool.query<any[]>(
        `SELECT subscription_id, resource_group, service_name, ResourceId, Tags,
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS costo
           FROM CostSnapshots
          WHERE ${where.join(" AND ")}
          GROUP BY subscription_id, resource_group, service_name, ResourceId, Tags`,
        params,
    );
    return normalizarFilas(rows);
}

/** Las Perspectives del tenant con sus reglas, ya ordenadas. */
export async function listarPerspectivas(tenantId: string): Promise<Perspectiva[]> {
    const [ps] = await pool.query<any[]>(
        `SELECT id, name, description FROM Perspectives WHERE tenant_id = ? ORDER BY name`,
        [tenantId],
    );
    if (!ps?.length) return [];
    const ids = ps.map((p) => p.id);
    const [rs] = await pool.query<any[]>(
        `SELECT id, perspective_id, group_name, match_type, match_key, match_value, sort_order
           FROM PerspectiveRules
          WHERE perspective_id IN (${ids.map(() => "?").join(",")})
          ORDER BY perspective_id, sort_order`,
        ids,
    );
    const porPerspectiva = new Map<number, ReglaPerspectiva[]>();
    for (const r of rs || []) {
        const lista = porPerspectiva.get(r.perspective_id) || [];
        lista.push({
            id: r.id,
            grupo: r.group_name,
            tipo: r.match_type as TipoRegla,
            clave: r.match_key,
            valor: r.match_value,
            orden: Number(r.sort_order) || 0,
        });
        porPerspectiva.set(r.perspective_id, lista);
    }
    return ps.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        reglas: porPerspectiva.get(p.id) || [],
    }));
}

/** Reemplaza las reglas de una Perspective en una transacción. */
export async function guardarReglas(perspectiveId: number, reglas: ReglaPerspectiva[]): Promise<void> {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(`DELETE FROM PerspectiveRules WHERE perspective_id = ?`, [perspectiveId]);
        let orden = 0;
        for (const r of reglas || []) {
            await conn.query(
                `INSERT INTO PerspectiveRules (perspective_id, group_name, match_type, match_key, match_value, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [perspectiveId, r.grupo, r.tipo, r.tipo === "tag" ? r.clave ?? null : null, r.valor, orden++],
            );
        }
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

/** Valor reservado del selector para acotar al costo sin asignar. */
export const GRUPO_SIN_ASIGNAR = "__unassigned__";

/** El recorte de un alcance, listo para pegar en SQL y en KQL. */
export interface RecorteDeAlcance {
    /** Fragmento para pegar con AND, y sus parámetros en ese orden. */
    sql: string;
    params: unknown[];
    /** Grupos de recursos en alcance, para acotar Resource Graph. */
    resourceGroups: string[];
    /** Identificadores en alcance, en minúsculas. Vacío cuando el costo no los trae. */
    resourceIds: Set<string>;
    /** true = acotar por grupo de recursos ya es exacto; false = hay que intersectar por identificador. */
    porGrupoAlcanza: boolean;
}

const vacio = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * MEJ-34 — traduce un alcance a UN predicado SQL exacto, o devuelve `null` si no
 * se puede traducir sin mentir.
 *
 * POR QUÉ ESTO Y NO PLEGAR EN TYPESCRIPT. Plegar sirve cuando un tablero tiene
 * una o dos agregaciones. El detalle de un Cost Group tiene diez, cada una con
 * su ventana y su agrupación, y su grano —que incluye la fecha— NO colapsa: son
 * las filas crudas. Medido contra la base local, 16.822 filas siguen siendo
 * 16.822 al agrupar por (fecha, suscripción, grupo, servicio, medidor, familia,
 * recurso, etiquetas). Traerlas todas para plegar diez veces no escala.
 *
 * El grano del ALCANCE, en cambio, sí colapsa: las mismas 16.822 filas son 152
 * combinaciones, y sólo 51 ternas (suscripción, grupo de recursos, recurso).
 * `service_name` no entra porque ninguna regla lo mira —`matchea()` sólo lee
 * etiquetas, recurso, suscripción y grupo—. Con eso el alcance se expresa como
 * un `IN` de ternas que se pega a las diez consultas sin tocar ninguna.
 *
 * NO ES UNA SEGUNDA IMPLEMENTACIÓN DEL EVALUADOR. Las ternas salen de correr
 * `evaluarFila` de verdad sobre las filas; lo que viaja a SQL es el RESULTADO,
 * no las reglas. Por eso no puede derivar del evaluador real: es el evaluador
 * real.
 *
 * CUÁNDO DEVUELVE NULL, que es lo que lo hace honesto:
 *
 *   - Una terna aparece a los dos lados del alcance (la misma suscripción,
 *     grupo y recurso con dos juegos de etiquetas distintos, típicamente porque
 *     el recurso cambió de etiqueta en la ventana). SQL no puede separarlas, y
 *     recortar igual atribuiría mal.
 *   - Hay más ternas que el tope: un `IN` de decenas de miles deja de ser una
 *     consulta razonable.
 *
 * En los dos casos el llamador devuelve el tablero entero y lo dice, que es la
 * misma regla que el resto de MEJ-34.
 */
export function recorteDeAlcance(
    filas: FilaConDimensiones[],
    alcance: (fila: FilaDeCosto) => boolean,
    tope = 2000,
): RecorteDeAlcance | null {
    const estado = new Map<string, { t: [string, string, string]; dentro: boolean; fuera: boolean }>();
    const porRg = new Map<string, { dentro: boolean; fuera: boolean }>();

    for (const f of filas || []) {
        const t: [string, string, string] = [vacio(f.subscription_id), vacio(f.resource_group), vacio(f.ResourceId)];
        const clave = t.join("\u0001");
        const dentro = alcance(comoFilaDeCosto(f, 0));

        const e = estado.get(clave) || { t, dentro: false, fuera: false };
        if (dentro) e.dentro = true; else e.fuera = true;
        estado.set(clave, e);

        const claveRg = `${t[0]}\u0001${t[1]}`;
        const r = porRg.get(claveRg) || { dentro: false, fuera: false };
        if (dentro) r.dentro = true; else r.fuera = true;
        porRg.set(claveRg, r);
    }

    if ([...estado.values()].some((e) => e.dentro && e.fuera)) return null;

    const dentro = [...estado.values()].filter((e) => e.dentro);
    if (dentro.length > tope) return null;

    // Si ningún grupo de recursos está partido, acotar Resource Graph por grupo
    // ya es exacto. Si alguno lo está, hace falta el identificador de cada
    // recurso; sin él no hay forma de separarlos y se devuelve null.
    const porGrupoAlcanza = ![...porRg.values()].some((r) => r.dentro && r.fuera);
    const resourceIds = new Set(dentro.map((e) => e.t[2]).filter(Boolean).map((s) => s.toLowerCase()));
    if (!porGrupoAlcanza && resourceIds.size !== dentro.length) return null;

    return {
        // NULL nunca es igual a NULL, así que sin el COALESCE una fila sin
        // `ResourceId` --que es el caso de todo lo que ingesta el sync-- no
        // matchearía nunca y el tablero saldría vacío.
        sql: dentro.length === 0
            ? "1=0"
            : `(COALESCE(subscription_id,''), COALESCE(resource_group,''), COALESCE(ResourceId,'')) IN (${dentro.map(() => "(?,?,?)").join(",")})`,
        params: dentro.flatMap((e) => e.t),
        resourceGroups: [...new Set(dentro.map((e) => e.t[1]).filter(Boolean))],
        resourceIds,
        porGrupoAlcanza,
    };
}

/**
 * Predicado de alcance para el selector transversal de Perspective.
 *
 * Devuelve `null` cuando no hay alcance que aplicar —sin `perspectiveId`, o si
 * la Perspective no es de este tenant—, y el llamador entonces no filtra nada.
 * Es deliberado: ante un id que no resuelve, una pantalla que devolviera VACÍO
 * se leería como "este grupo no tiene gasto", que es una afirmación falsa.
 *
 * `grupo` nulo significa "cualquier grupo de esta Perspective", que no es lo
 * mismo que no filtrar: deja afuera lo que ninguna regla asigna.
 */
export async function filtroDeAlcance(
    tenantId: string,
    perspectiveId: number | null,
    grupo: string | null,
): Promise<((fila: FilaDeCosto) => boolean) | null> {
    if (!perspectiveId) return null;
    const perspectiva = (await listarPerspectivas(tenantId)).find((p) => p.id === perspectiveId);
    if (!perspectiva) return null;

    const reglas = perspectiva.reglas;
    return (fila: FilaDeCosto) => {
        const r = evaluarFila(fila, reglas);
        if (grupo === GRUPO_SIN_ASIGNAR) return r.grupo === null;
        if (!grupo) return r.grupo !== null;
        return r.grupo === grupo;
    };
}
