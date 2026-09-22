import { getMonthlyCostEstimate } from "@/services/pricingService";

/**
 * MEJ-20 — Shift-Left FinOps: estimar el delta de costo mensual de un PR a
 * partir de la salida de `terraform show -json <planfile>`.
 *
 * El punto de la mejora es mover la conversación de costo al momento del PR, que
 * es cuando todavía es barata. Hoy la plataforma es reactiva: detecta el gasto
 * una vez que el recurso ya está provisionado y costando.
 *
 * FORMATO DE ENTRADA, verificado y no supuesto. Los nombres de campo salen de un
 * plan REAL generado el 2026-09-22 con Terraform v1.15.8 y el provider azurerm
 * 4.x (`format_version: "1.2"`), no de la documentación: `resource_changes[]`
 * con `address`, `type`, `name` y `change.actions[]` / `change.before` /
 * `change.after`.
 *
 * POR QUÉ NO HAY UN CATÁLOGO DE PRECIOS NUEVO. MEJ-32 documenta la duplicación
 * de catálogos como bug recurrente de este repo, así que la tarificación
 * reusa `getMonthlyCostEstimate`, que ya cachea y ya normaliza por unidad.
 */

export type AccionPlan = "create" | "delete" | "update" | "replace" | "no-op";

export interface RecursoPlaneado {
    direccion: string;
    tipoTerraform: string;
    accion: AccionPlan;
    region: string;
    skuAntes: string | null;
    skuDespues: string | null;
    serviceName: string | null;
    /** Por qué no se pudo tarifar. Ausente cuando sí se pudo. */
    motivo?: "tipo-no-soportado" | "sin-sku" | "sin-region" | "sin-precio";
}

export interface LineaEstimacion extends RecursoPlaneado {
    mensualAntes: number;
    mensualDespues: number;
    delta: number;
}

export interface Estimacion {
    lineas: LineaEstimacion[];
    /** Suma de lo que ya existía, según el plan. */
    mensualActual: number;
    mensualProyectado: number;
    delta: number;
    /** Recursos que el plan toca y no se pudieron tarifar. */
    sinTarifar: number;
    /** Los que no cuestan nada por definición (RG, subnet, NIC…). */
    sinCosto: number;
}

/**
 * Tipos que NO generan cargo por sí mismos. Se listan explícitamente en vez de
 * dejarlos caer en "no soportado": un contador de 12 recursos sin tarifar que en
 * realidad son grupos de recursos y subredes hace desconfiar de todo el número.
 */
const SIN_COSTO = new Set([
    "azurerm_resource_group",
    "azurerm_subnet",
    "azurerm_virtual_network",
    "azurerm_network_interface",
    "azurerm_network_security_group",
    "azurerm_network_security_rule",
    "azurerm_route_table",
    "azurerm_subnet_network_security_group_association",
    "azurerm_network_interface_security_group_association",
    "azurerm_role_assignment",
    "azurerm_management_lock",
    "random_string",
    "random_password",
    "random_id",
]);

/**
 * Tamaños de disco por tier, de la tabla de learn.microsoft.com
 * (virtual-machines/disks-types, consultada el 2026-09-22). GiB provisionados.
 *
 * La regla de facturación que importa está en esa misma página: «Azure maps the
 * provisioned size (rounded up) to the nearest offered disk size» — un disco de
 * 200 GiB Standard SSD se factura como E15 (256 GiB), no como E10. Por eso la
 * búsqueda es el primer tier MAYOR O IGUAL, nunca el más cercano.
 */
const TIERS_DISCO: Record<string, Array<[string, number]>> = {
    Premium: [["P1", 4], ["P2", 8], ["P3", 16], ["P4", 32], ["P6", 64], ["P10", 128], ["P15", 256],
              ["P20", 512], ["P30", 1024], ["P40", 2048], ["P50", 4096], ["P60", 8192],
              ["P70", 16384], ["P80", 32767]],
    StandardSSD: [["E1", 4], ["E2", 8], ["E3", 16], ["E4", 32], ["E6", 64], ["E10", 128], ["E15", 256],
                  ["E20", 512], ["E30", 1024], ["E40", 2048], ["E50", 4096], ["E60", 8192],
                  ["E70", 16384], ["E80", 32767]],
    Standard: [["S4", 32], ["S6", 64], ["S10", 128], ["S15", 256], ["S20", 512], ["S30", 1024],
               ["S40", 2048], ["S50", 4096], ["S60", 8192], ["S70", 16384], ["S80", 32767]],
};

/**
 * `storage_account_type` de terraform (`Premium_LRS`, `StandardSSD_ZRS`…) +
 * tamaño → el `skuName` con el que la Retail API conoce al disco (`P10 LRS`).
 */
export function skuDeDisco(storageAccountType: unknown, diskSizeGb: unknown): string | null {
    const tipo = String(storageAccountType || "");
    const gb = Number(diskSizeGb);
    if (!tipo || !Number.isFinite(gb) || gb <= 0) return null;

    const corte = tipo.lastIndexOf("_");
    if (corte <= 0) return null;
    const familia = tipo.slice(0, corte);
    const redundancia = tipo.slice(corte + 1).toUpperCase();

    // PremiumV2 y Ultra se cobran por GiB/IOPS/throughput aprovisionados, no por
    // tier, así que no tienen un skuName que buscar.
    const tabla = TIERS_DISCO[familia];
    if (!tabla) return null;

    const tier = tabla.find(([, tamano]) => gb <= tamano);
    if (!tier) return null;

    return `${tier[0]} ${redundancia}`;
}

