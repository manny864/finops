import { obtenerItemsRetail, precioMensualDesdeUnidad } from "@/services/pricingService";
import {
    CATALOGO_ARM,
    POR_USO_ARM,
    SIN_COSTO_ARM,
    accionDeCambio,
    tipoDeResourceId,
} from "@/services/iacCostCatalogArm";
import {
    CATALOGO_TF,
    POR_USO,
    SIN_COSTO,
    normalizarRegion,
    skuDeDisco,
    type Attrs,
    type Componente,
    type ContextoLinea,
    type MotivoSinTarifar,
} from "@/services/iacCostCatalog";

export { skuDeDisco };
export type { MotivoSinTarifar };

/**
 * MEJ-20 — Shift-Left FinOps: estimar el delta de costo mensual de un PR a
 * partir de la salida de `terraform show -json <planfile>`.
 *
 * El punto de la mejora es mover la conversación de costo al momento del PR, que
 * es cuando todavía es barata. Hoy la plataforma es reactiva: detecta el gasto
 * una vez que el recurso ya está provisionado y costando.
 *
 * ESTE ARCHIVO ES EL MOTOR: lee el plan, aplica create/update/delete, suma y
 * aplica el descuento del cliente. Qué se cobra por cada tipo de recurso y cómo
 * se encuentra el medidor está en `iacCostCatalog.ts`.
 *
 * FORMATO DE ENTRADA, verificado y no supuesto. Los nombres de campo salen de un
 * plan REAL generado el 2026-10-08 con Terraform v1.15.8 y azurerm 4.81.0
 * (`format_version: "1.2"`), no de la documentación: `resource_changes[]` con
 * `address`, `type`, `change.actions[]`, `change.before`, `change.after` y
 * `change.after_unknown` (los valores que Terraform resuelve recién al aplicar).
 *
 * POR QUÉ NO HAY UN CATÁLOGO DE PRECIOS NUEVO. MEJ-32 documenta la duplicación
 * de catálogos como bug recurrente de este repo: los precios salen siempre de la
 * Retail API por `pricingService`, que cachea, pagina y reintenta.
 */

export type AccionPlan = "create" | "delete" | "update" | "replace" | "no-op";

export type ClaseRecurso = "costo" | "sin-costo" | "por-uso" | "no-soportado";

export interface RecursoPlaneado {
    direccion: string;
    tipo: string;
    accion: AccionPlan;
    clase: ClaseRecurso;
    antes: Attrs | null;
    despues: Attrs | null;
    /** `after_unknown`: qué valores se definen recién al aplicar. */
    desconocidos: Attrs | null;
}

export interface ComponenteLinea {
    etiqueta: string;
    cantidad: number;
    /** USD/mes de la cantidad completa (precio unitario × cantidad). */
    mensual: number;
}

export interface LineaEstimacion {
    direccion: string;
    tipo: string;
    accion: AccionPlan;
    region: string;
    mensualAntes: number;
    mensualDespues: number;
    delta: number;
    /** Sólo cuando el cliente tiene un descuento configurado: los mismos montos a precio de lista. */
    listaAntes?: number;
    listaDespues?: number;
    /** Desglose de lo que se cobra (el estado "después", o el "antes" si el recurso se borra). */
    componentes?: ComponenteLinea[];
    /** Avisos de lo que el número NO incluye: `datos-procesados-no-incluidos`, `region-inferida`… */
    notas?: string[];
    /** Por qué no se pudo tarifar. Ausente cuando sí se pudo. */
    motivo?: MotivoSinTarifar;
}

export interface Estimacion {
    lineas: LineaEstimacion[];
    /** Suma de lo que ya existía, según el plan (con el descuento aplicado, si hay). */
    mensualActual: number;
    mensualProyectado: number;
    delta: number;
    /** Lo mismo a precio de lista. Igual a lo anterior cuando no hay descuento. */
    listaActual: number;
    listaProyectada: number;
    listaDelta: number;
    descuentoPct: number;
    /** Recursos que el plan toca y no se pudieron tarifar (sin contar los de consumo). */
    sinTarifar: number;
    /** Recursos que se cobran por consumo: hay un gasto futuro que no se puede estimar. */
    porUso: number;
    /** Los que no cuestan nada por definición (RG, subnet, NIC…). */
    sinCosto: number;
}

