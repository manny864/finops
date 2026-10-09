import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    lista: {} as any,
    setup: {} as any,
    detalle: {} as any,
    mutate: vi.fn(),
}));

// El mock contesta según la clave que se pide, como lo haría el servidor: el listado, el
// workflow para copiar y el desglose de una fila son tres endpoints distintos.
vi.mock("swr", () => ({
    default: (key: string | null) => {
        if (!key) return { data: undefined, error: undefined, isLoading: false, mutate: datos.mutate };
        if (key.includes("/shift-left/setup")) return { data: datos.setup, error: undefined, isLoading: false, mutate: vi.fn() };
        if (/\/shift-left\/\d+\?/.test(key)) return { data: datos.detalle, error: undefined, isLoading: false, mutate: vi.fn() };
        return { data: datos.lista, error: undefined, isLoading: false, mutate: datos.mutate };
    },
}));
vi.mock("@/components/TenantProvider", () => ({ useTenant: () => ({ selectedTenant: { id: "t1" } }) }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [{}] }) }));
vi.mock("@/lib/msalToken", () => ({ getFreshIdToken: async () => "token" }));
// Recharts mide el DOM, que en jsdom no tiene tamaño: se prueba el dato que le llega, no el SVG.
vi.mock("recharts", () => {
    const Nada = ({ children }: any) => <div>{children}</div>;
    return {
        ResponsiveContainer: Nada, LineChart: ({ data, children }: any) => <div data-testid="grafico" data-puntos={data?.length}>{children}</div>,
        Line: Nada, XAxis: Nada, YAxis: Nada, CartesianGrid: Nada, Tooltip: Nada, ReferenceLine: Nada,
    };
});

import ShiftLeftGovernanceBoard from "@/components/dashboard/ShiftLeftGovernanceBoard";

const fila = (o: Record<string, unknown>) => ({
    id: 1, repository: "acme/infra-azure", pr_number: 12, author: "lucia", commit_sha: "abc",
    current_monthly_cost_usd: "100.0000", projected_monthly_cost_usd: "350.0000", delta_cost_usd: "250.0000",
    resources_priced: 4, resources_unpriced: 0, gate_status: "OK", created_at: "2026-10-08T10:00:00Z", meta: null, ...o,
});

const seccion = (titulo: string) => within(screen.getByText(titulo).closest("section") as HTMLElement);

beforeEach(() => {
    vi.clearAllMocks();
    datos.lista = {
        items: [],
        kpis: { analizados: 0, aumentoDetectado: 0, ahorroDetectado: 0, bloqueados: 0 },
        gates: [{ repository: "acme/infra-azure", cost_center_name: null, threshold_usd: 500, threshold_pct_of_remaining: null }],
        costCenters: [{ cost_center_name: "Plataforma", monthly_budget_usd: "4000.00" }],
        pricing: { discount_pct: 0 },
    };
    datos.setup = { sha256: "a".repeat(64), snippets: { github: "name: costo\non: pull_request\n", azuredevops: "trigger: none\n", gitlab: "stages: [plan]\n" } };
    datos.detalle = { item: { meta: null }, lines: [] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as any;
});

describe("Budget Gates en el panel de Shift-Left (MEJ-20)", () => {
    it("muestra el umbral configurado de cada repo", () => {
        render(<ShiftLeftGovernanceBoard />);
        expect(screen.getByText("acme/infra-azure")).toBeTruthy();
        expect(screen.getByText(/500/)).toBeTruthy();
    });

    it("guarda un umbral nuevo y refresca la tabla", async () => {
        render(<ShiftLeftGovernanceBoard />);
        const gates = seccion("Budget Gates");
        fireEvent.change(gates.getByPlaceholderText("owner/repositorio"), { target: { value: "acme/plataforma" } });
        fireEvent.change(gates.getByPlaceholderText("USD por mes"), { target: { value: "120" } });
        fireEvent.click(gates.getByText("Guardar"));

        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        const [url, init] = (global.fetch as any).mock.calls[0];
        expect(url).toContain("/api/governance/shift-left/gates");
        expect(init.method).toBe("PUT");
        expect(JSON.parse(init.body)).toEqual({
            tenantId: "t1", repository: "acme/plataforma", threshold_usd: 120, threshold_pct_of_remaining: null, cost_center_name: null,
        });
        // Sin esto la fila nueva no aparece hasta que el usuario recarga.
        await waitFor(() => expect(datos.mutate).toHaveBeenCalled());
    });

    it("guarda un gate por porcentaje del presupuesto de un centro de costos", async () => {
        render(<ShiftLeftGovernanceBoard />);
        const gates = seccion("Budget Gates");
        fireEvent.change(gates.getByPlaceholderText("owner/repositorio"), { target: { value: "acme/plataforma" } });
        fireEvent.change(gates.getByLabelText("Centro de costos"), { target: { value: "Plataforma" } });
        fireEvent.change(gates.getByPlaceholderText("% del presupuesto restante"), { target: { value: "40" } });
        fireEvent.click(gates.getByText("Guardar"));

        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({
            tenantId: "t1", repository: "acme/plataforma", threshold_usd: null, threshold_pct_of_remaining: 40, cost_center_name: "Plataforma",
        });
    });

    it("el porcentaje no se puede cargar sin un centro de costos", () => {
        render(<ShiftLeftGovernanceBoard />);
        const pct = seccion("Budget Gates").getByPlaceholderText("% del presupuesto restante") as HTMLInputElement;
        expect(pct.disabled).toBe(true);
        fireEvent.change(seccion("Budget Gates").getByLabelText("Centro de costos"), { target: { value: "Plataforma" } });
        expect(pct.disabled).toBe(false);
    });

    // Quitar es el mismo PUT con null: si mandara 0, el repo quedaria con el
    // umbral mas estricto posible en vez de sin gate.
    it("quitar manda null y no cero, en los tres campos", async () => {
        render(<ShiftLeftGovernanceBoard />);
        fireEvent.click(screen.getByText("Quitar"));
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({
            tenantId: "t1", repository: "acme/infra-azure", threshold_usd: null, threshold_pct_of_remaining: null, cost_center_name: null,
        });
    });

    it("avisa cuando el guardado falla, en vez de quedarse callado", async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "requiere rol Admin/Owner" }) }) as any;
        render(<ShiftLeftGovernanceBoard />);
        const gates = seccion("Budget Gates");
        fireEvent.change(gates.getByPlaceholderText("owner/repositorio"), { target: { value: "acme/x" } });
        fireEvent.click(gates.getByText("Guardar"));
        await waitFor(() => expect(screen.getByText(/requiere rol Admin\/Owner/)).toBeTruthy());
        expect(datos.mutate).not.toHaveBeenCalled();
    });

    it("tocar un gate lo carga en el formulario para editarlo", () => {
        datos.lista.gates = [{ repository: "acme/infra-azure", cost_center_name: "Plataforma", threshold_usd: "500.0000", threshold_pct_of_remaining: "40.00" }];
        render(<ShiftLeftGovernanceBoard />);
        fireEvent.click(screen.getByText("acme/infra-azure"));
        const gates = seccion("Budget Gates");
        expect((gates.getByPlaceholderText("owner/repositorio") as HTMLInputElement).value).toBe("acme/infra-azure");
        expect((gates.getByPlaceholderText("USD por mes") as HTMLInputElement).value).toBe("500");
        expect((gates.getByLabelText("Centro de costos") as HTMLSelectElement).value).toBe("Plataforma");
        expect((gates.getByPlaceholderText("% del presupuesto restante") as HTMLInputElement).value).toBe("40");
    });
});