interface EntradaCatalogo {
    serviceName: string;
    campoSku: "skuName" | "armSkuName";
    sku: (attrs: Record<string, any>) => string | null;
}

/**
 * Tipo de terraform → cómo preguntarle el precio a la Retail API.
 *
 * `campoSku` no es decorativo: la API distingue `armSkuName` (`Standard_D2s_v3`)
 * de `skuName` (`P10 LRS`), y preguntar por el equivocado devuelve `Items: []`
 * con HTTP 200 — o sea un costo 0 silencioso, no un error.
 */
const CATALOGO: Record<string, EntradaCatalogo> = {
    azurerm_linux_virtual_machine: {
        serviceName: "Virtual Machines", campoSku: "armSkuName", sku: (a) => a.size || null,
    },
    azurerm_windows_virtual_machine: {
        serviceName: "Virtual Machines", campoSku: "armSkuName", sku: (a) => a.size || null,
    },
    azurerm_managed_disk: {
        serviceName: "Storage", campoSku: "skuName",
        sku: (a) => skuDeDisco(a.storage_account_type, a.disk_size_gb),
    },
    azurerm_public_ip: {
        serviceName: "Virtual Network", campoSku: "skuName", sku: (a) => a.sku || null,
    },
};

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

function region(attrs: Record<string, any> | null): string {
    return String(attrs?.location || "").trim().toLowerCase();
}

/** Lee el plan y devuelve qué hay que tarifar, sin consultar precios todavía. */
export function leerPlan(plan: unknown): RecursoPlaneado[] {
    const cambios = (plan as any)?.resource_changes;
    if (!Array.isArray(cambios)) return [];

    const salida: RecursoPlaneado[] = [];
    for (const rc of cambios) {
        const tipo = String(rc?.type || "");
        if (!tipo || SIN_COSTO.has(tipo)) {
            if (tipo) {
                salida.push({
                    direccion: String(rc?.address || tipo), tipoTerraform: tipo,
                    accion: accionDe(rc?.change?.actions), region: "",
                    skuAntes: null, skuDespues: null, serviceName: null,
                });
            }
            continue;
        }

        const antes = (rc?.change?.before ?? null) as Record<string, any> | null;
        const despues = (rc?.change?.after ?? null) as Record<string, any> | null;
        const entrada = CATALOGO[tipo];

        const base: RecursoPlaneado = {
            direccion: String(rc?.address || tipo),
            tipoTerraform: tipo,
            accion: accionDe(rc?.change?.actions),
            region: region(despues) || region(antes),
            skuAntes: entrada && antes ? entrada.sku(antes) : null,
            skuDespues: entrada && despues ? entrada.sku(despues) : null,
            serviceName: entrada?.serviceName ?? null,
        };

        if (!entrada) base.motivo = "tipo-no-soportado";
        else if (!base.skuAntes && !base.skuDespues) base.motivo = "sin-sku";
        else if (!base.region) base.motivo = "sin-region";

        salida.push(base);
    }
    return salida;
}

/**
 * Tarifa el plan. `precio` se inyecta para poder testear sin red; por defecto usa
 * la Retail API a través del helper cacheado.
 */
export async function estimarPlan(
    plan: unknown,
    precio: (serviceName: string, sku: string, region: string, campo: "skuName" | "armSkuName") => Promise<number> =
        (s, k, r, c) => getMonthlyCostEstimate(s, k, r, c),
): Promise<Estimacion> {
    const recursos = leerPlan(plan);
    const lineas: LineaEstimacion[] = [];
    let sinTarifar = 0;
    let sinCosto = 0;

    for (const r of recursos) {
        if (!r.serviceName && !r.motivo) {
            sinCosto++;
            lineas.push({ ...r, mensualAntes: 0, mensualDespues: 0, delta: 0 });
            continue;
        }
        if (r.motivo) {
            sinTarifar++;
            lineas.push({ ...r, mensualAntes: 0, mensualDespues: 0, delta: 0 });
            continue;
        }

        const campo = CATALOGO[r.tipoTerraform].campoSku;
        // Un `no-op` no cambia nada: no se gasta una llamada a la API en el.
        const cobraAntes = r.accion === "delete" || r.accion === "update" || r.accion === "replace";
        const cobraDespues = r.accion === "create" || r.accion === "update" || r.accion === "replace";

        const mensualAntes = cobraAntes && r.skuAntes
            ? await precio(r.serviceName!, r.skuAntes, r.region, campo) : 0;
        const mensualDespues = cobraDespues && r.skuDespues
            ? await precio(r.serviceName!, r.skuDespues, r.region, campo) : 0;

        const linea: LineaEstimacion = {
            ...r, mensualAntes, mensualDespues,
            delta: Number((mensualDespues - mensualAntes).toFixed(4)),
        };
        // Un precio 0 con sku y region validos significa que la API no conocia
        // ese medidor. Se marca: un cero silencioso se suma como si fuera gratis.
        if (mensualAntes === 0 && mensualDespues === 0 && r.accion !== "no-op") {
            linea.motivo = "sin-precio";
            sinTarifar++;
        }
        lineas.push(linea);
    }

    const mensualActual = lineas.reduce((t, l) => t + l.mensualAntes, 0);
    const mensualProyectado = lineas.reduce((t, l) => t + l.mensualDespues, 0);

    return {
        lineas,
        mensualActual: Number(mensualActual.toFixed(4)),
        mensualProyectado: Number(mensualProyectado.toFixed(4)),
        delta: Number((mensualProyectado - mensualActual).toFixed(4)),
        sinTarifar,
        sinCosto,
    };
}
