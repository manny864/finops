import { HOURS_PER_MONTH } from "@/lib/aroUtils";

/**
 * Lleva un precio de la Retail API a USD/mes leyendo su `unitOfMeasure`.
 *
 * ANTES SE MULTIPLICABA POR 730 SIEMPRE, y eso estaba mal para todo lo que no
 * se cobra por hora. Verificado contra la API el 2026-09-22: un disco
 * administrado P10 LRS en eastus devuelve `retailPrice: 19.71` con
 * `unitOfMeasure: "1/Month"` --ya es el precio mensual--, asi que el x730 lo
 * convertia en **$14.388,30 por mes**. Ese numero salia en la pantalla de
 * Zombis como "ahorro potencial" de borrar un disco que cuesta 19,71.
 *
 * Lo perverso del caso: el llamador tiene un fallback sano
 * (`cost = price || diskSizeGB * 0.15`) que solo se usa cuando la API FALLA. O
 * sea que el numero era razonable cuando no habia precio y disparatado cuando
 * si lo habia.
 *
 * Devuelve null cuando la unidad necesita una cantidad que este helper no
 * recibe (por GB, por 10.000 operaciones, por transaccion). Ahi el llamador
 * cae a su propia estimacion, que es preferible a inventar una cifra: en un
 * producto de costos, un ahorro inflado es peor que no dar ninguno.
 */
export function precioMensualDesdeUnidad(
    retailPrice: number,
    unitOfMeasure: string | null | undefined
): number | null {
    const u = (unitOfMeasure || "").trim().toLowerCase();
    if (!u || !Number.isFinite(retailPrice)) return null;

    // "1 Hour", "10 Hours" y "1/Hour" (Application Gateway, reglas de Load
    // Balancer): la barra aparece en algunos medidores y no en otros.
    const horas = u.match(/^(\d+(?:\.\d+)?)\s*\/?\s*hours?$/);
    if (horas && Number(horas[1]) > 0) return (retailPrice / Number(horas[1])) * HOURS_PER_MONTH;

    // "1/Month", "1 Month"
    const meses = u.match(/^(\d+(?:\.\d+)?)\s*\/?\s*months?$/);
    if (meses && Number(meses[1]) > 0) return retailPrice / Number(meses[1]);

    // "1 Day", "30 Days" y "1/Day" (Container Registry)
    const dias = u.match(/^(\d+(?:\.\d+)?)\s*\/?\s*days?$/);
    if (dias && Number(dias[1]) > 0) return (retailPrice / Number(dias[1])) * (HOURS_PER_MONTH / 24);

    return null;
}

/**
 * De los medidores que devuelve la Retail API para un SKU, cuál es el que cobra
 * el recurso en sí.
 *
 * NO alcanza con `Items[0]`, y el caso que lo demuestra está medido contra la API
 * el 2026-09-22: `skuName eq 'P20 ZRS'` en eastus devuelve tres medidores y el
 * PRIMERO es el equivocado.
 *
 *     P20 ZRS Disk Mount      3.285  1/Month   <- Items[0]
 *     P20 ZRS Disk          109.810  1/Month   <- el disco
 *     P20 ZRS Disk          109.830  1/Month
 *
 * O sea que el disco se cotizaba a 3,28 en vez de 109,81: 33 veces menos. Con
 * `S10 LRS` es otra variante del mismo problema — el primero es
 * "S10 LRS Disk Operations", que se cobra por 10.000 operaciones y ni siquiera
 * es convertible a un costo mensual fijo.
 *
 * Y como siempre con esta API, nada falla: responde 200 con datos, sólo que no
 * son los del recurso que se preguntó.
 *
 * Reglas, en orden: el medidor de capacidad se llama exactamente
 * `"<skuName> Disk"`; si no está, el primero cuya unidad sí se pueda llevar a
 * mensual (eso descarta los de operaciones y transferencia).
 *
 * NO ES PARA VMs: un tamaño trae filas Linux, Windows, Spot y Low Priority, y "el
 * primero convertible" puede ser cualquiera de las seis. Las VMs las resuelve
 * `elegirVm` desde `getMonthlyCostEstimate`.
 */
export function elegirMedidor(items: any[], skuName: string): any | null {
    if (!Array.isArray(items) || items.length === 0) return null;

    const nombreCapacidad = `${skuName} Disk`.toLowerCase();
    const capacidad = items.find((i) => String(i?.meterName || "").toLowerCase() === nombreCapacidad);
    if (capacidad) return capacidad;

    return items.find((i) => precioMensualDesdeUnidad(i?.retailPrice ?? 0, i?.unitOfMeasure) !== null) || null;
}