describe("descuento del cliente", () => {
    it("guarda el porcentaje y refresca", async () => {
        render(<ShiftLeftGovernanceBoard />);
        const precios = seccion("Precios");
        fireEvent.change(precios.getByLabelText("Descuento sobre el precio de lista (%)"), { target: { value: "17.5" } });
        fireEvent.click(precios.getByText("Guardar"));
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        const [url, init] = (global.fetch as any).mock.calls[0];
        expect(url).toContain("/api/governance/shift-left/pricing");
        expect(JSON.parse(init.body)).toEqual({ tenantId: "t1", discount_pct: 17.5 });
        await waitFor(() => expect(datos.mutate).toHaveBeenCalled());
    });

    it("el campo vacío manda null: sin descuento, no 0", async () => {
        datos.lista.pricing = { discount_pct: 20 };
        render(<ShiftLeftGovernanceBoard />);
        const precios = seccion("Precios");
        const campo = precios.getByLabelText("Descuento sobre el precio de lista (%)") as HTMLInputElement;
        expect(campo.value).toBe("20");
        fireEvent.change(campo, { target: { value: "" } });
        fireEvent.click(precios.getByText("Guardar"));
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ tenantId: "t1", discount_pct: null });
    });
});

describe("conectar el pipeline", () => {
    it("sin estimaciones muestra las instrucciones abiertas, con el workflow y el hash", () => {
        render(<ShiftLeftGovernanceBoard />);
        expect(screen.getByText("Conectar tu pipeline")).toBeTruthy();
        expect(screen.getByText(/name: costo/)).toBeTruthy();
        expect(screen.getByText("a".repeat(64))).toBeTruthy();
        expect(screen.getByText("Ocultar instrucciones")).toBeTruthy();
    });

    it("con estimaciones arranca cerrado, y se abre cuando se pide", () => {
        datos.lista.items = [fila({})];
        render(<ShiftLeftGovernanceBoard />);
        expect(screen.queryByText(/name: costo/)).toBeNull();
        fireEvent.click(screen.getByText("Ver instrucciones"));
        expect(screen.getByText(/name: costo/)).toBeTruthy();
    });

    it("cambia de plataforma y copia el workflow al portapapeles", async () => {
        const escribir = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText: escribir } });
        render(<ShiftLeftGovernanceBoard />);
        fireEvent.click(screen.getByText("Azure DevOps"));
        expect(screen.getByText(/trigger: none/)).toBeTruthy();
        fireEvent.click(screen.getByText("Copiar"));
        await waitFor(() => expect(escribir).toHaveBeenCalledWith("trigger: none\n"));
        await waitFor(() => expect(screen.getByText("Copiado")).toBeTruthy());
    });

    it("lleva a generar la API Key con el permiso correcto", () => {
        render(<ShiftLeftGovernanceBoard />);
        expect(screen.getByText(/write:shift-left/)).toBeTruthy();
        expect((screen.getByText("Ir a API Keys") as HTMLAnchorElement).getAttribute("href")).toBe("/es/admin/integrations?tab=api-keys");
    });

    it("ofrece las tres herramientas", () => {
        render(<ShiftLeftGovernanceBoard />);
        for (const h of ["Terraform", "OpenTofu", "Bicep"]) expect(screen.getByText(h)).toBeTruthy();
    });
});

