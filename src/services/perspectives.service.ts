import Decimal from "decimal.js";
import { resolveAllocationTagKey } from "@/lib/allocationTags";

/**
 * MEJ-34 — Perspectives: repartir el gasto por N dimensiones a la vez.
 *
 * Una Perspective es un conjunto ORDENADO de reglas. La primera que matchea
 * decide el grupo, y por eso la pertenencia es única dentro de una Perspective
 * sin pedirle al usuario que resuelva conflictos. El mismo recurso puede estar
 * en grupos de Perspectives distintas.
 *
 * SE EVALÚA EN TYPESCRIPT, NO EN SQL. La propuesta original pedía generar un
 * `CASE WHEN` para el `GROUP BY`, con la advertencia de parametrizar para no
 * abrir una inyección. Acá se evalúa sobre el agregado que `CostSnapshots` ya
 * devuelve, por tres motivos: la cardinalidad está acotada —el agregado es por
 * (suscripción, grupo de recursos, servicio, huella de etiquetas) y no por
 * recurso—, no hay SQL armado con valores que escribe el usuario, y la vista
 * previa del criterio 5 —reordenar reglas y ver el reparto sin guardar— sale
 * gratis: es volver a evaluar en memoria.
 *
 * LO QUE NO SE PUEDE MEDIR SE DICE. Hay tres motivos distintos para que una
 * fila no caiga en ningún grupo y la pantalla los tiene que separar:
 *
 *   - `sin-regla`: se evaluaron todas las reglas y ninguna matcheó. Es el
 *     "Sin asignar" legítimo, el que el cliente arregla etiquetando o agregando
 *     una regla.
 *   - `sin-datos`: las reglas necesitan un dato que esta fila NO TIENE ingerido.
 *     `CostSnapshots.Tags` sólo se llena para los tenants con export FOCUS
 *     configurado; los que sincronizan por la Query API de Cost Management lo
 *     tienen en NULL, y su desglose por etiqueta vive en `CostTagSnapshots`.
 *     Para esos tenants, una Perspective de reglas por etiqueta mandaría TODO a
 *     "Sin asignar" — y eso no es un problema de etiquetado del cliente sino de
 *     nuestra ingesta. Mostrarlo junto al otro caso sería culpar al cliente de
 *     algo nuestro.
 *
 * El caso que cita el paper de CloudHealth es justamente éste: dos Perspectives
 * que cubrían el 80% del gasto con la meta puesta en 95%. Una Perspective que
 * cubre el 60% y no lo dice es peor que no tenerla, porque el reporte se lee
 * como si fuera el total.
 */

export type TipoRegla = "tag" | "name_pattern" | "subscription" | "resource_group" | "resource_type";

export interface ReglaPerspectiva {
    id?: number;
    grupo: string;
    tipo: TipoRegla;
    /** Sólo para `tag`: la clave de la etiqueta. */
    clave?: string | null;
    valor: string;
    orden: number;
}

/** Una fila del agregado de costo, con lo que las reglas pueden mirar. */
export interface FilaDeCosto {
    subscriptionId?: string | null;
    resourceGroup?: string | null;
    serviceName?: string | null;
    resourceId?: string | null;
    /** `null` = esta fila no tiene etiquetas ingeridas (distinto de `{}`). */
    tags?: Record<string, string> | null;
    costo: number;
}

export type MotivoSinGrupo = "sin-regla" | "sin-datos";

export interface GrupoDelReparto {
    grupo: string;
    costo: number;
    porcentaje: number;
    filas: number;
}

export interface RepartoPerspectiva {
    grupos: GrupoDelReparto[];
    /** Ninguna regla matcheó, habiendo podido evaluarlas todas. */
    sinAsignar: { costo: number; porcentaje: number; filas: number };
    /** Las reglas piden datos que estas filas no tienen ingeridos. */
    sinDatos: { costo: number; porcentaje: number; filas: number; motivos: string[] };
    total: number;
    /** Porcentaje del total que quedó dentro de algún grupo. */
    coberturaPct: number;
}

function red4(v: Decimal | number): number {
    return Number(new Decimal(v).toFixed(4));
}

function pct(parte: Decimal, total: Decimal): number {
    if (total.lte(0)) return 0;
    return Number(parte.dividedBy(total).times(100).toFixed(2));
}

/**
 * Nombre del recurso a partir del `resourceId` de ARM: el último segmento.
 * Devuelve null si no hay id, que es lo que distingue "no matcheó el patrón" de
 * "no se pudo evaluar el patrón".
 */