// Servicio de precios de Azure Retail API con caché en memoria
// Fase 0 (docs/vps-infra-improvement-plan.md): tope de tamaño + eviccion
// FIFO para no crecer sin limite en un proceso de larga duracion.
const priceCache = new Map<string, number>();
const MAX_PRICE_CACHE_ENTRIES = 2000;

function evictPriceCacheIfFull(): void {
    while (priceCache.size > MAX_PRICE_CACHE_ENTRIES) {
        const firstKey = priceCache.keys().next().value;
        if (firstKey === undefined) break;
        priceCache.delete(firstKey);
    }
}

/**
 * `campoSku` elige por cuál de los dos campos filtrar, porque la Retail API los
 * distingue y el correcto depende del recurso: una VM se busca por `armSkuName`
 * (`Standard_D2s_v3`), mientras que un disco o una IP se buscan por `skuName`
 * (`P10 LRS`, `Standard`). Buscar una VM por `skuName` no devuelve nada --y como
 * la API contesta 200 con `Items: []`, el sintoma es un precio 0, no un error.
 *
 * MAQUINAS VIRTUALES. Un tamaño suele publicarse en seis filas, todas `Consumption`:
 * Linux, Windows, Spot y Low Priority (verificado contra la API el 2026-10-09,
 * `armSkuName eq 'Standard_D2s_v3'` en westus2). El orden no esta garantizado y la
 * primera era la Spot de Windows, que se cotizaba a 25,36 por mes cuando la VM
 * Linux a demanda cuesta 70,08. Por eso una VM no pasa por `elegirMedidor` (que es
 * de discos) sino por `elegirVm`, la misma regla del estimador de Shift-Left para
 * que no existan dos: descarta Spot y Low Priority siempre y separa Windows de
 * Linux por `productName`.
 *
 * `opciones.windows` pide la VM con la licencia de Windows incluida. SIN ELLA SE
 * COTIZA LINUX: el precio base, sin licencia de SO, que es la cota inferior --y en
 * un producto de ahorros subestimar es preferible a inflar--. Quien sabe que la VM
 * es Windows (la auditoria de licencias) tiene que decirlo. Si el tamaño no tiene
 * medidor del SO pedido el resultado es 0, no el del otro SO. Cualquier servicio
 * que no sea `Virtual Machines` ignora `opciones`.
 */
export async function getMonthlyCostEstimate(
    serviceName: string,
    skuName: string,
    region: string,
    campoSku: "skuName" | "armSkuName" = "skuName",
    opciones: { windows?: boolean } = {}
): Promise<number> {
    if (!skuName || !region || !serviceName) return 0;

    const esVm = serviceName === "Virtual Machines";
    const windows = esVm && opciones.windows === true;
    // El SO entra en la clave: la misma VM cuesta distinto en Linux y en Windows.
    const cacheKey = `${serviceName}-${campoSku}-${skuName}-${region}${windows ? "-windows" : ""}`.toLowerCase();

    if (priceCache.has(cacheKey)) {
        return priceCache.get(cacheKey)!;
    }

    try {
        const filter = `serviceName eq '${serviceName}' and armRegionName eq '${region}' and ${campoSku} eq '${skuName}' and priceType eq 'Consumption'`;
        const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;
        
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`Pricing API failed for ${cacheKey}: ${res.status}`);
            return 0;
        }

        const data = await res.json();
        if (data && data.Items && data.Items.length > 0) {
            // Import dinamico: `iacCostCatalog` ya importa de este modulo y uno
            // estatico cerraria el ciclo (es el modismo del repo para estos casos).
            const item = esVm
                ? (await import("@/services/iacCostCatalog")).elegirVm(data.Items, { windows, spot: false })
                : elegirMedidor(data.Items, skuName);
            const monthlyCost = item ? precioMensualDesdeUnidad(item.retailPrice || 0, item.unitOfMeasure) : null;
            // Unidad que pide una cantidad que no tenemos: se cachea 0 para que
            // el llamador use su propia estimacion en vez de un numero inventado.
            const valor = monthlyCost ?? 0;
            priceCache.set(cacheKey, valor);
            evictPriceCacheIfFull();
            return valor;
        }
        
        // Cachear a 0 si no se encontró resultado para no martillar la API
        priceCache.set(cacheKey, 0);
        evictPriceCacheIfFull();
        return 0;

    } catch (e) {
        console.error(`Error fetching price for ${cacheKey}:`, e);
        return 0;
    }
}

