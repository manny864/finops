/**
 * CancellationRequestsDialog: lista las solicitudes que esperan al SuperAdmin y deja aprobarlas o rechazarlas. Se prueba con las
 * traducciones reales (es.json) para que un texto que falte en el JSON rompa el test.
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

import CancellationRequestsDialog from "@/components/superadmin/CancellationRequestsDialog";

const solicitud = (extra: Record<string, unknown> = {}) => ({
    id: 5, tenantId: "t1", companyName: "ACME", tier: "Business", accessUntil: null, tienePaddle: false, requestedBy: "owner@acme.com",
    reasonCode: "no-paddle-subscription", detail: null, status: "PENDING", createdAt: new Date().toISOString(),
    resolvedBy: null, resolvedAt: null, resolutionNote: null, cuotasPendientes: 0, montoPendiente: "0", ...extra,
});

const fetchMock = vi.fn();
function servidor(solicitudes: unknown[]) {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
        init?.method === "POST" ? { ok: true, json: async () => ({ success: true, id: 5, estado: "APPROVED" }) } : { ok: true, json: async () => ({ success: true, solicitudes }) }
    );
}
const posteo = () => fetchMock.mock.calls.find(([, init]) => init?.method === "POST");

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

describe("CancellationRequestsDialog", () => {
    it("muestra por qué no fue automática y quién la pidió, sin texto sin traducir", async () => {
        servidor([solicitud()]);
        const { container } = render(<CancellationRequestsDialog onClose={vi.fn()} />);
        expect(await screen.findByText("ACME")).toBeTruthy();
        expect(screen.getByText(/el tenant no tiene suscripción de Paddle/)).toBeTruthy();
        expect(screen.getByText(/owner@acme.com/)).toBeTruthy();
        expect(container.textContent).not.toContain("MISSING:");
    });

    it("avisa cuántas están pendientes (para el contador del botón)", async () => {
        servidor([solicitud(), solicitud({ id: 6, status: "REJECTED" })]);
        const alContar = vi.fn();
        render(<CancellationRequestsDialog onClose={vi.fn()} onPendingCount={alContar} />);
        await screen.findByText("Revisar");
        expect(alContar).toHaveBeenCalledWith(1);
    });

    it("advierte las cuotas de comisión que la baja cancelaría", async () => {
        servidor([solicitud({ cuotasPendientes: 2, montoPendiente: "58.0000" })]);
        render(<CancellationRequestsDialog onClose={vi.fn()} />);
        expect(await screen.findByText(/2 cuota\(s\) de comisión no exigibles \(58.0000\)/)).toBeTruthy();
    });

    it("rechazar exige un motivo y lo manda", async () => {
        servidor([solicitud({ tienePaddle: true })]);
        render(<CancellationRequestsDialog onClose={vi.fn()} />);
        fireEvent.click(await screen.findByText("Revisar"));
        const rechazar = screen.getByRole("button", { name: "Rechazar" }) as HTMLButtonElement;
        expect(rechazar.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: "Sigue con nosotros" } });
        expect(rechazar.disabled).toBe(false);
        fireEvent.click(rechazar);
        await waitFor(() => expect(posteo()).toBeTruthy());
        expect(posteo()![0]).toBe("/api/superadmin/cancellation-requests/5");
        expect(JSON.parse(posteo()![1].body)).toMatchObject({ decision: "reject", note: "Sigue con nosotros" });
        expect((await screen.findByRole("status")).textContent).toMatch(/rechazada/);
    });

    it("un tenant sin Paddle y sin fecha de acceso no se puede aprobar hasta indicar la fecha", async () => {
        servidor([solicitud()]);
        render(<CancellationRequestsDialog onClose={vi.fn()} />);
        fireEvent.click(await screen.findByText("Revisar"));
        const aprobar = screen.getByRole("button", { name: /Aprobar y ejecutar/ }) as HTMLButtonElement;
        expect(aprobar.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText(/Acceso hasta \(obligatorio\)/), { target: { value: "2030-01-31" } });
        expect(aprobar.disabled).toBe(false);
        fireEvent.click(aprobar);
        await waitFor(() => expect(posteo()).toBeTruthy());
        expect(JSON.parse(posteo()![1].body)).toMatchObject({ decision: "approve", effectiveDate: "2030-01-31" });
    });

    it("un tenant con Paddle ofrece 'ya la cancelé a mano' y lo manda como skipPaddle", async () => {
        servidor([solicitud({ tienePaddle: true, reasonCode: "paddle-rejected", detail: "Paddle: scheduled change" })]);
        render(<CancellationRequestsDialog onClose={vi.fn()} />);
        fireEvent.click(await screen.findByText("Revisar"));
        expect(screen.getByText(/Paddle: scheduled change/)).toBeTruthy();
        expect(screen.queryByLabelText(/Acceso hasta/)).toBeNull();
        fireEvent.click(screen.getByRole("checkbox"));
        fireEvent.click(screen.getByRole("button", { name: /Aprobar y ejecutar/ }));
        await waitFor(() => expect(posteo()).toBeTruthy());
        expect(JSON.parse(posteo()![1].body).skipPaddle).toBe(true);
    });

    it("si el servidor rechaza la aprobación (Paddle), muestra el mensaje y no dice que se ejecutó", async () => {
        fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
            init?.method === "POST" ? { ok: false, json: async () => ({ error: "Paddle no pudo programar la baja: x" }) } : { ok: true, json: async () => ({ success: true, solicitudes: [solicitud({ tienePaddle: true })] }) }
        );
        render(<CancellationRequestsDialog onClose={vi.fn()} />);
        fireEvent.click(await screen.findByText("Revisar"));
        fireEvent.click(screen.getByRole("button", { name: /Aprobar y ejecutar/ }));
        expect((await screen.findByRole("alert")).textContent).toContain("Paddle no pudo programar la baja");
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("las ya resueltas muestran quién y cuándo, sin botones de acción", async () => {
        servidor([solicitud({ status: "APPROVED", resolvedBy: "soporte@cscloudsolutions.com", resolvedAt: new Date().toISOString(), resolutionNote: "Confirmado" })]);
        render(<CancellationRequestsDialog onClose={vi.fn()} />);
        expect(await screen.findByText(/Resuelta por soporte@cscloudsolutions.com/)).toBeTruthy();
        expect(screen.queryByText("Revisar")).toBeNull();
    });

    it("sin solicitudes lo dice; y si no carga, muestra el error", async () => {
        servidor([]);
        const { unmount } = render(<CancellationRequestsDialog onClose={vi.fn()} />);
        expect(await screen.findByText("No hay solicitudes de cancelación.")).toBeTruthy();
        unmount();
        fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Acceso denegado" }) });
        render(<CancellationRequestsDialog onClose={vi.fn()} />);
        expect((await screen.findByRole("alert")).textContent).toContain("Acceso denegado");
    });
});
