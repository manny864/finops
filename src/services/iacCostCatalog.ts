import { precioMensualDesdeUnidad } from "@/services/pricingService";
import type { ConsultaItems, ItemRetail } from "@/services/pricingService";

/**
 * MEJ-20 — catálogo del PR Cost Estimator: qué cobra Azure por cada tipo de
 * recurso de IaC y cómo se encuentra ese medidor en la Retail API.
 *
 * Todo mapeo de acá nace de DOS comprobaciones, no de la analogía con otro
 * servicio (la Retail API contesta 200 con `Items: []`, o con el medidor de
 * otro recurso, y el síntoma es un costo equivocado y no un error):
 *
 *  1. Los nombres de atributo salen del esquema del provider azurerm 4.81.0
 *     (`terraform providers schema -json`) y de un `terraform plan` real
 *     (2026-10-08, Terraform 1.15.8): `__tests__/fixtures/terraform-plan-azurerm-completo.json`.
 *  2. Los medidores salen de consultas reales a la Retail API de la misma fecha:
 *     `__tests__/fixtures/retail-prices-2026-10-08.json`. El test opt-in
 *     `iacCostCatalogLive.test.ts` vuelve a consultarla y falla si Azure cambió
 *     un nombre.
 *
 * ESTRUCTURA. Una *familia* sabe qué se cobra y a qué medidor mirar; un
 * *adaptador* (uno por IaC) sabe de qué atributo sale cada dato. Así Terraform y
 * Bicep comparten las reglas de precio y sólo difieren en cómo leen el recurso.
 *
 * REGLA DE ORO: informar de menos y decirlo. Lo que se cobra por consumo, o no se
 * pudo resolver, sale con un `motivo` o una `nota`; nunca como un cero mudo.
 */

export type Attrs = Record<string, any>;

export type MotivoSinTarifar =
    /** El tipo no está en el catálogo. */
    | "tipo-no-soportado"
    /** Falta un dato (SKU, tamaño) que el plan no trae y no es "desconocido hasta aplicar". */
    | "sin-sku"
    | "sin-region"
    /** La API contestó y no existe el medidor. */
    | "sin-precio"
    /** Se cobra por consumo (GB, transacciones, tokens): no hay precio fijo que estimar. */
    | "por-uso"
    /** El valor existe pero Terraform lo resuelve recién en el apply (SKU calculado, autoescalado). */
    | "valor-al-aplicar"
    /** No se pudo preguntar (429, caída): reintentar más tarde sirve. */
    | "precio-no-disponible";

export interface Componente {
    /** Qué parte del recurso es: cómputo, disco del SO, SLA del plano de control. */
    etiqueta: string;
    consulta: ConsultaItems;
    /** Elige, entre los items de la consulta, el medidor de este componente. */
    elegir: (items: ItemRetail[]) => ItemRetail | null;
    /** Nodos, instancias, unidades: el precio del medidor se multiplica por esto. */
    cantidad: number;
}

export type Resultado =
    | { componentes: Componente[]; notas: string[] }
    | { motivo: MotivoSinTarifar; nota?: string };

export interface ContextoLinea {
    /** `after_unknown` de Terraform: qué valores se definen recién al aplicar. */
    desconocidos: Attrs | null;
    /** La única región del plan, para recursos que no traen `location` (node pools, bases SQL). */
    regionPorDefecto: string | null;
}

export interface EntradaTf {
    familia: string;
    /** Atributos de primer nivel que lee. El script de CI sólo envía estos. */
    campos: string[];
    /** Claves que lee dentro de los bloques anidados (os_disk, default_node_pool...). */
    camposAnidados?: string[];
    construir(attrs: Attrs, ctx: ContextoLinea): Resultado;
}

// ───────────────────────── utilidades de lectura ─────────────────────────

