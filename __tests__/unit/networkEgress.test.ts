// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: mocks.query } }));

import { getMapaEgress, CLASIFICACION } from "@/services/networkEgress.service";

/**
 * Evalúa el MISMO CASE que se manda a MySQL, leyendo las reglas del string que
 * exporta el servicio en vez de copiarlas acá. Una copia de las reglas en el
 * test valida la copia, no el código: si alguien reordena los WHEN o afloja una
 * condición, el test tiene que enterarse.
 *
 * Soporta las dos formas de regla que usa el CASE: `m LIKE '..'` y
 * `s LIKE '..' AND m LIKE '..'`.
 */
function clasificar(medidor: string, servicio = ""): string | null {
    const reglas = [...CLASIFICACION.matchAll(
        /WHEN (s|m) LIKE '([^']+)'(?:\s+AND (s|m) LIKE '([^']+)')?\s+THEN '([^']+)'/g
    )];
    expect(reglas.length, "no se pudieron leer las reglas del CASE").toBeGreaterThan(3);

    const valor = (campo: string) => (campo === "s" ? servicio : medidor).toLowerCase();
    const matchea = (campo: string, patron: string) =>
        new RegExp("^" + patron.replace(/[.+?^${}()|[\]\\]/g, "\\$&").split("%").join(".*") + "$").test(valor(campo));

    for (const [, c1, p1, c2, p2, categoria] of reglas) {
        if (!matchea(c1, p1)) continue;
        if (c2 && !matchea(c2, p2)) continue;
        return categoria;
    }
    return null;
}

describe("clasificación de medidores de transferencia", () => {
    // Los nombres salen de la Retail Prices API real (serviceName eq
    // 'Bandwidth', 2026-09-22), no de la memoria de nadie.
    it.each([
        ["Standard Data Transfer Out", "Bandwidth", "internet"],
        ["Standard Cost Optimized Data Transfer Out", "Bandwidth", "internet"],
        ["Standard Data Transfer Out - to China", "Bandwidth", "internet"],
        ["Standard Inter-Availability Zone Data Transfer Out", "Bandwidth", "entre_zonas"],
        ["Inter Continent Data Transfer Out - NAM or EU To Any", "Bandwidth", "entre_continentes"],
        ["Intra Continent Data Transfer Out", "Bandwidth", "entre_regiones"],
        ["Standard Data Processed", "NAT Gateway", "nat_gateway"],
        ["Standard Data Transfer In", "Bandwidth", "entrada"],
        ["Inter Continent Data Transfer In - ASIA To Any", "Bandwidth", "entrada"],
    ])("%s (%s) -> %s", (medidor, servicio, esperado) => {
        expect(clasificar(medidor, servicio)).toBe(esperado);
    });

    /**
     * LA TRAMPA QUE ESTUVO EN PRODUCCIÓN unas horas: `Data Processed` NO es del
     * NAT Gateway. Lo usan siete servicios, y `Azure Firewall` tiene un medidor
     * con el nombre EXACTAMENTE igual al del NAT. Filtrando sólo por el nombre,
     * el costo de un firewall, un load balancer o un application gateway se le
     * cargaba al NAT: plata real atribuida al lugar equivocado, y ninguna
     * excepción. Los siete salen de la Retail Prices API (serviceFamily eq
     * 'Networking', 2026-09-22).
     */
    it.each([
        ["Standard Data Processed", "Azure Firewall"],
        ["Standard Data Processed", "Load Balancer"],
        ["Gateway Data Processed", "Load Balancer"],
        ["Large Data Processed", "Application Gateway"],
        ["Network Protection Data Processed", "Azure DDOS Protection"],
        ["Standard Hub Data Processed", "Virtual WAN"],
        ["Standard Data Processed - Egress", "Virtual Network"],
    ])("'%s' de %s no es NAT Gateway", (medidor, servicio) => {
        expect(clasificar(medidor, servicio)).toBe("procesamiento");
    });

    it("el mismo nombre de medidor cae distinto segun el servicio", () => {
        expect(clasificar("Standard Data Processed", "NAT Gateway")).toBe("nat_gateway");
        expect(clasificar("Standard Data Processed", "Azure Firewall")).toBe("procesamiento");
    });

    // El que justifica el orden de los WHEN. `Standard Inter-Availability Zone
    // Data Transfer Out` también matchea un `%data transfer out%` genérico: con
    // los WHEN al revés, todo el inter-AZ se contaría como salida a internet y
    // el hallazgo que esta pantalla existe para mostrar desaparecería dentro de
    // otra categoría, sin que nada falle.
    it("lo específico gana: el inter-AZ no cae en 'internet'", () => {
        expect(clasificar("Standard Inter-Availability Zone Data Transfer Out")).not.toBe("internet");
        expect(clasificar("Standard Inter-Availability Zone Data Transfer In")).not.toBe("entrada");
    });

    it("un medidor que no es de transferencia queda afuera", () => {
        expect(clasificar("Standard Gateway", "NAT Gateway")).toBeNull();
        expect(clasificar("China Data Transfer - 1 Mbps", "Bandwidth")).toBeNull();
    });
});

describe("getMapaEgress", () => {
    const fila = (categoria: string, costo: number, gb: number, sinGb = 0, region = "eastus") =>
        ({ categoria, region, medidor: "x", servicio: "Bandwidth", costo, gb, sin_gb: sinGb });

    beforeEach(() => vi.clearAllMocks());

    it("suma por categoría y deja la entrada fuera del costo de salida", async () => {
        mocks.query.mockResolvedValueOnce([[
            fila("internet", 100, 1000),
            fila("entre_zonas", 50, 5000),
            fila("entrada", 0, 9000),
        ]]);
        const r = await getMapaEgress("t1");
        expect(r.costoTotalUsd).toBe(150);
        expect(r.costoSalidaUsd).toBe(150);
        expect(r.porCategoria[0]).toEqual({ categoria: "internet", costoUsd: 100, gigabytes: 1000 });
        expect(r.gigabytesParciales).toBe(false);
    });

    it("la entrada sí se resta cuando cuesta", async () => {
        mocks.query.mockResolvedValueOnce([[fila("internet", 100, 1000), fila("entrada", 7, 500)]]);
        const r = await getMapaEgress("t1");
        expect(r.costoTotalUsd).toBe(107);
        expect(r.costoSalidaUsd).toBe(100);
    });

    // Un GB desconocido contagia a toda la categoría: sumar sólo los que se
    // saben da un número que parece el total y no lo es, que miente hacia abajo
    // igual que el 0 silencioso de la Retail API.
    it("un medidor sin GB fiables deja la categoría sin total de GB", async () => {
        mocks.query.mockResolvedValueOnce([[
            fila("internet", 100, 1000),
            fila("internet", 20, 0, 1),
        ]]);
        const r = await getMapaEgress("t1");
        expect(r.porCategoria[0].costoUsd).toBe(120);
        expect(r.porCategoria[0].gigabytes).toBeNull();
        expect(r.gigabytesParciales).toBe(true);
    });

    it("sin filas no inventa nada", async () => {
        mocks.query.mockResolvedValueOnce([[]]);
        const r = await getMapaEgress("t1");
        expect(r).toMatchObject({ flujos: [], porCategoria: [], costoTotalUsd: 0, costoSalidaUsd: 0, gigabytesParciales: false });
    });

    it("acota la ventana a lo pedido", async () => {
        mocks.query.mockResolvedValueOnce([[]]);
        await getMapaEgress("t1", 7);
        expect(mocks.query.mock.calls[0][1]).toEqual(["t1", 7]);
    });
});