/** Las combinaciones de `actions` que produce terraform, a una sola etiqueta. */
export function accionDe(actions: unknown): AccionPlan {
    const a = Array.isArray(actions) ? actions.map(String) : [];
    if (a.length === 0 || (a.length === 1 && a[0] === "no-op")) return "no-op";
    // Un reemplazo viaja como ["delete","create"] o ["create","delete"] segun
    // si lleva create_before_destroy.
    if (a.includes("delete") && a.includes("create")) return "replace";
    if (a.includes("create")) return "create";
    if (a.includes("delete")) return "delete";
    if (a.includes("update")) return "update";
    return "no-op";
}

const objeto = (v: unknown): Attrs | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Attrs) : null);

/** Lee el plan y devuelve qué hay que tarifar, sin consultar precios todavía. */
export function leerPlan(plan: unknown): RecursoPlaneado[] {
    const cambios = (plan as any)?.resource_changes;
    if (!Array.isArray(cambios)) return [];

    const salida: RecursoPlaneado[] = [];
    for (const rc of cambios) {
        const tipo = String(rc?.type || "");
        if (!tipo) continue;
        const clase: ClaseRecurso = SIN_COSTO.has(tipo)
            ? "sin-costo"
            : CATALOGO_TF[tipo]
            ? "costo"
            : POR_USO.has(tipo)
            ? "por-uso"
            : "no-soportado";
        salida.push({
            direccion: String(rc?.address || tipo),
            tipo,
            accion: accionDe(rc?.change?.actions),
            clase,
            antes: objeto(rc?.change?.before),
            despues: objeto(rc?.change?.after),
            desconocidos: objeto(rc?.change?.after_unknown),
        });
    }
    return salida;
}

/**
 * Si todos los recursos del plan que declaran región coinciden en una sola, esa
 * es la región de los que no la traen (un node pool de AKS no tiene `location`:
 * hereda la del clúster, y el plan no dice cuál es hasta aplicar). Con dos
 * regiones distintas no se adivina: el recurso queda `sin-region`.
 */
function regionUnica(recursos: RecursoPlaneado[]): string | null {
    const regiones = new Set<string>();
    for (const r of recursos) {
        const region = normalizarRegion((r.despues ?? r.antes)?.location);
        if (region) regiones.add(region);
    }
    return regiones.size === 1 ? [...regiones][0] : null;
}

// ───────────────────────── precios ─────────────────────────

export type ResultadoPrecio =
    | { ok: true; mensual: number }
    | { ok: false; motivo: "sin-precio" | "precio-no-disponible" };

export type FuncionPrecio = (c: Componente) => Promise<ResultadoPrecio>;

/**
 * Precio mensual de UNA unidad del componente, de la Retail API. Distingue lo
 * que antes se confundía en un 0: que la API contestó y no existe el medidor
 * (`sin-precio`, no sirve reintentar) de que no se pudo preguntar
 * (`precio-no-disponible`: 429 o caída, reintentar sí sirve).
 *
 * Un medidor encontrado con precio 0 es un precio válido (planes Free, SKUs
 * gratuitos): ya no se lo trata como "no hay precio".
 */
export const precioRetail: FuncionPrecio = async (c) => {
    const r = await obtenerItemsRetail(c.consulta);
    if ("error" in r) return { ok: false, motivo: r.error === "filtro-invalido" ? "sin-precio" : "precio-no-disponible" };
    const item = c.elegir(r.items);
    if (!item) return { ok: false, motivo: "sin-precio" };
    const mensual = precioMensualDesdeUnidad(item.retailPrice, item.unitOfMeasure);
    return mensual === null ? { ok: false, motivo: "sin-precio" } : { ok: true, mensual };
};

const redondear = (n: number): number => Number(n.toFixed(4));

type Valuacion =
    | { ok: true; mensual: number; componentes: ComponenteLinea[]; notas: string[] }
    | { ok: false; motivo: MotivoSinTarifar };

async function valuar(
    tipo: string, attrs: Attrs | null, ctx: ContextoLinea, precio: FuncionPrecio
): Promise<Valuacion> {
    const entrada = CATALOGO_TF[tipo];
    if (!entrada) return { ok: false, motivo: "tipo-no-soportado" };
    if (!attrs) return { ok: false, motivo: "sin-sku" };

    const resultado = entrada.construir(attrs, ctx);
    if ("motivo" in resultado) return { ok: false, motivo: resultado.motivo };

    let total = 0;
    const componentes: ComponenteLinea[] = [];
    for (const c of resultado.componentes) {
        const p = await precio(c);
        if (!p.ok) return { ok: false, motivo: p.motivo };
        const mensual = p.mensual * c.cantidad;
        total += mensual;
        componentes.push({ etiqueta: c.etiqueta, cantidad: c.cantidad, mensual: redondear(mensual) });
    }
    return { ok: true, mensual: total, componentes, notas: resultado.notas };
}