export async function getRetailPricing(region: string, sku: string, serviceName: string = 'Virtual Machines'): Promise<{ payg: number, paygWithLicense: number, res1y: number, res3y: number }> {
    // If the sku has quotes or spaces, Azure API usually expects exact armSkuName.
    const filter = `armRegionName eq '${region}' and armSkuName eq '${sku}' and serviceName eq '${serviceName}'`;
    const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;
    
    let payg = 0;
    let paygWithLicense = 0;
    let res1y = 0;
    let res3y = 0;

    try {
        const res = await fetch(url);
        const data = await res.json();
        
        if (data && data.Items) {
            for (const item of data.Items) {
                if (item.meterName.includes("Spot") || item.meterName.includes("Low Priority")) continue;

                // Only VMs have "Windows" product variants for OS licensing included.
                const isWindows = serviceName === 'Virtual Machines' && item.productName.includes("Windows");

                if (item.type === 'Consumption') {
                    if (isWindows) {
                        paygWithLicense = item.retailPrice || 0;
                    } else {
                        // Some non-VM resources return multiple consumption tiers or identical prices. Just grab the first non-windows one.
                        if (!payg) payg = item.retailPrice || 0;
                    }
                } else if (item.type === 'Reservation') {
                    if (isWindows) continue;

                    if (item.reservationTerm === '1 Year') {
                        res1y = item.retailPrice || 0;
                    } else if (item.reservationTerm === '3 Years') {
                        res3y = item.retailPrice || 0;
                    }
                }
            }
        }
    } catch (e) {
        console.error(`Retail Pricing error for ${sku} in ${region}:`, e);
    }

    // Si no hay precio explícito con licencia (ej. es Linux o no hay diferenciación), asumimos que es el mismo
    if (!paygWithLicense && payg) {
        paygWithLicense = payg;
    }

    return { payg, paygWithLicense, res1y, res3y };
}

// ---------------------------------------------------------------------------
// Items de la Retail API para el estimador de IaC (MEJ-20)
//
// `getMonthlyCostEstimate` devuelve 0 ante cualquier falla y, para lo que no es
// una VM, se queda con el primer medidor convertible, lo que alcanza para un
// disco pero no para una VM: verificado contra la API el 2026-10-08,
// `armSkuName eq 'Standard_D2s_v3'` en westus2 devuelve seis filas y la primera es
// "D2s v3 Spot" de Windows, que se cotizaba a 25 USD/mes cuando la VM Linux a
// demanda cuesta 70. Desde el 2026-10-09 las VMs de ese helper tambien pasan por
// `elegirVm`.
//
// Acá se separan las dos cosas que ese helper mezcla:
//  1. traer los items (con paginación, reintentos y caché), y
//  2. elegir cuál es el medidor del recurso, que depende del tipo de recurso y
//     por eso lo hace quien llama.
//
// Contrato (Learn, "Azure Retail Prices REST API overview", 2026-01): máximo 1000
// registros por página con `NextPageLink`; el valor del $filter distingue
// mayúsculas; los campos filtrables incluyen serviceName, armRegionName,
// skuName, armSkuName, productName, meterName y priceType. Y la API responde
// 429 "Too many requests" cuando se la consulta seguido, que es lo que pasó al
// explorarla el 2026-10-08.
// ---------------------------------------------------------------------------

export interface ItemRetail {
    retailPrice: number;
    unitPrice?: number;
    unitOfMeasure: string;
    armRegionName?: string;
    meterId?: string;
    meterName: string;
    productName: string;
    skuName: string;
    armSkuName?: string;
    serviceName?: string;
    type?: string;
    tierMinimumUnits?: number;
    isPrimaryMeterRegion?: boolean;
    effectiveStartDate?: string;
}

export interface ConsultaItems {
    serviceName: string;
    /** `armRegionName`. Load Balancer y NAT Gateway se publican como `Global`. */
    region: string;
    /** Un filtro exacto extra. Sin él se trae todo el servicio de esa región. */
    filtro?: { campo: "skuName" | "armSkuName"; valor: string };
}

export type ResultadoItems =
    | { items: ItemRetail[] }
    | { error: "limite" | "api" | "filtro-invalido" };

export interface DepsRetail {
    fetch?: typeof fetch;
    esperar?: (ms: number) => Promise<void>;
    ahora?: () => number;
}