export function normalizarRegion(v: unknown): string {
    return String(v ?? "").toLowerCase().replace(/[\s_-]+/g, "");
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function numero(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Los bloques anidados de Terraform viajan como lista de un elemento. */
function bloque(attrs: Attrs | null | undefined, nombre: string): Attrs | null {
    const v = attrs?.[nombre];
    if (Array.isArray(v)) return (v[0] as Attrs) ?? null;
    return v && typeof v === "object" ? (v as Attrs) : null;
}

function lista(attrs: Attrs | null | undefined, nombre: string): Attrs[] {
    const v = attrs?.[nombre];
    return Array.isArray(v) ? (v as Attrs[]) : [];
}

/** ¿`after_unknown` marca este camino como definido recién al aplicar? */
function esDesconocido(ctx: ContextoLinea, ...ruta: Array<string | number>): boolean {
    let nodo: any = ctx.desconocidos;
    for (const paso of ruta) {
        if (nodo === null || nodo === undefined || typeof nodo !== "object") return false;
        nodo = nodo[paso];
    }
    return nodo === true;
}

function faltante(ctx: ContextoLinea, ...ruta: Array<string | number>): Resultado {
    return { motivo: esDesconocido(ctx, ...ruta) ? "valor-al-aplicar" : "sin-sku" };
}

type ResolucionRegion = { region: string; notas: string[] } | { motivo: MotivoSinTarifar };

function regionDe(attrs: Attrs, ctx: ContextoLinea): ResolucionRegion {
    const propia = normalizarRegion(attrs.location);
    if (propia) return { region: propia, notas: [] };
    if (ctx.regionPorDefecto) return { region: ctx.regionPorDefecto, notas: ["region-inferida"] };
    return { motivo: esDesconocido(ctx, "location") ? "valor-al-aplicar" : "sin-region" };
}

// ───────────────────────── selección de medidores ─────────────────────────

const quitarEspacios = (s: unknown): string => String(s ?? "").toLowerCase().replace(/\s+/g, "");
const porHora = (i: ItemRetail): boolean =>
    /hour/i.test(i.unitOfMeasure) && precioMensualDesdeUnidad(i.retailPrice, i.unitOfMeasure) !== null;
const convertible = (i: ItemRetail): boolean => precioMensualDesdeUnidad(i.retailPrice, i.unitOfMeasure) !== null;
const primerNivel = (i: ItemRetail): boolean => !i.tierMinimumUnits;
const esSpot = (i: ItemRetail): boolean => /spot/i.test(`${i.skuName} ${i.meterName}`);
const esBajaPrioridad = (i: ItemRetail): boolean => /low priority/i.test(`${i.skuName} ${i.meterName}`);
const esWindows = (i: ItemRetail): boolean => /windows/i.test(i.productName);

/**
 * Entre medidores equivalentes se queda con el de vigencia más reciente, sin
 * mirar el orden en que la API los devuelve: no está garantizado y ya se
 * demostró que no sirve (el primero de una VM era un Spot de Windows).
 */
export function masReciente(items: ItemRetail[], ahora: number = Date.now()): ItemRetail | null {
    const vigentes = items.filter((i) => !i.effectiveStartDate || Date.parse(i.effectiveStartDate) <= ahora);
    const base = vigentes.length ? vigentes : items;
    const fecha = (i: ItemRetail) => Date.parse(i.effectiveStartDate ?? "") || 0;
    return [...base].sort((a, b) => fecha(b) - fecha(a))[0] ?? null;
}

export function elegirVm(items: ItemRetail[], o: { windows: boolean; spot: boolean }): ItemRetail | null {
    return masReciente(
        items.filter(
            (i) =>
                porHora(i) && primerNivel(i) && !esBajaPrioridad(i) &&
                (o.spot ? esSpot(i) : !esSpot(i)) &&
                (o.windows ? esWindows(i) : !esWindows(i))
        )
    );
}

/** `P20 ZRS` tiene dos medidores "P20 ZRS Disk": el de Managed Disks y el de Page Blob. */
export function elegirDisco(items: ItemRetail[], sku: string): ItemRetail | null {
    const nombre = `${sku} disk`.toLowerCase();
    return masReciente(
        items.filter((i) => String(i.meterName).toLowerCase() === nombre && /managed disks/i.test(i.productName) && convertible(i))
    );
}

/**
 * Terraform `storage_account_type` (`Premium_LRS`, `StandardSSD_ZRS`…) + tamaño →
 * el `skuName` con el que la Retail API conoce al disco (`P10 LRS`).
 *
 * La regla de facturación está en Learn (virtual-machines/disks-types): «Azure
 * maps the provisioned size (rounded up) to the nearest offered disk size», así
 * que un disco de 200 GiB Standard SSD se factura como E15 (256 GiB), no como
 * E10. Por eso la búsqueda es el primer tier MAYOR O IGUAL.
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

export function elegirIp(items: ItemRetail[], o: { sku: string; ipv: 4 | 6; estatica: boolean }): ItemRetail | null {
    // `skuName eq 'Standard'` también trae "Public IP Prefix" (0,006 contra 0,005 de
    // la IP): la mezcla de productos es la que obliga a mirar productName.
    const medidor = quitarEspacios(`${o.sku} IPv${o.ipv} ${o.estatica ? "Static" : "Dynamic"} Public IP`);
    return masReciente(
        items.filter((i) => /ip addresses/i.test(i.productName) && quitarEspacios(i.meterName) === medidor && porHora(i))
    );
}

/**
 * `P1v3` y `P1 v3` son el mismo plan: Terraform lo escribe sin espacio y la API
 * con espacio (pero `P0v3` y `P1mv3` sin él). Se compara sin espacios.
 */
export function elegirPlanAppService(items: ItemRetail[], o: { sku: string; linux: boolean }): ItemRetail | null {
    const objetivo = quitarEspacios(o.sku);
    return masReciente(
        items.filter((i) => {
            if (quitarEspacios(i.skuName) !== objetivo || !/ plan/i.test(i.productName) || !porHora(i)) return false;
            if (/container|isolated|environment|workflow|logic/i.test(i.productName)) return false;
            const esLinux = /- linux$/i.test(i.productName.trim());
            return o.linux ? esLinux : !esLinux;
        })
    );
}

const porMedidor = (nombre: string, extra?: (i: ItemRetail) => boolean) => (items: ItemRetail[]): ItemRetail | null =>
    masReciente(
        items.filter(
            (i) => quitarEspacios(i.meterName) === quitarEspacios(nombre) && convertible(i) && primerNivel(i) && (extra ? extra(i) : true)
        )
    );

// ───────────────────────── constructores de componentes ─────────────────────────

const consulta = (serviceName: string, region: string, filtro?: ConsultaItems["filtro"]): ConsultaItems => ({
    serviceName, region, ...(filtro ? { filtro } : {}),
});

function compVm(region: string, size: string, o: { windows: boolean; spot: boolean }, cantidad: number, etiqueta = "cómputo"): Componente {
    return {
        etiqueta,
        consulta: consulta("Virtual Machines", region, { campo: "armSkuName", valor: size }),
        elegir: (i) => elegirVm(i, o),
        cantidad,
    };
}

function compDisco(region: string, skuDisco: string, cantidad: number, etiqueta: string): Componente {
    return {
        etiqueta,
        consulta: consulta("Storage", region, { campo: "skuName", valor: skuDisco }),
        elegir: (i) => elegirDisco(i, skuDisco),
        cantidad,
    };
}

function discoDelSo(os: Attrs | null, region: string, cantidad: number): Componente | null {
    if (!os) return null;
    const sku = skuDeDisco(os.storage_account_type, os.disk_size_gb);
    return sku ? compDisco(region, sku, cantidad, "disco del SO") : null;
}

function nodosDe(pool: Attrs): { cantidad: number | null; piso: boolean } {
    const fijo = numero(pool.node_count);
    if (fijo !== null) return { cantidad: fijo, piso: false };
    // Con autoescalado `node_count` no se declara; el mínimo es lo único seguro.
    const minimo = numero(pool.min_count);
    return pool.auto_scaling_enabled && minimo !== null ? { cantidad: minimo, piso: true } : { cantidad: null, piso: false };
}

// ───────────────────────── adaptadores de Terraform ─────────────────────────

function vmTf(windows: boolean): EntradaTf {
    return {
        familia: "vm",
        campos: ["location", "size", "priority", "license_type", "os_disk"],
        camposAnidados: ["storage_account_type", "disk_size_gb"],
        construir(a, ctx) {
            const r = regionDe(a, ctx);
            if ("motivo" in r) return r;
            const size = texto(a.size);
            if (!size) return faltante(ctx, "size");

            const spot = texto(a.priority).toLowerCase() === "spot";
            // Con Azure Hybrid Benefit o licencia de cliente no se paga la licencia
            // de Windows: el precio es el de la VM sin sistema operativo cobrado.
            const licenciaPropia = /^windows_(server|client)$/i.test(texto(a.license_type));
            const notas = [...r.notas];
            if (spot) notas.push("spot-variable");

            const comps = [compVm(r.region, size, { windows: windows && !licenciaPropia, spot }, 1)];
            const disco = discoDelSo(bloque(a, "os_disk"), r.region, 1);
            if (disco) comps.push(disco);
            else notas.push("disco-os-no-incluido");
            return { componentes: comps, notas };
        },
    };
}

function vmssTf(campoSku: "sku" | "sku_name", windows: boolean): EntradaTf {
    return {
        familia: "vmss",
        campos: ["location", campoSku, "instances", "priority", "license_type", "os_disk"],
        camposAnidados: ["storage_account_type", "disk_size_gb"],
        construir(a, ctx) {
            const r = regionDe(a, ctx);
            if ("motivo" in r) return r;
            const size = texto(a[campoSku]);
            if (!size || size.toLowerCase() === "mix") return faltante(ctx, campoSku);
            const instancias = numero(a.instances);
            if (instancias === null) return { motivo: "valor-al-aplicar" };

            const spot = texto(a.priority).toLowerCase() === "spot";
            const notas = [...r.notas];
            if (spot) notas.push("spot-variable");
            const licenciaPropia = /^windows_(server|client)$/i.test(texto(a.license_type));
            const comps = [compVm(r.region, size, { windows: windows && !licenciaPropia, spot }, instancias)];
            const disco = discoDelSo(bloque(a, "os_disk"), r.region, instancias);
            if (disco) comps.push(disco);
            else notas.push("disco-os-no-incluido");
            return { componentes: comps, notas };
        },
    };
}

const aksSla = (region: string, tier: string): Componente[] =>
    /^(standard|premium)$/i.test(tier)
        ? [{
            etiqueta: "SLA de disponibilidad",
            consulta: consulta("Azure Kubernetes Service", region, { campo: "skuName", valor: "Standard" }),
            elegir: porMedidor("Standard Uptime SLA", porHora),
            cantidad: 1,
        }]
        : [];

function poolAks(
    pool: Attrs, region: string, windows: boolean, ctx: ContextoLinea, ruta: Array<string | number>, etiqueta: string
): { comp: Componente; notas: string[] } | { motivo: MotivoSinTarifar } {
    const size = texto(pool.vm_size);
    if (!size) return { motivo: esDesconocido(ctx, ...ruta, "vm_size") ? "valor-al-aplicar" : "sin-sku" };
    const n = nodosDe(pool);
    if (n.cantidad === null) return { motivo: "valor-al-aplicar" };
    const spot = texto(pool.priority).toLowerCase() === "spot";
    return {
        comp: compVm(region, size, { windows, spot }, n.cantidad, etiqueta),
        notas: [...(n.piso ? ["autoescalado-minimo"] : []), ...(spot ? ["spot-variable"] : [])],
    };
}

const aksCluster: EntradaTf = {
    familia: "aks",
    campos: ["location", "sku_tier", "default_node_pool"],
    camposAnidados: ["vm_size", "node_count", "min_count", "max_count", "auto_scaling_enabled"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        const pool = bloque(a, "default_node_pool");
        if (!pool) return faltante(ctx, "default_node_pool");

        const p = poolAks(pool, r.region, false, ctx, ["default_node_pool", 0], "nodos del pool del sistema");
        if ("motivo" in p) return p;

        const tier = texto(a.sku_tier) || "Free";
        // Premium suma soporte extendido (LTS) cuyo precio no está documentado en
        // Learn de forma que permita sumarlo con certeza: se cobra el SLA y se avisa.
        const notas = [...r.notas, ...p.notas, "discos-os-no-incluidos", ...(/^premium$/i.test(tier) ? ["lts-no-incluido"] : [])];
        return { componentes: [p.comp, ...aksSla(r.region, tier)], notas };
    },
};

const aksNodePool: EntradaTf = {
    familia: "aks",
    campos: ["location", "vm_size", "node_count", "os_type", "priority", "min_count", "auto_scaling_enabled"],
    construir(a, ctx) {
        // En Terraform el node pool no trae `location`: la región es la del clúster y el plan
        // no la dice hasta aplicar, así que se infiere de lo demás. Un what-if de Bicep sí la trae.
        const propia = normalizarRegion(a.location);
        const region = propia || ctx.regionPorDefecto;
        if (!region) return { motivo: "sin-region" };
        const windows = /^windows$/i.test(texto(a.os_type));
        const p = poolAks(a, region, windows, ctx, [], "nodos");
        if ("motivo" in p) return p;
        return { componentes: [p.comp], notas: [...(propia ? [] : ["region-inferida"]), "discos-os-no-incluidos", ...p.notas] };
    },
};

const servicePlan: EntradaTf = {
    familia: "app-service-plan",
    campos: ["location", "sku_name", "os_type", "worker_count"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        const sku = texto(a.sku_name);
        if (!sku) return faltante(ctx, "sku_name");
        const so = texto(a.os_type);
        if (!/^(linux|windows)$/i.test(so)) return { motivo: "sin-sku", nota: "plan-de-contenedores" };

        // Y1 (Consumption) se cobra por ejecución; EP*/WS* por vCPU y memoria por
        // segundo; I*v2 suma un App Service Environment: nada de eso es un precio fijo.
        if (/^y1$/i.test(sku)) return { motivo: "por-uso" };
        if (/^(ep|ws|fc|i)\d/i.test(sku)) return { motivo: "sin-sku", nota: "plan-no-soportado" };

        // D1 (Shared) lo publica la API como "Shared".
        const skuApi = /^d1$/i.test(sku) ? "Shared" : sku;
        const workers = numero(a.worker_count) ?? 1;
        return {
            componentes: [{
                etiqueta: "plan",
                consulta: consulta("Azure App Service", r.region),
                elegir: (i) => elegirPlanAppService(i, { sku: skuApi, linux: /^linux$/i.test(so) }),
                cantidad: workers,
            }],
            notas: r.notas,
        };
    },
};

const redis: EntradaTf = {
    familia: "redis",
    campos: ["location", "sku_name", "family", "capacity", "shard_count"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        const sku = texto(a.sku_name);
        const familia = texto(a.family).toUpperCase();
        const capacidad = numero(a.capacity);
        if (!sku || !familia || capacidad === null) return faltante(ctx, "sku_name");

        const corta = `${familia}${capacidad}`;
        // "C1 Cache" cobra el caché completo (con réplica en Standard/Premium);
        // "C1 Cache Instance" es sólo un nodo: por eso se pide el nombre exacto.
        return {
            componentes: [{
                etiqueta: "caché",
                consulta: consulta("Redis Cache", r.region, { campo: "skuName", valor: corta }),
                elegir: porMedidor(`${corta} Cache`, (i) => i.productName === `Azure Redis Cache ${sku}` && porHora(i)),
                cantidad: Math.max(1, numero(a.shard_count) ?? 1),
            }],
            notas: r.notas,
        };
    },
};

const firewall: EntradaTf = {
    familia: "firewall",
    campos: ["location", "sku_name", "sku_tier"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        const tier = texto(a.sku_tier);
        if (!tier) return faltante(ctx, "sku_tier");
        // AZFW_Hub (Secured Virtual Hub) se publica con otros medidores.
        if (/hub/i.test(texto(a.sku_name))) return { motivo: "sin-sku", nota: "firewall-en-virtual-hub" };
        return {
            componentes: [{
                etiqueta: "despliegue",
                consulta: consulta("Azure Firewall", r.region, { campo: "skuName", valor: tier }),
                elegir: porMedidor(`${tier} Deployment`, porHora),
                cantidad: 1,
            }],
            notas: [...r.notas, "datos-procesados-no-incluidos"],
        };
    },
};

const bastion: EntradaTf = {
    familia: "bastion",
    campos: ["location", "sku", "scale_units"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        const sku = texto(a.sku) || "Basic";
        if (!/^(basic|standard|premium)$/i.test(sku)) return { motivo: "sin-sku", nota: "bastion-developer" };
        const nombre = sku[0].toUpperCase() + sku.slice(1).toLowerCase();
        // Learn no documenta cómo se factura cada instancia más allá de las dos
        // base, así que se cobra el medidor del gateway y se avisa.
        const notas = [...r.notas, ...((numero(a.scale_units) ?? 2) > 2 ? ["instancias-adicionales-no-incluidas"] : [])];
        return {
            componentes: [{
                etiqueta: "gateway",
                consulta: consulta("Azure Bastion", r.region, { campo: "skuName", valor: nombre }),
                elegir: porMedidor(`${nombre} Gateway`, porHora),
                cantidad: 1,
            }],
            notas: [...notas, "transferencia-no-incluida"],
        };
    },
};

const vpnGateway: EntradaTf = {
    familia: "vpn-gateway",
    campos: ["location", "sku", "type"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        // ExpressRoute se publica en otro servicio con otros medidores.
        if (!/^vpn$/i.test(texto(a.type))) return { motivo: "sin-sku", nota: "gateway-expressroute" };
        const sku = texto(a.sku);
        if (!sku) return faltante(ctx, "sku");
        return {
            componentes: [{
                etiqueta: "gateway",
                consulta: consulta("VPN Gateway", r.region, { campo: "skuName", valor: sku }),
                elegir: (items) =>
                    masReciente(
                        items.filter(
                            (i) =>
                                [quitarEspacios(sku), quitarEspacios(`${sku} Gateway`)].includes(quitarEspacios(i.meterName)) &&
                                porHora(i) && primerNivel(i)
                        )
                    ),
                cantidad: 1,
            }],
            notas: [...r.notas, "transferencia-no-incluida"],
        };
    },
};

const PRODUCTO_APPGW_V2: Record<string, { producto: string; medidor: string }> = {
    standard_v2: { producto: "Application Gateway Standard v2", medidor: "Standard Fixed Cost" },
    waf_v2: { producto: "Application Gateway WAF v2", medidor: "Standard Fixed Cost" },
    basic: { producto: "Application Gateway Basic v2", medidor: "Basic Fixed Cost" },
};

const appGateway: EntradaTf = {
    familia: "application-gateway",
    campos: ["location", "sku", "autoscale_configuration"],
    camposAnidados: ["name", "tier", "capacity", "min_capacity", "max_capacity"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        const sku = bloque(a, "sku");
        const nombre = texto(sku?.name);
        if (!nombre) return faltante(ctx, "sku");

        const v2 = PRODUCTO_APPGW_V2[nombre.toLowerCase()];
        if (v2) {
            return {
                componentes: [{
                    etiqueta: "costo fijo",
                    consulta: consulta("Application Gateway", r.region),
                    elegir: (items) => masReciente(
                        items.filter((i) => i.productName === v2.producto && i.meterName === v2.medidor && porHora(i))
                    ),
                    cantidad: 1,
                }],
                notas: [...r.notas, "unidades-de-capacidad-no-incluidas"],
            };
        }

        // v1: Standard_Small/Medium/Large y WAF_Medium/Large.
        const v1 = nombre.match(/^(WAF|Standard)_(Small|Medium|Large)$/i);
        if (!v1) return { motivo: "sin-sku", nota: "appgw-sku-desconocido" };
        const tamano = v1[2][0].toUpperCase() + v1[2].slice(1).toLowerCase();
        const producto = /^waf$/i.test(v1[1]) ? "WAF Application Gateway" : "Basic Application Gateway";
        return {
            componentes: [{
                etiqueta: "gateway",
                consulta: consulta("Application Gateway", r.region),
                elegir: (items) => masReciente(
                    items.filter((i) => i.productName === producto && i.meterName === `${tamano} Gateway` && porHora(i) && primerNivel(i))
                ),
                cantidad: Math.max(1, numero(sku?.capacity) ?? 1),
            }],
            notas: [...r.notas, "datos-procesados-no-incluidos"],
        };
    },
};

const containerRegistry: EntradaTf = {
    familia: "container-registry",
    campos: ["location", "sku", "georeplications"],
    camposAnidados: ["location"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        const sku = texto(a.sku);
        if (!/^(basic|standard|premium)$/i.test(sku)) return faltante(ctx, "sku");
        const nombre = sku[0].toUpperCase() + sku.slice(1).toLowerCase();

        const comps: Componente[] = [{
            etiqueta: "registro",
            consulta: consulta("Container Registry", r.region, { campo: "skuName", valor: nombre }),
            elegir: porMedidor(`${nombre} Registry Unit`),
            cantidad: 1,
        }];
        // Cada réplica geográfica de un Premium es otra unidad de registro, cobrada
        // en la región de la réplica.
        if (/^premium$/i.test(nombre)) {
            for (const g of lista(a, "georeplications")) {
                const regionReplica = normalizarRegion(g.location);
                if (!regionReplica) continue;
                comps.push({
                    etiqueta: `réplica en ${regionReplica}`,
                    consulta: consulta("Container Registry", regionReplica, { campo: "skuName", valor: nombre }),
                    elegir: porMedidor("Premium Registry Replication Unit"),
                    cantidad: 1,
                });
            }
        }
        return { componentes: comps, notas: [...r.notas, "almacenamiento-no-incluido"] };
    },
};

const natGateway: EntradaTf = {
    familia: "nat-gateway",
    campos: ["location", "sku_name"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        if (texto(a.sku_name) && !/^standard$/i.test(texto(a.sku_name))) return { motivo: "sin-sku", nota: "nat-sku-no-soportado" };
        // La Retail API publica NAT Gateway y Load Balancer como `Global`, sin región.
        return {
            componentes: [{
                etiqueta: "gateway",
                consulta: consulta("NAT Gateway", "Global"),
                elegir: porMedidor("Standard Gateway", (i) => i.skuName === "Standard" && porHora(i)),
                cantidad: 1,
            }],
            notas: [...r.notas, "datos-procesados-no-incluidos"],
        };
    },
};

const loadBalancer: EntradaTf = {
    familia: "load-balancer",
    campos: ["location", "sku", "sku_tier"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        const sku = texto(a.sku) || "Basic";
        if (!/^(standard|gateway)$/i.test(sku)) return { motivo: "sin-sku", nota: "lb-basic-retirado" };
        const global = /^global$/i.test(texto(a.sku_tier));
        const skuApi = global ? "Global" : sku[0].toUpperCase() + sku.slice(1).toLowerCase();
        const medidor = /^gateway$/i.test(sku) ? "Gateway" : `${skuApi} Included LB Rules and Outbound Rules`;
        return {
            componentes: [{
                etiqueta: "reglas incluidas",
                consulta: consulta("Load Balancer", "Global"),
                elegir: porMedidor(medidor, (i) => i.skuName === skuApi && porHora(i)),
                cantidad: 1,
            }],
            notas: [...r.notas, "reglas-adicionales-y-datos-no-incluidos"],
        };
    },
};

const publicIp: EntradaTf = {
    familia: "public-ip",
    campos: ["location", "sku", "sku_tier", "allocation_method", "ip_version"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        const global = /^global$/i.test(texto(a.sku_tier));
        const sku = global ? "Global" : texto(a.sku) || "Standard";
        if (!/^(basic|standard|global)$/i.test(sku)) return { motivo: "sin-sku" };
        const nombre = sku[0].toUpperCase() + sku.slice(1).toLowerCase();
        const ipv = /^ipv6$/i.test(texto(a.ip_version)) ? 6 : 4;
        const estatica = /^static$/i.test(texto(a.allocation_method));
        return {
            componentes: [{
                etiqueta: "IP pública",
                consulta: consulta("Virtual Network", r.region, { campo: "skuName", valor: nombre }),
                elegir: (i) => elegirIp(i, { sku: nombre, ipv, estatica }),
                cantidad: 1,
            }],
            notas: r.notas,
        };
    },
};

const managedDisk: EntradaTf = {
    familia: "disco",
    campos: ["location", "storage_account_type", "disk_size_gb"],
    construir(a, ctx) {
        const r = regionDe(a, ctx);
        if ("motivo" in r) return r;
        const tipo = texto(a.storage_account_type);
        if (!tipo) return faltante(ctx, "storage_account_type");
        if (numero(a.disk_size_gb) === null) return faltante(ctx, "disk_size_gb");
        const sku = skuDeDisco(tipo, a.disk_size_gb);
        // PremiumV2 y Ultra se cobran por GiB, IOPS y throughput aprovisionados.
        if (!sku) return { motivo: "sin-sku", nota: "disco-por-capacidad-aprovisionada" };
        return { componentes: [compDisco(r.region, sku, 1, "disco")], notas: r.notas };
    },
};

export const CATALOGO_TF: Record<string, EntradaTf> = {
    azurerm_linux_virtual_machine: vmTf(false),
    azurerm_windows_virtual_machine: vmTf(true),
    azurerm_linux_virtual_machine_scale_set: vmssTf("sku", false),
    azurerm_windows_virtual_machine_scale_set: vmssTf("sku", true),
    azurerm_orchestrated_virtual_machine_scale_set: vmssTf("sku_name", false),
    azurerm_kubernetes_cluster: aksCluster,
    azurerm_kubernetes_cluster_node_pool: aksNodePool,
    azurerm_service_plan: servicePlan,
    azurerm_redis_cache: redis,
    azurerm_firewall: firewall,
    azurerm_bastion_host: bastion,
    azurerm_virtual_network_gateway: vpnGateway,
    azurerm_application_gateway: appGateway,
    azurerm_container_registry: containerRegistry,
    azurerm_nat_gateway: natGateway,
    azurerm_lb: loadBalancer,
    azurerm_public_ip: publicIp,
    azurerm_managed_disk: managedDisk,
};

/**
 * Tipos que NO generan cargo por sí mismos. Se listan explícitamente en vez de
 * dejarlos caer en "no soportado": un contador de 12 recursos sin tarifar que en
 * realidad son grupos de recursos y subredes hace desconfiar de todo el número.
 */
export const SIN_COSTO = new Set([
    "azurerm_resource_group",
    "azurerm_subnet",
    "azurerm_virtual_network",
    "azurerm_network_interface",
    "azurerm_network_security_group",
    "azurerm_network_security_rule",
    "azurerm_route_table",
    "azurerm_route",
    "azurerm_subnet_network_security_group_association",
    "azurerm_subnet_route_table_association",
    "azurerm_network_interface_security_group_association",
    "azurerm_nat_gateway_public_ip_association",
    "azurerm_lb_backend_address_pool",
    "azurerm_lb_probe",
    "azurerm_lb_rule",
    "azurerm_lb_nat_rule",
    "azurerm_role_assignment",
    "azurerm_user_assigned_identity",
    "azurerm_management_lock",
    // La app vive en el plan, que es lo que cobra.
    "azurerm_linux_web_app",
    "azurerm_windows_web_app",
    "azurerm_virtual_machine_extension",
    "azurerm_virtual_machine_data_disk_attachment",
    "random_string",
    "random_password",
    "random_id",
    "random_pet",
]);

/**
 * Se cobran por consumo (GB almacenados, transacciones, ingesta, tokens, ejecuciones):
 * no existe un precio fijo que estimar, y llamarlos "no soportados" confundiría —
 * el usuario tiene que saber que ese gasto va a existir y de qué depende.
 */
export const POR_USO = new Set([
    "azurerm_storage_account",
    "azurerm_log_analytics_workspace",
    "azurerm_application_insights",
    "azurerm_key_vault",
    "azurerm_servicebus_namespace",
    "azurerm_eventhub_namespace",
    "azurerm_cosmosdb_account",
    "azurerm_linux_function_app",
    "azurerm_windows_function_app",
    "azurerm_cognitive_account",
    "azurerm_data_factory",
    "azurerm_monitor_diagnostic_setting",
]);

/** Para el test que compara el catálogo con el script de CI. */
export function camposDelCatalogo(): { campos: string[]; anidados: string[] } {
    const campos = new Set<string>();
    const anidados = new Set<string>();
    for (const e of Object.values(CATALOGO_TF)) {
        e.campos.forEach((c) => campos.add(c));
        (e.camposAnidados ?? []).forEach((c) => anidados.add(c));
    }
    return { campos: [...campos].sort(), anidados: [...anidados].sort() };
}
