// @vitest-environment node
/**
 * MEJ-19 criterio 3 — ExpressRoute y VPN sobredimensionados.
 *
 * La regla que manda acá no es el cálculo, es la SEGURIDAD: sin métricas no se
 * recomienda achicar. Un enlace sin muestras no está ocioso; lo más probable es
 * que falte el permiso de lectura o que el recurso sea nuevo. Tratar la
 * ausencia como 0% de uso recomendaría bajarle el SKU a un circuito de
 * producción que quizás está saturado — el error acá no confunde: corta un
 * enlace.
 */
import { describe, it, expect } from "vitest";
import {
    capacidadDeCircuito, throughputDeVpn, percentil, evaluarEnlace,
    UMBRAL_SUBUTILIZADO_PCT, THROUGHPUT_VPN_MBPS, CATALOGO_RED_REVISADO_EL,
} from "@/lib/networkCapacityCatalog";

describe("sin datos NO se recomienda achicar", () => {
    it("sin muestras, el veredicto es «sin-datos», no 0% de uso", () => {
        const e = evaluarEnlace(1000, null);
        expect(e.veredicto).toBe("sin-datos");
        expect(e.utilizacionPct).toBeNull();
        expect(e.motivo).toBeTruthy();
    });

    it("sin capacidad legible tampoco se opina", () => {
        const e = evaluarEnlace(null, 50);
        expect(e.veredicto).toBe("sin-capacidad");
        expect(e.utilizacionPct).toBeNull();
    });

    it("una capacidad en cero no divide por cero", () => {
        expect(evaluarEnlace(0, 50).veredicto).toBe("sin-capacidad");
    });

    it("con datos de verdad sí opina", () => {
        expect(evaluarEnlace(1000, 100).veredicto).toBe("subutilizado"); // 10%
        expect(evaluarEnlace(1000, 400).veredicto).toBe("ajustado");     // 40%
    });

    it("el umbral del criterio 3 es 15% y el borde cae del lado seguro", () => {
        expect(UMBRAL_SUBUTILIZADO_PCT).toBe(15);
        // Justo en 15% NO se recomienda achicar: el criterio dice "menor al 15%".
        expect(evaluarEnlace(1000, 150).veredicto).toBe("ajustado");
        expect(evaluarEnlace(1000, 149).veredicto).toBe("subutilizado");
    });
});

describe("la capacidad de un circuito vive en DOS lugares", () => {
    it("circuito por proveedor: serviceProviderProperties.bandwidthInMbps", () => {
        expect(capacidadDeCircuito({ serviceProviderProperties: { bandwidthInMbps: 200 } })).toBe(200);
    });

    it("ExpressRoute Direct: properties.bandwidthInGbps, y se convierte", () => {
        // Leer sólo el primero dejaría en cero a los circuitos MÁS GRANDES.
        expect(capacidadDeCircuito({ bandwidthInGbps: 10 })).toBe(10_000);
        expect(capacidadDeCircuito({ bandwidthInGbps: 100 })).toBe(100_000);
    });

    it("sin ninguna de las dos devuelve null, no cero", () => {
        expect(capacidadDeCircuito({})).toBeNull();
        expect(capacidadDeCircuito(undefined)).toBeNull();
        expect(capacidadDeCircuito({ serviceProviderProperties: {} })).toBeNull();
    });
});