async function tarifarRecurso(
    r: RecursoPlaneado, precio: FuncionPrecio, regionPorDefecto: string | null
): Promise<LineaEstimacion & { _clase: ClaseRecurso }> {
    const region = normalizarRegion((r.despues ?? r.antes)?.location) || regionPorDefecto || "";
    const base = {
        direccion: r.direccion, tipo: r.tipo, accion: r.accion, region,
        mensualAntes: 0, mensualDespues: 0, delta: 0, _clase: r.clase,
    };

    if (r.clase === "sin-costo") return base;
    if (r.clase === "por-uso") return { ...base, motivo: "por-uso" };
    if (r.clase === "no-soportado") return { ...base, motivo: "tipo-no-soportado" };
    // Un `no-op` no cambia nada: no se gasta una llamada a la API en él.
    if (r.accion === "no-op") return base;

    const cobraAntes = r.accion === "delete" || r.accion === "update" || r.accion === "replace";
    const cobraDespues = r.accion === "create" || r.accion === "update" || r.accion === "replace";

    const antes = cobraAntes
        ? await valuar(r.tipo, r.antes, { desconocidos: null, regionPorDefecto }, precio)
        : null;
    const despues = cobraDespues
        ? await valuar(r.tipo, r.despues, { desconocidos: r.desconocidos, regionPorDefecto }, precio)
        : null;

    // Si cualquiera de los dos estados no se puede valuar el delta no es confiable:
    // se informa el motivo y no un número a medias.
    const falla = despues && !despues.ok ? despues : antes && !antes.ok ? antes : null;
    if (falla && !falla.ok) return { ...base, motivo: falla.motivo };

    const mensualAntes = antes && antes.ok ? antes.mensual : 0;
    const mensualDespues = despues && despues.ok ? despues.mensual : 0;
    const detalle = despues && despues.ok ? despues : antes && antes.ok ? antes : null;
    const notas = [...new Set([
        ...(antes && antes.ok ? antes.notas : []),
        ...(despues && despues.ok ? despues.notas : []),
    ])];

    return {
        ...base,
        mensualAntes: redondear(mensualAntes),
        mensualDespues: redondear(mensualDespues),
        delta: redondear(mensualDespues - mensualAntes),
        ...(detalle ? { componentes: detalle.componentes } : {}),
        ...(notas.length ? { notas } : {}),
    };
}

/** `Promise.all` con tope, que conserva el orden. */
async function conLimite<T, R>(items: T[], limite: number, fn: (x: T) => Promise<R>): Promise<R[]> {
    const salida = new Array<R>(items.length);
    let siguiente = 0;
    const trabajadores = Array.from({ length: Math.min(limite, items.length) }, async () => {
        while (siguiente < items.length) {
            const i = siguiente++;
            salida[i] = await fn(items[i]);
        }
    });
    await Promise.all(trabajadores);
    return salida;
}

export interface OpcionesEstimacion {
    /** Se inyecta para poder testear sin red. Por defecto, la Retail API. */
    precio?: FuncionPrecio;
    /** Descuento del cliente sobre el precio de lista, 0–100. */
    descuentoPct?: number;
    /** Cuántos recursos se consultan a la vez. La Retail API responde 429 si se la castiga. */
    concurrencia?: number;
}

/**
 * Lee el what-if de un deployment de Bicep/ARM (`az deployment group what-if
 * --no-pretty-print`) y lo traduce a recursos del mismo catálogo que Terraform.
 * Ver iacCostCatalogArm.ts para el contrato y sus límites.
 */
