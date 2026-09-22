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

    // "1 Hour", "10 Hours"
    const horas = u.match(/^(\d+(?:\.\d+)?)\s*hours?$/);
    if (horas && Number(horas[1]) > 0) return (retailPrice / Number(horas[1])) * HOURS_PER_MONTH;

    // "1/Month", "1 Month"
    const meses = u.match(/^(\d+(?:\.\d+)?)\s*\/?\s*months?$/);
    if (meses && Number(meses[1]) > 0) return retailPrice / Number(meses[1]);

    // "1 Day", "30 Days"
    const dias = u.match(/^(\d+(?:\.\d+)?)\s*days?$/);
    if (dias && Number(dias[1]) > 0) return (retailPrice / Number(dias[1])) * (HOURS_PER_MONTH / 24);

    return null;
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

export async function getMonthlyCostEstimate(serviceName: string, skuName: string, region: string): Promise<number> {
    if (!skuName || !region || !serviceName) return 0;
    
    const cacheKey = `${serviceName}-${skuName}-${region}`.toLowerCase();
    
    if (priceCache.has(cacheKey)) {
        return priceCache.get(cacheKey)!;
    }

    try {
        const filter = `serviceName eq '${serviceName}' and armRegionName eq '${region}' and skuName eq '${skuName}' and priceType eq 'Consumption'`;
        const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;
        
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`Pricing API failed for ${cacheKey}: ${res.status}`);
            return 0;
        }

        const data = await res.json();
        if (data && data.Items && data.Items.length > 0) {
            const item = data.Items[0];
            const monthlyCost = precioMensualDesdeUnidad(item.retailPrice || 0, item.unitOfMeasure);
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