describe("el throughput de VPN depende de la GENERACIÓN, no sólo del SKU", () => {
    it("el mismo VpnGw2 rinde distinto en Generation1 y Generation2", () => {
        // Con el nombre solo, la utilización de medio parque sale 25% corrida.
        expect(throughputDeVpn("Generation1", "VpnGw2")).toBe(1_000);
        expect(throughputDeVpn("Generation2", "VpnGw2")).toBe(1_250);
    });

    it("un par que no está en el catálogo devuelve null, no cero", () => {
        expect(throughputDeVpn("Generation3", "VpnGw9")).toBeNull();
        expect(throughputDeVpn("", "VpnGw2")).toBeNull();
    });

    it("el catálogo cubre las dos generaciones y las variantes AZ", () => {
        expect(THROUGHPUT_VPN_MBPS["Generation1|Basic"]).toBe(100);
        expect(THROUGHPUT_VPN_MBPS["Generation2|VpnGw5"]).toBe(10_000);
        expect(THROUGHPUT_VPN_MBPS["Generation2|VpnGw5AZ"]).toBe(10_000);
        expect(CATALOGO_RED_REVISADO_EL).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe("el percentil, que Azure Monitor no da", () => {
    it("el P95 de una serie plana es ese valor", () => {
        expect(percentil([10, 10, 10, 10], 95)).toBe(10);
    });

    it("descarta el pico aislado, que es el punto de usar P95 y no el máximo", () => {
        // 99 muestras en 10 y una en 1000: el máximo diría 1000 y haría que un
        // enlace ocioso parezca ajustado.
        const serie = [...Array(99).fill(10), 1000];
        expect(percentil(serie, 95)!).toBeLessThan(100);
        expect(Math.max(...serie)).toBe(1000);
    });

    it("una serie vacía devuelve null, no cero", () => {
        expect(percentil([], 95)).toBeNull();
        expect(percentil([NaN, NaN], 95)).toBeNull();
    });

    it("interpola en vez de saltar al índice más cercano", () => {
        expect(percentil([0, 100], 50)).toBe(50);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// La ruta: unidades, tipo de gateway y dirección
// ─────────────────────────────────────────────────────────────────────────────
import { vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { listarMock, fetchMock, tokenMock } = vi.hoisted(() => ({
    listarMock: vi.fn(),
    fetchMock: vi.fn(),
    tokenMock: vi.fn(async () => ({ token: "t" })),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => ({ email: "u@u", tenantId: "t1", claims: {} })),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({ getToken: tokenMock })),
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
}));
vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn(async () => null), set: vi.fn(async () => {}), del: vi.fn(async () => {}) } }));
vi.mock("@/app/api/intelligence/databases/diagnosticsShared", () => ({ listResourcesByTypes: listarMock }));

/** Una serie plana de `n` puntos con el valor crudo que da Azure Monitor. */
const serie = (valor: number, n = 24) => ({
    value: [{ timeseries: [{ data: Array.from({ length: n }, () => ({ average: valor })) }] }],
});

beforeEach(() => {
    listarMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

const pedir = async () => {
    const { GET } = await import("@/app/api/intelligence/network/capacity/route");
    return GET(new NextRequest("http://localhost/api/intelligence/network/capacity?tenantId=t1"));
};

describe("las unidades: Bits en el circuito, Bytes en el gateway", () => {
    it("ExpressRoute convierte bits/s a Mbps dividiendo por 1e6", async () => {
        listarMock.mockResolvedValue([{
            id: "/er1", name: "er1", type: "microsoft.network/expressroutecircuits",
            properties: { serviceProviderProperties: { bandwidthInMbps: 1000 } },
        }]);
        // 100 Mbps reales = 100.000.000 bits/s
        fetchMock.mockResolvedValue({ ok: true, json: async () => serie(100_000_000) });
        const j = await (await pedir()).json();
        expect(j.enlaces[0].p95Mbps).toBeCloseTo(100, 1);
        expect(j.enlaces[0].utilizacionPct).toBeCloseTo(10, 1);
    });

    it("el VPN Gateway convierte bytes/s a Mbps multiplicando por 8", async () => {
        // Sin el ×8 saldría ocho veces más ocioso — y hacia el lado que
        // recomienda achicar, que es el error caro.
        listarMock.mockResolvedValue([{
            id: "/vpn1", name: "vpn1", type: "microsoft.network/virtualnetworkgateways",
            properties: { gatewayType: "Vpn", vpnGatewayGeneration: "Generation2", sku: { name: "VpnGw2" } },
        }]);
        // 100 Mbps reales = 12.500.000 bytes/s
        fetchMock.mockResolvedValue({ ok: true, json: async () => serie(12_500_000) });
        const j = await (await pedir()).json();
        expect(j.enlaces[0].p95Mbps).toBeCloseTo(100, 1);
        expect(j.enlaces[0].capacidadMbps).toBe(1250);
    });
});

describe("un virtualNetworkGateway puede NO ser de VPN", () => {
    it("el gateway de ExpressRoute se saltea en vez de medirse con el catálogo equivocado", async () => {
        listarMock.mockResolvedValue([{
            id: "/erg", name: "erg", type: "microsoft.network/virtualnetworkgateways",
            properties: { gatewayType: "ExpressRoute", sku: { name: "Standard" } },
        }]);
        fetchMock.mockResolvedValue({ ok: true, json: async () => serie(1000) });
        const j = await (await pedir()).json();
        expect(j.enlaces).toHaveLength(0);
    });
});

describe("la dirección", () => {
    it("toma el MÁXIMO entre entrada y salida, no la suma", async () => {
        // Un circuito soporta su ancho de banda en CADA sentido. Sumarlos
        // inflaría la utilización y taparía los que están de más.
        listarMock.mockResolvedValue([{
            id: "/er1", name: "er1", type: "microsoft.network/expressroutecircuits",
            properties: { serviceProviderProperties: { bandwidthInMbps: 1000 } },
        }]);
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                value: [
                    { timeseries: [{ data: Array.from({ length: 24 }, () => ({ average: 100_000_000 })) }] }, // 100 Mbps in
                    { timeseries: [{ data: Array.from({ length: 24 }, () => ({ average: 300_000_000 })) }] }, // 300 Mbps out
                ],
            }),
        });
        const j = await (await pedir()).json();
        expect(j.enlaces[0].p95Mbps).toBeCloseTo(300, 1);   // no 400
        expect(j.enlaces[0].utilizacionPct).toBeCloseTo(30, 1);
    });
});

describe("si Azure Monitor falla, el enlace no se declara ocioso", () => {
    it("un 403 de métricas da «sin-datos», no 0%", async () => {
        listarMock.mockResolvedValue([{
            id: "/er1", name: "er1", type: "microsoft.network/expressroutecircuits",
            properties: { serviceProviderProperties: { bandwidthInMbps: 1000 } },
        }]);
        fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
        const j = await (await pedir()).json();
        expect(j.enlaces[0].veredicto).toBe("sin-datos");
        expect(j.enlaces[0].utilizacionPct).toBeNull();
        // Y el resumen lo cuenta aparte, no como "todo bien".
        expect(j.resumen.sinMedir).toBe(1);
        expect(j.resumen.subutilizado).toBe(0);
    });
});
