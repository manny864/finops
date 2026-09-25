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

/*
 * NO agregar acceso a datos en este archivo. Vive aparte, en
 * `perspectivesData.service.ts`, y el motivo es concreto: `mockData.ts` importa
 * `repartir()` para que la demo use el MISMO evaluador que producción, y
 * `mockData.ts` lo importan componentes de cliente. Con `pool` acá, el bundle
 * del navegador arrastra `storage/db` -> `migrations` -> `fs` y la aplicación
 * entera deja de compilar con "Module not found: Can't resolve 'fs'". El
 * typecheck no lo ve; lo vio el navegador.
 */