export function nombreDeRecurso(resourceId: string | null | undefined): string | null {
    const id = String(resourceId || "").trim();
    if (!id) return null;
    const partes = id.split("/").filter(Boolean);
    return partes.length ? partes[partes.length - 1] : null;
}

/**
 * Tipo ARM a partir del `resourceId`: `.../providers/Microsoft.Compute/disks/x`
 * da `microsoft.compute/disks`.
 */
export function tipoDeRecurso(resourceId: string | null | undefined): string | null {
    const id = String(resourceId || "").trim().toLowerCase();
    const i = id.indexOf("/providers/");
    if (i < 0) return null;
    const resto = id.slice(i + "/providers/".length).split("/").filter(Boolean);
    return resto.length >= 2 ? `${resto[0]}/${resto[1]}` : null;
}

/**
 * Busca el valor de una etiqueta tolerando mayúsculas y separadores
 * (`cost-center`, `Cost_Center` y `CostCenter` son la misma), que es el criterio
 * que ya usa `allocationTags.ts`. El VALOR no se normaliza: `prod` y `Prod`
 * pueden ser dos entornos distintos y no nos toca decidirlo.
 */
export function valorDeEtiqueta(tags: Record<string, string>, clave: string): string | undefined {
    if (Object.prototype.hasOwnProperty.call(tags, clave)) return tags[clave];
    const objetivo = resolveAllocationTagKey(clave) || clave;
    for (const [k, v] of Object.entries(tags)) {
        if (k === clave) return v;
        const canon = resolveAllocationTagKey(k);
        if (canon && canon === objetivo) return v;
        if (k.toLowerCase().replace(/[\s_\-.]/g, "") === clave.toLowerCase().replace(/[\s_\-.]/g, "")) return v;
    }
    return undefined;
}

