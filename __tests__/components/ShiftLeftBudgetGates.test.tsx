import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// Igual que en CoinRecommendationsModal: las claves se resuelven contra
// messages/es.json, asi que el test tambien falla si una clave no existe.
vi.mock("next-intl", async () => {
    const { readFileSync } = await import("node:fs");
    const es = JSON.parse(readFileSync("messages/es.json", "utf-8"));
    return {
        useLocale: () => "es",
        useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => {
            const txt = es[ns]?.[key];
            if (!txt) return key;
            return params ? txt.replace(/\{(\w+)\}/g, (_: string, k: string) => String(params[k] ?? "")) : txt;
        },
    };
});

const datos = vi.hoisted(() => ({
    respuesta: {
        items: [],
        kpis: { analizados: 0, aumentoDetectado: 0, ahorroDetectado: 0, bloqueados: 0 },
        gates: [{ repository: "acme/infra-azure", threshold_usd: 500 }],
    },
    mutate: vi.fn(),
}));

vi.mock("swr", () => ({
    default: () => ({ data: datos.respuesta, error: undefined, isLoading: false, mutate: datos.mutate }),
}));
vi.mock("@/components/TenantProvider", () => ({ useTenant: () => ({ selectedTenant: { id: "t1" } }) }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [{}] }) }));
vi.mock("@/lib/msalToken", () => ({ getFreshIdToken: async () => "token" }));

import ShiftLeftGovernanceBoard from "@/components/dashboard/ShiftLeftGovernanceBoard";

describe("Budget Gates en el panel de Shift-Left (MEJ-20)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as any;
    });

    it("muestra el umbral configurado de cada repo", () => {
        render(<ShiftLeftGovernanceBoard />);
        expect(screen.getByText("acme/infra-azure")).toBeTruthy();
        expect(screen.getByText(/500/)).toBeTruthy();
    });

    it("guarda un umbral nuevo y refresca la tabla", async () => {
        render(<ShiftLeftGovernanceBoard />);
        fireEvent.change(screen.getByPlaceholderText("owner/repositorio"), { target: { value: "acme/plataforma" } });
        fireEvent.change(screen.getByPlaceholderText("USD por mes"), { target: { value: "120" } });
        fireEvent.click(screen.getByText("Guardar"));

        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        const [url, init] = (global.fetch as any).mock.calls[0];
        expect(url).toContain("/api/governance/shift-left/gates");
        expect(init.method).toBe("PUT");
        expect(JSON.parse(init.body)).toEqual({ tenantId: "t1", repository: "acme/plataforma", threshold_usd: 120 });
        // Sin esto la fila nueva no aparece hasta que el usuario recarga.
        await waitFor(() => expect(datos.mutate).toHaveBeenCalled());
    });

    // Quitar es el mismo PUT con null: si mandara 0, el repo quedaria con el
    // umbral mas estricto posible en vez de sin gate.
    it("quitar manda null y no cero", async () => {
        render(<ShiftLeftGovernanceBoard />);
        fireEvent.click(screen.getByText("Quitar"));
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body).toEqual({ tenantId: "t1", repository: "acme/infra-azure", threshold_usd: null });
    });

    it("avisa cuando el guardado falla, en vez de quedarse callado", async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "requiere rol Admin/Owner" }) }) as any;
        render(<ShiftLeftGovernanceBoard />);
        fireEvent.change(screen.getByPlaceholderText("owner/repositorio"), { target: { value: "acme/x" } });
        fireEvent.click(screen.getByText("Guardar"));
        await waitFor(() => expect(screen.getByText(/requiere rol Admin\/Owner/)).toBeTruthy());
        expect(datos.mutate).not.toHaveBeenCalled();
    });
});
