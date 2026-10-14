import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Las claves se resuelven contra messages/es.json, asi que el test tambien
// falla si falta una clave del catalogo.
vi.mock("next-intl", async () => {
    const { readFileSync } = await import("node:fs");
    const es = JSON.parse(readFileSync("messages/es.json", "utf-8"));
    return {
        useLocale: () => "es",
        useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => {
            const txt = es[ns]?.[key];
            if (txt === undefined) throw new Error(`falta la clave ${ns}.${key} en messages/es.json`);
            return params ? String(txt).replace(/\{(\w+)\}/g, (_: string, k: string) => String(params[k] ?? "")) : txt;
        },
    };
});

const datos = vi.hoisted(() => ({ respuesta: null as any, error: undefined as any }));
vi.mock("swr", () => ({
    default: (key: string | null) => ({
        data: key?.includes("/traffic-pilot") ? undefined : datos.respuesta,
        error: datos.error,
        isLoading: false,
    }),
}));
vi.mock("@/components/TenantProvider", () => ({ useTenant: () => ({ selectedTenant: { id: "t1" } }) }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [{}] }) }));
vi.mock("@/lib/msalToken", () => ({ getFreshIdToken: async () => "token" }));

import NetworkEgressBoard from "@/components/dashboard/NetworkEgressBoard";

const mapa = (over: any = {}) => ({
    flujos: [
        { categoria: "internet", region: "eastus", servicio: "Bandwidth", medidor: "Standard Data Transfer Out", costoUsd: 412.8, gigabytes: 4703 },
        { categoria: "entre_zonas", region: "eastus", servicio: "Bandwidth", medidor: "Standard Inter-Availability Zone Data Transfer Out", costoUsd: 268.4, gigabytes: 26840 },
        { categoria: "nat_gateway", region: "eastus", servicio: "NAT Gateway", medidor: "Standard Data Processed", costoUsd: 121.5, gigabytes: 2700 },
        { categoria: "procesamiento", region: "eastus", servicio: "Azure Firewall", medidor: "Standard Data Processed", costoUsd: 96.3, gigabytes: 2140 },
    ],
    porCategoria: [
        { categoria: "internet", costoUsd: 412.8, gigabytes: 4703 },
        { categoria: "entre_zonas", costoUsd: 268.4, gigabytes: 26840 },
        { categoria: "nat_gateway", costoUsd: 121.5, gigabytes: 2700 },
        { categoria: "procesamiento", costoUsd: 96.3, gigabytes: 2140 },
    ],
    costoTotalUsd: 899,
    costoSalidaUsd: 899,
    dias: 30,
    gigabytesParciales: false,
    ...over,
});

describe("NetworkEgressBoard (MEJ-19)", () => {
    it("muestra el costo por categoria y el medidor real de Azure", () => {
        datos.respuesta = mapa();
        datos.error = undefined;
        render(<NetworkEgressBoard />);
        // getAllByText: cada categoría sale dos veces, en la barra y en la tabla.
        expect(screen.getAllByText("Salida a internet").length).toBe(2);
        expect(screen.getAllByText("Entre zonas de disponibilidad").length).toBe(2);
        expect(screen.getByText("Standard Inter-Availability Zone Data Transfer Out")).toBeTruthy();
        expect(screen.getAllByText(/899/).length).toBeGreaterThan(0);
    });

    // El inter-AZ y el NAT son los dos evitables cambiando arquitectura: sin la
    // sugerencia, la pantalla informa un numero y deja al usuario sin siguiente paso.
    it("sugiere que hacer con el inter-AZ, que es lo accionable", () => {
        datos.respuesta = mapa();
        render(<NetworkEgressBoard />);
        expect(screen.getByText(/Se paga en las dos direcciones/)).toBeTruthy();
    });

    it("no sugiere nada para una categoria sin cargo", () => {
        datos.respuesta = mapa({
            porCategoria: [{ categoria: "entre_zonas", costoUsd: 0, gigabytes: 0 }],
            flujos: [], costoTotalUsd: 0, costoSalidaUsd: 0,
        });
        render(<NetworkEgressBoard />);
        expect(screen.queryByText(/Se paga en las dos direcciones/)).toBeNull();
    });

    // Un volumen parcial que parece total es el mismo error que el 0 silencioso.
    it("avisa cuando los GB son parciales", () => {
        datos.respuesta = mapa({ gigabytesParciales: true });
        render(<NetworkEgressBoard />);
        expect(screen.getByText(/no se cobran por GB/)).toBeTruthy();
    });

    // El bug que estuvo en produccion: `Standard Data Processed` lo usan siete
    // servicios y el de Azure Firewall se llama igual que el del NAT Gateway.
    // En la tabla tienen que poder distinguirse.
    it("distingue dos medidores que se llaman igual por su servicio", () => {
        datos.respuesta = mapa();
        render(<NetworkEgressBoard />);
        expect(screen.getAllByText("Standard Data Processed").length).toBe(2);
        expect(screen.getByText("NAT Gateway")).toBeTruthy();
        expect(screen.getByText("Azure Firewall")).toBeTruthy();
        expect(screen.getAllByText("Procesado por appliances").length).toBe(2);
    });

    it("un vacio explica por que puede estar vacio", () => {
        datos.respuesta = mapa({ porCategoria: [], flujos: [], costoTotalUsd: 0, costoSalidaUsd: 0 });
        render(<NetworkEgressBoard />);
        expect(screen.getByText(/el sync diario todavía no haya corrido/)).toBeTruthy();
    });

    it("un error no deja la pantalla en blanco", () => {
        datos.respuesta = undefined;
        datos.error = new Error("HTTP 500");
        render(<NetworkEgressBoard />);
        expect(screen.getByText(/No se pudo cargar el tráfico/)).toBeTruthy();
        datos.error = undefined;
    });
});