describe("el historial", () => {
    beforeEach(() => {
        datos.lista.items = [
            fila({ id: 3, delta_cost_usd: "-80.0000", created_at: "2026-10-08T12:00:00Z", resources_unpriced: 2 }),
            fila({ id: 2, gate_status: "EXCEEDED", created_at: "2026-10-08T11:00:00Z",
                meta: { tool: "bicep", discount_pct: 20, list_delta_cost_usd: 312.5, gate_reason: "pct",
                    budget: { cost_center: "Plataforma", monthly_usd: 4000, spent_usd: 1000, remaining_usd: 3000, delta_pct_of_budget: 6.25, delta_pct_of_remaining: 8.33 } } }),
            fila({ id: 1, created_at: "2026-10-08T10:00:00Z" }),
        ];
        datos.lista.kpis = { analizados: 3, aumentoDetectado: 500, ahorroDetectado: 80, bloqueados: 1 };
    });

    it("muestra el delta con signo, el descuento, la herramienta, el presupuesto y por qué se bloqueó", () => {
        render(<ShiftLeftGovernanceBoard />);
        expect(screen.getByText("Umbral superado")).toBeTruthy();
        expect(screen.getByText("Superó el % del presupuesto")).toBeTruthy();
        expect(screen.getByText("bicep")).toBeTruthy();
        expect(screen.getByText("Con 20% de descuento")).toBeTruthy();
        // "Plataforma" también es una opción del selector de centros de costos: se mira dentro de la tabla.
        expect(within(screen.getByRole("table")).getByText("Plataforma")).toBeTruthy();
        expect(screen.getByText("6,3% del mensual")).toBeTruthy();
    });

    it("muestra la tendencia con una estimación por punto", () => {
        render(<ShiftLeftGovernanceBoard />);
        expect(screen.getByText("Evolución por repositorio")).toBeTruthy();
        expect(screen.getByTestId("grafico").getAttribute("data-puntos")).toBe("3");
    });

    it("al abrir una fila trae su desglose y traduce los motivos y los avisos", async () => {
        datos.detalle = {
            item: { meta: { discount_pct: 20, list_delta_cost_usd: 312.5, budget: { cost_center: "Plataforma", delta_pct_of_budget: 6.25, remaining_usd: 3000 } } },
            lines: [
                { direccion: "azurerm_storage_account.logs", tipo: "x", accion: "create", region: "westus2", mensualAntes: 0, mensualDespues: 0, delta: 0, motivo: "por-uso" },
                { direccion: "azurerm_firewall.hub", tipo: "x", accion: "create", region: "westus2", mensualAntes: 0, mensualDespues: 912.5, delta: 912.5, notas: ["datos-procesados-no-incluidos"] },
            ],
        };
        render(<ShiftLeftGovernanceBoard />);
        fireEvent.click(screen.getAllByLabelText("Ver desglose")[1]);
        await waitFor(() => expect(screen.getByText("azurerm_firewall.hub")).toBeTruthy());
        expect(screen.getByText("No incluye los datos procesados")).toBeTruthy();
        expect(screen.getByText("Se cobra por consumo")).toBeTruthy();
        expect(screen.getByText(/Presupuesto de Plataforma: este cambio pesa 6.25% del mensual/)).toBeTruthy();
        // Lo más caro primero.
        const recursos = screen.getAllByText(/^azurerm_/).map((n) => n.textContent);
        expect(recursos).toEqual(["azurerm_firewall.hub", "azurerm_storage_account.logs"]);

        fireEvent.click(screen.getByLabelText("Ocultar desglose"));
        expect(screen.queryByText("azurerm_firewall.hub")).toBeNull();
    });

    it("el CSV se puede exportar sólo si hay estimaciones", () => {
        render(<ShiftLeftGovernanceBoard />);
        expect((screen.getByText("Exportar CSV") as HTMLButtonElement).disabled).toBe(false);
    });

    it("sin estimaciones no hay CSV que exportar ni tendencia que mostrar", () => {
        datos.lista.items = [];
        render(<ShiftLeftGovernanceBoard />);
        expect((screen.getByText("Exportar CSV") as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByText("Evolución por repositorio")).toBeNull();
        expect(screen.getByText("Todavía no hay planes analizados")).toBeTruthy();
    });
});