/** `*` como comodín; el resto es literal. Case-insensitive. */
export function coincidePatron(texto: string, patron: string): boolean {
    const p = String(patron || "");
    if (!p) return false;
    const escapado = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escapado}$`, "i").test(texto);
}

/** Qué dato necesita cada tipo de regla, para poder decir que falta. */
function datoQueFalta(regla: ReglaPerspectiva, fila: FilaDeCosto): string | null {
    switch (regla.tipo) {
        case "tag":
            return fila.tags === null || fila.tags === undefined ? "etiquetas" : null;
        case "name_pattern":
            return nombreDeRecurso(fila.resourceId) === null ? "nombre de recurso" : null;
        case "resource_type":
            return tipoDeRecurso(fila.resourceId) === null ? "tipo de recurso" : null;
        case "subscription":
            return fila.subscriptionId ? null : "suscripción";
        case "resource_group":
            return fila.resourceGroup ? null : "grupo de recursos";
    }
}

function matchea(regla: ReglaPerspectiva, fila: FilaDeCosto): boolean {
    switch (regla.tipo) {
        case "tag": {
            if (!fila.tags) return false;
            const v = valorDeEtiqueta(fila.tags, String(regla.clave || ""));
            if (v === undefined) return false;
            // El valor admite comodín igual que el patrón de nombre: sin eso, una
            // regla por `Project` obliga a una regla por proyecto.
            return coincidePatron(v, regla.valor);
        }
        case "name_pattern": {
            const n = nombreDeRecurso(fila.resourceId);
            return n !== null && coincidePatron(n, regla.valor);
        }
        case "resource_type": {
            const t = tipoDeRecurso(fila.resourceId);
            return t !== null && coincidePatron(t, regla.valor);
        }
        case "subscription":
            return !!fila.subscriptionId && fila.subscriptionId.toLowerCase() === regla.valor.trim().toLowerCase();
        case "resource_group":
            return !!fila.resourceGroup && coincidePatron(fila.resourceGroup, regla.valor);
    }
}

export interface ResultadoFila {
    grupo: string | null;
    motivo?: MotivoSinGrupo;
    /** Qué dato faltó, cuando el motivo es `sin-datos`. */
    falta?: string;
}

/**
 * Evalúa una fila contra las reglas EN ORDEN. La primera que matchea gana.
 *
 * Si ninguna matchea, distingue los dos motivos: si TODAS las reglas necesitaban
 * un dato que la fila no tiene, es `sin-datos`; si al menos una se pudo evaluar
 * y no matcheó, es `sin-regla`. El criterio es deliberado: basta una regla
 * evaluable para que la fila haya tenido una oportunidad real.
 */
export function evaluarFila(fila: FilaDeCosto, reglas: ReglaPerspectiva[]): ResultadoFila {
    const ordenadas = [...(reglas || [])].sort((a, b) => a.orden - b.orden);
    if (ordenadas.length === 0) return { grupo: null, motivo: "sin-regla" };

    const faltantes: string[] = [];
    let algunaEvaluable = false;

    for (const regla of ordenadas) {
        const falta = datoQueFalta(regla, fila);
        if (falta) {
            faltantes.push(falta);
            continue;
        }
        algunaEvaluable = true;
        if (matchea(regla, fila)) return { grupo: regla.grupo };
    }

    if (!algunaEvaluable) return { grupo: null, motivo: "sin-datos", falta: faltantes[0] };
    return { grupo: null, motivo: "sin-regla" };
}

/**
 * Reparte el costo de un conjunto de filas entre los grupos de una Perspective.
 *
 * INVARIANTE: grupos + sinAsignar + sinDatos == total, exacto. Es el criterio de
 * aceptación 4 y sin él la pantalla no es auditable; hay un test que lo
 * comprueba sobre datos con decimales.
 */
export function repartir(filas: FilaDeCosto[] | null | undefined, reglas: ReglaPerspectiva[]): RepartoPerspectiva {
    const porGrupo = new Map<string, { costo: Decimal; filas: number }>();
    let sinAsignar = new Decimal(0);
    let sinAsignarFilas = 0;
    let sinDatos = new Decimal(0);
    let sinDatosFilas = 0;
    const motivos = new Set<string>();
    let total = new Decimal(0);

    for (const fila of filas || []) {
        const costo = new Decimal(Number(fila?.costo) || 0);
        total = total.plus(costo);
        const r = evaluarFila(fila, reglas);
        if (r.grupo !== null) {
            const e = porGrupo.get(r.grupo) || { costo: new Decimal(0), filas: 0 };
            e.costo = e.costo.plus(costo);
            e.filas += 1;
            porGrupo.set(r.grupo, e);
        } else if (r.motivo === "sin-datos") {
            sinDatos = sinDatos.plus(costo);
            sinDatosFilas += 1;
            if (r.falta) motivos.add(r.falta);
        } else {
            sinAsignar = sinAsignar.plus(costo);
            sinAsignarFilas += 1;
        }
    }

    const grupos = [...porGrupo.entries()]
        .map(([grupo, v]) => ({
            grupo,
            costo: red4(v.costo),
            porcentaje: pct(v.costo, total),
            filas: v.filas,
        }))
        .sort((a, b) => b.costo - a.costo);

    const enGrupos = [...porGrupo.values()].reduce((a, v) => a.plus(v.costo), new Decimal(0));

    return {
        grupos,
        sinAsignar: { costo: red4(sinAsignar), porcentaje: pct(sinAsignar, total), filas: sinAsignarFilas },
        sinDatos: {
            costo: red4(sinDatos),
            porcentaje: pct(sinDatos, total),
            filas: sinDatosFilas,
            motivos: [...motivos].sort(),
        },
        total: red4(total),
        coberturaPct: pct(enGrupos, total),
    };
}

/* ------------------------------------------------------------------ *
 * Acceso a datos. Lo de arriba es puro y se testea sin base.
 * ------------------------------------------------------------------ */

import pool from "@/modules/storage/db";

export interface Perspectiva {
    id: number;
    name: string;
    description: string | null;
    reglas: ReglaPerspectiva[];
}

function normalizarFilas(rows: any[]): FilaDeCosto[] {
    return (rows || []).map((r) => {
        let tags: Record<string, string> | null = null;
        // `Tags` es una columna JSON: mysql2 la devuelve ya parseada o como
        // texto segun la version del driver. NULL se conserva NULL -- que es
        // distinto de `{}` -- porque es la señal de "sin etiquetas ingeridas".
        if (r.Tags !== null && r.Tags !== undefined) {
            try {
                tags = typeof r.Tags === "string" ? JSON.parse(r.Tags) : (r.Tags as Record<string, string>);
            } catch {
                tags = null;
            }
        }
        return {
            subscriptionId: r.subscription_id ?? null,
            resourceGroup: r.resource_group ?? null,
            serviceName: r.service_name ?? null,
            resourceId: r.ResourceId ?? null,
            tags,
            costo: Number(r.costo) || 0,
        };
    });
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