const TTL_ITEMS_MS = 6 * 60 * 60 * 1000;
const TTL_VACIO_MS = 10 * 60 * 1000;
const MAX_PAGINAS = 10;
const MAX_INTENTOS = 3;
const MAX_ENTRADAS_ITEMS = 300;
/**
 * Lo que puede viajar dentro de un valor del $filter. Los valores salen del plan
 * de un cliente, y una comilla simple los rompería (o inyectaría otra condición).
 * Ningún nombre de servicio, región o SKU de Azure usa otros caracteres.
 */
const VALOR_SEGURO = /^[A-Za-z0-9 ._()+\-]+$/;

const cacheItems = new Map<string, { vence: number; items: ItemRetail[] }>();
const itemsEnVuelo = new Map<string, Promise<ResultadoItems>>();

export function limpiarCacheItemsRetail(): void {
    cacheItems.clear();
    itemsEnVuelo.clear();
}

function claveItems(c: ConsultaItems): string {
    return [c.serviceName, c.region, c.filtro?.campo ?? "", c.filtro?.valor ?? ""].join("|");
}

async function pedirPagina(
    url: string,
    f: typeof fetch,
    esperar: (ms: number) => Promise<void>
): Promise<{ items: ItemRetail[]; siguiente: string | null } | { error: "limite" | "api" }> {
    let ultimo: "limite" | "api" = "api";
    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
        try {
            const res = await f(url);
            if (res.status === 429 || res.status >= 500) {
                ultimo = res.status === 429 ? "limite" : "api";
                const retryAfter = Number(res.headers?.get?.("retry-after"));
                const espera = Number.isFinite(retryAfter) && retryAfter > 0
                    ? Math.min(retryAfter * 1000, 5000)
                    : 500 * 2 ** intento;
                if (intento < MAX_INTENTOS - 1) await esperar(espera);
                continue;
            }
            if (!res.ok) return { error: "api" };
            const json: any = await res.json();
            return {
                items: Array.isArray(json?.Items) ? (json.Items as ItemRetail[]) : [],
                siguiente: typeof json?.NextPageLink === "string" && json.NextPageLink ? json.NextPageLink : null,
            };
        } catch {
            ultimo = "api";
            if (intento < MAX_INTENTOS - 1) await esperar(500 * 2 ** intento);
        }
    }
    return { error: ultimo };
}

/**
 * Trae los items `Consumption` de un servicio en una región, con paginación,
 * reintentos ante 429/5xx y caché. Nunca lanza: una falla de la API vuelve como
 * `error`, para que quien llama distinga "no hay precio" (la API contestó y no
 * existe el medidor) de "no pude preguntar" (reintentar más tarde sí sirve).
 */
export function obtenerItemsRetail(c: ConsultaItems, deps: DepsRetail = {}): Promise<ResultadoItems> {
    const valores = [c.serviceName, c.region, c.filtro?.valor];
    if (!valores.every((v) => v === undefined || VALOR_SEGURO.test(v))) {
        return Promise.resolve({ error: "filtro-invalido" });
    }

    const ahora = deps.ahora ?? Date.now;
    const clave = claveItems(c);

    const guardado = cacheItems.get(clave);
    if (guardado && guardado.vence > ahora()) return Promise.resolve({ items: guardado.items });

    // Dos líneas del mismo plan piden el mismo medidor al mismo tiempo: sin esto
    // la segunda sale a la red antes de que la primera llene la caché.
    const enVuelo = itemsEnVuelo.get(clave);
    if (enVuelo) return enVuelo;

    const f = deps.fetch ?? fetch;
    const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    const filtro =
        `serviceName eq '${c.serviceName}' and armRegionName eq '${c.region}' and priceType eq 'Consumption'` +
        (c.filtro ? ` and ${c.filtro.campo} eq '${c.filtro.valor}'` : "");

    const carga = (async (): Promise<ResultadoItems> => {
        let url: string | null = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filtro)}`;
        const todos: ItemRetail[] = [];
        for (let pagina = 0; url && pagina < MAX_PAGINAS; pagina++) {
            const r = await pedirPagina(url, f, esperar);
            if ("error" in r) return { error: r.error };
            todos.push(...r.items);
            url = r.siguiente;
        }
        cacheItems.set(clave, { vence: ahora() + (todos.length ? TTL_ITEMS_MS : TTL_VACIO_MS), items: todos });
        while (cacheItems.size > MAX_ENTRADAS_ITEMS) {
            const primera = cacheItems.keys().next().value;
            if (primera === undefined) break;
            cacheItems.delete(primera);
        }
        return { items: todos };
    })().finally(() => itemsEnVuelo.delete(clave));

    itemsEnVuelo.set(clave, carga);
    return carga;
}
