/**
 * MEJ-19 criterio 3 — capacidad contratada de ExpressRoute y VPN Gateway.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CONTRATOS VERIFICADOS (2026-09-27) contra learn.microsoft.com. En Azure un
 * campo equivocado devuelve vacío, no un error, así que cada uno se miró:
 *
 * - `expressRouteCircuits`: la capacidad vive en DOS lugares según cómo se
 *   aprovisionó el circuito. `properties.serviceProviderProperties.bandwidthInMbps`
 *   para los de proveedor, y `properties.bandwidthInGbps` para ExpressRoute
 *   Direct (sobre un `ExpressRoutePort`). Leer sólo el primero deja en cero
 *   justo a los circuitos más grandes — los Direct son de 10 y 100 Gbps.
 * - `virtualNetworkGateways`: `properties.sku.name`, `properties.vpnGatewayGeneration`
 *   y `properties.gatewayType`. El TIPO importa: este mismo recurso puede ser un
 *   gateway de ExpressRoute, que no tiene throughput de VPN y cuya métrica de
 *   ancho de banda no significa lo mismo.
 * - Métricas: `BitsInPerSecond` / `BitsOutPerSecond` en el circuito (unidad
 *   **BitsPerSecond**) y `AverageBandwidth` en el gateway (unidad
 *   **BytesPerSecond**). NO son la misma unidad: mezclarlas sin convertir da una
 *   utilización ocho veces mal, y hacia el lado que recomienda achicar.
 * - **Azure Monitor no ofrece agregación por percentil.** Las agregaciones
 *   soportadas son Total, Average, Minimum y Maximum: no hay P95. Se pide la
 *   serie y el percentil se calcula acá.
 */

/** Cuándo se revisaron estas cifras. Se muestra, igual que en MEJ-39. */
export const CATALOGO_RED_REVISADO_EL = "2026-09-27";

export const FUENTE_VPN = "https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-about-vpngateways";
export const FUENTE_ER = "https://learn.microsoft.com/azure/expressroute/expressroute-about-virtual-network-gateways";

/** Por debajo de esto, el circuito está sobredimensionado (criterio 3). */
export const UMBRAL_SUBUTILIZADO_PCT = 15;

/**
 * Throughput agregado por SKU de VPN Gateway, en Mbps.
 *
 * LA CLAVE ES GENERACIÓN + SKU, no el SKU solo: `VpnGw2` rinde 1 Gbps en
 * Generation1 y 1,25 Gbps en Generation2. Con el nombre solo, la utilización de
 * medio parque sale 25% corrida.
 */
export const THROUGHPUT_VPN_MBPS: Record<string, number> = {
    "Generation1|Basic": 100,
    "Generation1|VpnGw1": 650,
    "Generation1|VpnGw2": 1_000,
    "Generation1|VpnGw3": 1_250,
    "Generation1|VpnGw1AZ": 650,
    "Generation1|VpnGw2AZ": 1_000,
    "Generation1|VpnGw3AZ": 1_250,
    "Generation2|VpnGw2": 1_250,
    "Generation2|VpnGw3": 2_500,
    "Generation2|VpnGw4": 5_000,
    "Generation2|VpnGw5": 10_000,
    "Generation2|VpnGw2AZ": 1_250,
    "Generation2|VpnGw3AZ": 2_500,
    "Generation2|VpnGw4AZ": 5_000,
    "Generation2|VpnGw5AZ": 10_000,
};

/** `null` = el par generación+SKU no está en el catálogo. No es cero. */
export function throughputDeVpn(generacion: unknown, sku: unknown): number | null {
    const clave = `${String(generacion || "").trim()}|${String(sku || "").trim()}`;
    return THROUGHPUT_VPN_MBPS[clave] ?? null;
}

/**
 * La capacidad de un circuito ExpressRoute, en Mbps.
 *
 * Prueba las dos formas porque las dos existen y ninguna es "la correcta":
 * dependen de cómo se aprovisionó el circuito.
 */
export function capacidadDeCircuito(properties: Record<string, unknown> | undefined): number | null {
    const p = (properties || {}) as any;
    const mbps = Number(p?.serviceProviderProperties?.bandwidthInMbps);
    if (Number.isFinite(mbps) && mbps > 0) return mbps;
    const gbps = Number(p?.bandwidthInGbps);
    if (Number.isFinite(gbps) && gbps > 0) return gbps * 1000;
    return null;
}

/**
 * El percentil de una serie, por interpolación lineal.
 *
 * Existe porque Azure Monitor NO lo da: sus agregaciones son Total, Average,
 * Minimum y Maximum. El P95 se calcula sobre las muestras que devuelve la API,
 * así que su significado depende del grano pedido — con muestras horarias, es
 * "la hora número 95 de cada 100", no el minuto pico.
 */
export function percentil(valores: number[], p: number): number | null {
    const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (v.length === 0) return null;
    if (v.length === 1) return v[0];
    const pos = ((v.length - 1) * p) / 100;
    const bajo = Math.floor(pos);
    const alto = Math.ceil(pos);
    if (bajo === alto) return v[bajo];
    return v[bajo] + (v[alto] - v[bajo]) * (pos - bajo);
}

export type Veredicto = "subutilizado" | "ajustado" | "sin-datos" | "sin-capacidad";

export interface EvaluacionDeEnlace {
    utilizacionPct: number | null;
    veredicto: Veredicto;
    motivo: string | null;
}

/**
 * Compara lo contratado contra el P95 medido.
 *
 * LA REGLA DE SEGURIDAD: **sin métricas NO se recomienda achicar.**
 *
 * Un enlace sin muestras no está ocioso: lo más probable es que falte el
 * permiso de lectura de métricas, o que el recurso sea nuevo. Tratar la
 * ausencia como 0% de uso produciría una recomendación de bajar el SKU de un
 * circuito de producción que quizás está saturado. Es el mismo criterio que
 * MEJ-39 —sin dato no es "soportado"— pero acá el error no confunde: corta un
 * enlace.
 */
export function evaluarEnlace(capacidadMbps: number | null, p95Mbps: number | null): EvaluacionDeEnlace {
    if (capacidadMbps === null || capacidadMbps <= 0) {
        return { utilizacionPct: null, veredicto: "sin-capacidad", motivo: "No se pudo leer la capacidad contratada." };
    }
    if (p95Mbps === null) {
        return { utilizacionPct: null, veredicto: "sin-datos", motivo: "Azure Monitor no devolvió muestras para este enlace." };
    }
    const pct = Number(((p95Mbps / capacidadMbps) * 100).toFixed(2));
    return {
        utilizacionPct: pct,
        veredicto: pct < UMBRAL_SUBUTILIZADO_PCT ? "subutilizado" : "ajustado",
        motivo: null,
    };
}
