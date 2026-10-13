/**
 * RefundsDialog: lista los cobros que informa el servidor, deja pedir el reembolso sólo de los reembolsables y exige un motivo.
 * Se prueba con las traducciones reales (es.json), no con la clave, para que un texto que falte en el JSON rompa el test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import es from "../../messages/es.json";

vi.mock("next-intl", () => ({
    useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
        let node: any = (es as any)[ns];
        for (const part of key.split(".")) node = node?.[part];
        if (typeof node !== "string") return `MISSING:${ns}.${key}`;
        return node.replace(/\{(\w+)\}/g, (_m, k) => String(values?.[k] ?? ""));
    },
    useLocale: () => "es",
}));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

import RefundsDialog from "@/components/billing/RefundsDialog";

const TXN_OK = "txn_01m4rzzzzzzzzzzzzzzzzzzzzz";
const cobro = (extra: Record<string, unknown>) => ({
    transactionId: TXN_OK, amount: "299.99", currency: "USD", status: "completed", billedAt: new Date().toISOString(), addonKey: null, reembolsable: true, ...extra,
});

const fetchMock = vi.fn();
function servidor(cobros: unknown[], ventanaDias: number | null = 14) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") return { ok: true, json: async () => ({ success: true, adjustmentId: "adj_01", status: "pending_approval" }) };
        return { ok: true, json: async () => ({ success: true, cobros, ventanaDias }) };
    });
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

describe("RefundsDialog", () => {
    it("muestra la política con la ventana del Admin/Owner y los efectos del reembolso", async () => {
        servidor([cobro({})]);
        render(<RefundsDialog tenantId="t1" onClose={vi.fn()} />);
        expect(await screen.findByText(/dentro de los 14 días/)).toBeTruthy();
        expect(screen.getByText(/el acceso se corta de inmediato/)).toBeTruthy();
    });

    it("al SuperAdmin le dice que no hay límite de días", async () => {
        servidor([cobro({})], null);
        render(<RefundsDialog tenantId="t1" onClose={vi.fn()} />);
        expect(await screen.findByText(/sin límite de días/)).toBeTruthy();
    });

    it("sólo los cobros reembolsables tienen botón, y los demás dicen por qué", async () => {
        servidor([
            cobro({}),
            cobro({ transactionId: "txn_b", status: "refunded", reembolsable: false, motivo: "ya-reembolsado" }),
            cobro({ transactionId: "txn_c", reembolsable: false, motivo: "fuera-de-ventana" }),
            cobro({ transactionId: "txn_d", addonKey: "mod_security", status: "refund_pending", reembolsable: false, motivo: "en-proceso" }),
        ]);
        render(<RefundsDialog tenantId="t1" onClose={vi.fn()} />);
        await screen.findByText("Ya reembolsado");
        expect(screen.getAllByRole("button", { name: "Reembolsar" })).toHaveLength(1);
        expect(screen.getByText("Fuera de la ventana de 14 días")).toBeTruthy();
        expect(screen.getByText("Módulo: mod_security")).toBeTruthy();
    });

    it("no hay texto sin traducir en ninguno de los estados", async () => {
        servidor([cobro({}), cobro({ transactionId: "txn_b", status: "refunded", reembolsable: false, motivo: "ya-reembolsado" })]);
        const { container } = render(<RefundsDialog tenantId="t1" tenantName="ACME" onClose={vi.fn()} />);
        await screen.findByText("Ya reembolsado");
        fireEvent.click(screen.getByRole("button", { name: "Reembolsar" }));
        expect(container.textContent).not.toContain("MISSING:");
    });

    it("pedir el reembolso exige un motivo y manda tenant, transacción y motivo", async () => {
        servidor([cobro({})]);
        render(<RefundsDialog tenantId="t1" onClose={vi.fn()} />);
        fireEvent.click(await screen.findByRole("button", { name: "Reembolsar" }));

        const confirmar = screen.getByRole("button", { name: "Pedir reembolso" }) as HTMLButtonElement;
        expect(confirmar.disabled).toBe(true);

        fireEvent.change(screen.getByLabelText("Motivo del reembolso"), { target: { value: "El cliente contrató por error" } });
        expect(confirmar.disabled).toBe(false);
        fireEvent.click(confirmar);

        await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Reembolso pedido/));
        const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
        expect(post[0]).toBe("/api/billing/refunds");
        expect(JSON.parse(post[1].body)).toEqual({ tenantId: "t1", transactionId: TXN_OK, reason: "El cliente contrató por error" });
    });

    it("con varios cobros reembolsables pide el reembolso del que se eligió", async () => {
        servidor([cobro({}), cobro({ transactionId: "txn_el_segundo", amount: "49.00" })]);
        render(<RefundsDialog tenantId="t1" onClose={vi.fn()} />);
        const botones = await screen.findAllByRole("button", { name: "Reembolsar" });
        fireEvent.click(botones[1]);
        fireEvent.change(screen.getByLabelText("Motivo del reembolso"), { target: { value: "motivo suficiente" } });
        fireEvent.click(screen.getByRole("button", { name: "Pedir reembolso" }));
        await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
        const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
        expect(JSON.parse(post[1].body).transactionId).toBe("txn_el_segundo");
    });

    it("si el servidor rechaza, muestra su mensaje y no dice que se pidió", async () => {
        fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
            init?.method === "POST"
                ? { ok: false, json: async () => ({ error: "Ese cobro ya fue reembolsado." }) }
                : { ok: true, json: async () => ({ success: true, cobros: [cobro({})], ventanaDias: 14 }) }
        );
        render(<RefundsDialog tenantId="t1" onClose={vi.fn()} />);
        fireEvent.click(await screen.findByRole("button", { name: "Reembolsar" }));
        fireEvent.change(screen.getByLabelText("Motivo del reembolso"), { target: { value: "motivo suficiente" } });
        fireEvent.click(screen.getByRole("button", { name: "Pedir reembolso" }));
        expect((await screen.findByRole("alert")).textContent).toContain("Ese cobro ya fue reembolsado.");
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("si no se pueden cargar los cobros, lo dice", async () => {
        fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Acceso denegado" }) });
        render(<RefundsDialog tenantId="t1" onClose={vi.fn()} />);
        expect((await screen.findByRole("alert")).textContent).toContain("Acceso denegado");
    });
});
