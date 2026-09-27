// @vitest-environment node
/**
 * MEJ-39 — la ruta: el cruce con el costo, que es lo que convierte la lista de
 * deuda técnica en una decisión de presupuesto.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { listarMock, costosMock } = vi.hoisted(() => ({
    listarMock: vi.fn(),
    costosMock: vi.fn(),
}));

const IDENT = { email: "u@u", tenantId: "t1", claims: { tid: "t1" }, isCorporateDomain: false };
vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => IDENT),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({})),
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
}));
vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn(async () => null), set: vi.fn(async () => {}), del: vi.fn(async () => {}) } }));
vi.mock("@/app/api/intelligence/databases/diagnosticsShared", () => ({
    listResourcesByTypes: listarMock,
    getMtdCostByResourceId: costosMock,
}));

import { GET } from "@/app/api/governance/lifecycle/route";

const pedir = () => GET(new NextRequest("http://localhost/api/governance/lifecycle?tenantId=t1"));

function recurso(id: string, type: string, props: Record<string, unknown>) {
    return { id, name: id.split("/").pop(), type, resourceGroup: "rg", subscriptionId: "sub-1", location: "eastus", properties: props };
}

beforeEach(() => {
    listarMock.mockReset();
    costosMock.mockReset().mockResolvedValue(new Map());
});

describe("el cruce con el catálogo", () => {
    it("lee la versión del campo que cada producto usa, no de uno genérico", async () => {
        listarMock.mockResolvedValue([
            recurso("/s/1/aks-a", "microsoft.containerservice/managedclusters", { kubernetesVersion: "1.34" }),
            recurso("/s/1/pg-a", "microsoft.dbforpostgresql/flexibleservers", { version: "14" }),
            recurso("/s/1/my-a", "microsoft.dbformysql/flexibleservers", { version: "8.0.21" }),
        ]);
        const j = await (await pedir()).json();

        expect(j.resources.map((r: any) => r.version).sort()).toEqual(["1.34", "14", "8.0"]);
        // Ninguno queda sin evaluar: si el campo fuera el equivocado, todos
        // caerían en "sin-datos" y la pantalla diría "no hay nada que ver".
        expect(j.resources.every((r: any) => r.ventana !== "sin-datos")).toBe(true);
    });

    it("un recurso cuya versión no se puede leer NO se cuenta como soportado", async () => {
        listarMock.mockResolvedValue([
            recurso("/s/1/aks-x", "microsoft.containerservice/managedclusters", {}),
        ]);
        const j = await (await pedir()).json();
        expect(j.resources[0].ventana).toBe("sin-datos");
        expect(j.resumen.porVentana.soportado).toBe(0);
    });
});

describe("el costo: null y 0 no son lo mismo", () => {
    it("lo que no se pudo valorizar se informa aparte, no se suma como cero", async () => {
        listarMock.mockResolvedValue([
            recurso("/s/1/aks-a", "microsoft.containerservice/managedclusters", { kubernetesVersion: "1.32" }),
            recurso("/s/1/aks-b", "microsoft.containerservice/managedclusters", { kubernetesVersion: "1.32" }),
        ]);
        // Sólo el primero tiene costo atribuido.
        costosMock.mockResolvedValue(new Map([["/s/1/aks-a", 1200]]));

        const j = await (await pedir()).json();
        const a = j.resources.find((r: any) => r.name === "aks-a");
        const b = j.resources.find((r: any) => r.name === "aks-b");

        expect(a.costoMensualUsd).toBe(1200);
        expect(b.costoMensualUsd).toBeNull();
        // El total NO baja por el que no se pudo valorizar; se dice cuántos son.
        expect(j.resumen.costoEnRiesgoUsd).toBe(1200);
        expect(j.resumen.recursosSinCosto).toBe(1);
    });

    it("un recurso que costó cero de verdad sí suma cero y no cuenta como «sin costo»", async () => {
        listarMock.mockResolvedValue([
            recurso("/s/1/aks-a", "microsoft.containerservice/managedclusters", { kubernetesVersion: "1.32" }),
        ]);
        costosMock.mockResolvedValue(new Map([["/s/1/aks-a", 0]]));
        const j = await (await pedir()).json();
        expect(j.resources[0].costoMensualUsd).toBe(0);
        expect(j.resumen.recursosSinCosto).toBe(0);
    });

    it("lo soportado no entra en el costo en riesgo", async () => {
        listarMock.mockResolvedValue([
            recurso("/s/1/aks-viejo", "microsoft.containerservice/managedclusters", { kubernetesVersion: "1.32" }),
            recurso("/s/1/aks-nuevo", "microsoft.containerservice/managedclusters", { kubernetesVersion: "1.37" }),
        ]);
        costosMock.mockResolvedValue(new Map([["/s/1/aks-viejo", 100], ["/s/1/aks-nuevo", 9000]]));
        const j = await (await pedir()).json();
        expect(j.resumen.costoEnRiesgoUsd).toBe(100);
    });
});

describe("el orden", () => {
    it("lo urgente arriba, y dentro de lo urgente lo caro primero", async () => {
        listarMock.mockResolvedValue([
            recurso("/s/1/ok", "microsoft.containerservice/managedclusters", { kubernetesVersion: "1.37" }),
            recurso("/s/1/barato", "microsoft.containerservice/managedclusters", { kubernetesVersion: "1.32" }),
            recurso("/s/1/caro", "microsoft.containerservice/managedclusters", { kubernetesVersion: "1.32" }),
        ]);
        costosMock.mockResolvedValue(new Map([["/s/1/barato", 10], ["/s/1/caro", 5000], ["/s/1/ok", 1]]));
        const j = await (await pedir()).json();
        expect(j.resources.map((r: any) => r.name)).toEqual(["caro", "barato", "ok"]);
    });
});

describe("el catálogo se declara", () => {
    it("la respuesta dice cuándo se revisó, para que una pantalla vieja se note", async () => {
        listarMock.mockResolvedValue([]);
        const j = await (await pedir()).json();
        expect(j.revisadoEl).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(j.umbrales).toEqual({ critico: 90, proximo: 365 });
    });
});