export function leerWhatIf(whatIf: unknown): RecursoPlaneado[] {
    const w = whatIf as any;
    // La CLI entrega `changes` al tope; la REST lo anida en `properties`.
    const cambios = Array.isArray(w?.changes) ? w.changes : w?.properties?.changes;
    if (!Array.isArray(cambios)) return [];

    const salida: RecursoPlaneado[] = [];
    for (const c of cambios) {
        const tipoArm = tipoDeResourceId(c?.resourceId);
        if (!tipoArm) continue;
        const direccion = String(c.resourceId);
        const cambio = accionDeCambio(c?.changeType);
        const accionBase: AccionPlan = cambio === "no-soportado" ? "no-op" : cambio;
        const antes = objeto(c?.before);
        const despues = objeto(c?.after);
        const base = { desconocidos: null };

        if (SIN_COSTO_ARM.has(tipoArm)) {
            salida.push({ ...base, direccion, tipo: tipoArm, accion: accionBase, clase: "sin-costo", antes: null, despues: null });
        } else if (POR_USO_ARM.has(tipoArm)) {
            salida.push({ ...base, direccion, tipo: tipoArm, accion: accionBase, clase: "por-uso", antes: null, despues: null });
        } else if (CATALOGO_ARM[tipoArm] && cambio !== "no-soportado") {
            for (const par of CATALOGO_ARM[tipoArm](antes, despues)) {
                // Sin payload (`Deploy`, de ResourceIdOnly) no hay ni antes ni después: se deja
                // la acción del cambio para que el recurso salga "sin tarifar" y no desaparezca.
                const accion: AccionPlan = accionBase === "no-op" ? "no-op"
                    : par.antes && par.despues ? "update"
                    : par.despues ? "create"
                    : par.antes ? "delete"
                    : accionBase;
                salida.push({ ...base, direccion: direccion + par.sufijo, tipo: par.tipoTf, accion, clase: "costo", antes: par.antes, despues: par.despues });
            }
        } else {
            salida.push({ ...base, direccion, tipo: tipoArm, accion: accionBase, clase: "no-soportado", antes: null, despues: null });
        }
    }
    return salida;
}

export async function estimarPlan(plan: unknown, opciones: OpcionesEstimacion = {}): Promise<Estimacion> {
    return estimarRecursos(leerPlan(plan), opciones);
}

export async function estimarWhatIf(whatIf: unknown, opciones: OpcionesEstimacion = {}): Promise<Estimacion> {
    return estimarRecursos(leerWhatIf(whatIf), opciones);
}

export async function estimarRecursos(recursos: RecursoPlaneado[], opciones: OpcionesEstimacion = {}): Promise<Estimacion> {
    const regionPorDefecto = regionUnica(recursos);
    const precio = opciones.precio ?? precioRetail;

    const tarifadas = await conLimite(recursos, opciones.concurrencia ?? 4, (r) =>
        tarifarRecurso(r, precio, regionPorDefecto)
    );
    return resumir(tarifadas, opciones.descuentoPct ?? 0);
}

/** Suma las líneas y aplica el descuento del cliente. */
export function resumir(
    tarifadas: Array<LineaEstimacion & { _clase: ClaseRecurso }>, descuentoPct: number
): Estimacion {
    const d = Number.isFinite(descuentoPct) ? Math.min(Math.max(descuentoPct, 0), 100) : 0;
    const factor = 1 - d / 100;

    let sinTarifar = 0;
    let porUso = 0;
    let sinCosto = 0;

    const lineas: LineaEstimacion[] = tarifadas.map(({ _clase, ...l }) => {
        if (_clase === "sin-costo") sinCosto++;
        else if (l.motivo === "por-uso") porUso++;
        else if (l.motivo) sinTarifar++;

        if (d === 0) return l;
        const mensualAntes = redondear(l.mensualAntes * factor);
        const mensualDespues = redondear(l.mensualDespues * factor);
        return {
            ...l,
            listaAntes: l.mensualAntes,
            listaDespues: l.mensualDespues,
            mensualAntes,
            mensualDespues,
            delta: redondear(mensualDespues - mensualAntes),
            ...(l.componentes ? { componentes: l.componentes.map((c) => ({ ...c, mensual: redondear(c.mensual * factor) })) } : {}),
        };
    });

    const suma = (f: (l: LineaEstimacion) => number) => lineas.reduce((t, l) => t + f(l), 0);
    const mensualActual = redondear(suma((l) => l.mensualAntes));
    const mensualProyectado = redondear(suma((l) => l.mensualDespues));
    const listaActual = redondear(suma((l) => l.listaAntes ?? l.mensualAntes));
    const listaProyectada = redondear(suma((l) => l.listaDespues ?? l.mensualDespues));

    return {
        lineas,
        mensualActual,
        mensualProyectado,
        delta: redondear(mensualProyectado - mensualActual),
        listaActual,
        listaProyectada,
        listaDelta: redondear(listaProyectada - listaActual),
        descuentoPct: d,
        sinTarifar,
        porUso,
        sinCosto,
    };
}
