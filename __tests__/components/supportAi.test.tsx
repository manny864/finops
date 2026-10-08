import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import React from "react";
import TicketConversationDrawer, { type DrawerActions, type DrawerMode } from "@/components/support/TicketConversationDrawer";
import SuperAdminSupportPage from "@/app/[locale]/superadmin/support/page";
import { PRIORITY_I18N } from "@/components/support/supportUi";
import type {
    GlobalSupportPayload,
    SupportTicketAiTriage,
    SupportTicketItem,
    TicketMessageItem,
} from "@/types/supportTickets.types";

/**
 * IA de soporte (Fase 3) en la UI: la sugerencia de triaje sólo la ve y la
 * decide el equipo, el borrador de "Sugerir respuesta" nunca se envía solo, y
 * "usado" es sólo el borrador que pasó al compositor con "Usar como respuesta".
 */

const mocks = vi.hoisted(() => ({
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    // Referencias estables: la página las usa en deps de useCallback/useEffect.
    msal: { instance: {}, accounts: [{ username: "agente@cscloudsolutions.com.ar" }] },
    searchParams: new URLSearchParams(),
}));

// Resuelve contra messages/es.json (falla si falta la clave) e interpola {x}.
// Una función estable por namespace, como la real.
vi.mock("next-intl", async () => {
    const { readFileSync } = await import("node:fs");
    const es = JSON.parse(readFileSync("messages/es.json", "utf-8"));
    const cache: Record<string, (key: string, values?: Record<string, unknown>) => string> = {};
    return {
        useLocale: () => "es",
        useTranslations: (ns: string) =>
            (cache[ns] ??= (key, values) => {
                const raw: string = es[ns]?.[key] ?? key;
                return values ? raw.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m)) : raw;
            }),
    };
});
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => mocks.msal }));
vi.mock("@/lib/msalToken", () => ({ getFreshIdToken: async () => "token-de-prueba" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.searchParams }));

const es = JSON.parse(readFileSync("messages/es.json", "utf-8"));
const S = es.Support as Record<string, string>;
const A = es.SuperAdminSupport as Record<string, string>;
const AI_LABEL = es.Anomalies.aiGeneratedLabel as string;

const ahora = new Date().toISOString();

function ticket(over: Partial<SupportTicketItem> = {}): SupportTicketItem {
    return {
        id: "1",
        ticketNumber: "TCK-0001",
        tenantId: "tenant-a",
        tenantDisplayName: "Contoso",
        creatorUserId: "u1",
        creatorEmail: "ana@contoso.com",
        creatorName: "Ana",
        subject: "Las alertas de presupuesto no llegan",
        category: "CONSULTA",
        priority: "LOW",
        status: "OPEN",
        slaDeadlineIso: new Date(Date.now() + 8 * 3_600_000).toISOString(),
        slaRemainingMinutes: 480,
        isSlaBreachRisk: false,
        createdAt: ahora,
        updatedAt: ahora,
        messagesCount: 1,
        ...over,
    };
}

function triage(over: Partial<SupportTicketAiTriage> = {}): SupportTicketAiTriage {
    return {
        suggestedPriority: "CRITICAL",
        suggestedCategory: "INCIDENCIA_TECNICA",
        suggestedModule: "Alerts",
        productionImpact: true,
        rationale: "El cliente reporta que dejaron de llegar las alertas de un entorno productivo.",
        confidence: 0.82,
        status: "pending",
        ...over,
    };
}

const mensajeCliente: TicketMessageItem = {
    id: "m1",
    ticketId: "1",
    senderUserId: "u1",
    senderEmail: "ana@contoso.com",
    senderName: "Ana",
    senderRole: "USER",
    messageText: "Desde ayer no me llegan las alertas.",
    isInternalNote: false,
    createdAt: ahora,
};

const notaBorrador: TicketMessageItem = {
    id: "m2",
    ticketId: "1",
    senderUserId: "",
    senderEmail: "agente@cscloudsolutions.com.ar",
    senderName: "Agente",
    senderRole: "SUPPORT_AGENT",
    messageText: "Hola, Ana. Revisá los destinatarios de la alerta [S1] Manual de usuario › Alertas.",
    isInternalNote: true,
    aiDraftId: "3",
    createdAt: ahora,
};

function acciones(over: Partial<DrawerActions> = {}): DrawerActions {
    return {
        sendMessage: vi.fn(async () => 10),
        uploadAttachment: vi.fn(async () => true),
        downloadAttachment: vi.fn(async () => {}),
        previewAttachment: vi.fn(async () => null),
        refresh: vi.fn(async () => {}),
        ...over,
    };
}

function drawer({
    tk = ticket(),
    messages = [mensajeCliente],
    mode = "agent",
    actions = acciones(),
}: { tk?: SupportTicketItem; messages?: TicketMessageItem[]; mode?: DrawerMode; actions?: DrawerActions } = {}) {
    return (
        <TicketConversationDrawer
            ticket={tk}
            messages={messages}
            orphanAttachments={[]}
            mode={mode}
            loading={false}
            onClose={vi.fn()}
            actions={actions}
        />
    );
}

const tarjetaTriaje = () => screen.getByText(S.aiTriageTitle).closest(".rounded-lg") as HTMLElement;

describe("TicketConversationDrawer: IA de soporte", () => {
    beforeEach(() => vi.clearAllMocks());

    it("muestra la sugerencia de triaje pendiente y delega aceptar y descartar", async () => {
        const actions = acciones({ decideAiTriage: vi.fn(async () => {}) });
        render(drawer({ tk: ticket({ aiTriage: triage() }), actions }));

        const card = tarjetaTriaje();
        expect(within(card).getByText("Confianza: 82%")).toBeInTheDocument();
        expect(within(card).getByText(S[PRIORITY_I18N.CRITICAL])).toBeInTheDocument();
        expect(within(card).getByText(S.category_technical)).toBeInTheDocument();
        expect(within(card).getByText(S.module_Alerts)).toBeInTheDocument();
        expect(within(card).getByText(triage().rationale)).toBeInTheDocument();
        expect(within(card).getByText(AI_LABEL)).toBeInTheDocument();
        expect(screen.getByText(S.aiProductionImpact)).toBeInTheDocument();

        const aceptar = within(card).getByRole("button", { name: S.aiTriageAccept });
        fireEvent.click(aceptar);
        await waitFor(() => expect(actions.decideAiTriage).toHaveBeenCalledWith("accept"));
        await waitFor(() => expect(aceptar).toBeEnabled());

        fireEvent.click(within(card).getByRole("button", { name: S.aiTriageDismiss }));
        await waitFor(() => expect(actions.decideAiTriage).toHaveBeenCalledWith("dismiss"));
    });

    it("una sugerencia ya decidida no se vuelve a ofrecer; el impacto se apaga sólo al descartarla", () => {
        const { rerender } = render(drawer({ tk: ticket({ aiTriage: triage({ status: "accepted" }) }) }));
        expect(screen.queryByText(S.aiTriageTitle)).toBeNull();
        expect(screen.getByText(S.aiProductionImpact)).toBeInTheDocument();

        rerender(drawer({ tk: ticket({ aiTriage: triage({ status: "dismissed" }) }) }));
        expect(screen.queryByText(S.aiProductionImpact)).toBeNull();
    });

    it("Sugerir respuesta: sin borrador muestra el motivo traducido y no recarga", async () => {
        const actions = acciones({ suggestReply: vi.fn(async () => ({ aiAvailable: false as const, reason: "tenant_disabled" as const })) });
        render(drawer({ actions }));

        fireEvent.click(screen.getByRole("button", { name: S.aiSuggestReply }));

        expect(await screen.findByText(S.aiReason_tenant_disabled)).toBeInTheDocument();
        expect(actions.refresh).not.toHaveBeenCalled();
    });

    it("Sugerir respuesta: con borrador avisa que quedó como nota interna y recarga el hilo", async () => {
        const actions = acciones({ suggestReply: vi.fn(async () => ({ aiAvailable: true as const, messageId: "9", draftId: "3" })) });
        render(drawer({ actions }));

        fireEvent.click(screen.getByRole("button", { name: S.aiSuggestReply }));

        await waitFor(() => expect(actions.refresh).toHaveBeenCalled());
        expect(mocks.toastSuccess).toHaveBeenCalledWith(S.aiDraftSaved);
        expect(actions.sendMessage).not.toHaveBeenCalled();
    });

    it("Usar como respuesta: pasa el borrador al compositor como respuesta pública y lo envía con su id", async () => {
        const actions = acciones();
        render(drawer({ messages: [mensajeCliente, notaBorrador], actions }));
        expect(screen.getByText(S.aiDraftTag)).toBeInTheDocument();

        // Aunque el operador esté en modo nota interna, el borrador vuelve a respuesta pública.
        fireEvent.click(screen.getByRole("button", { name: S.internalNote }));
        fireEvent.click(screen.getByRole("button", { name: S.aiUseAsReply }));

        const box = screen.getByPlaceholderText(S.replyPlaceholder) as HTMLTextAreaElement;
        expect(box.value).toBe(notaBorrador.messageText);
        expect(screen.getAllByText(AI_LABEL)).toHaveLength(2); // nota + compositor

        fireEvent.click(screen.getByRole("button", { name: S.sendReply }));

        await waitFor(() => expect(actions.sendMessage).toHaveBeenCalledWith(notaBorrador.messageText, false, "3"));
        await waitFor(() => expect(actions.refresh).toHaveBeenCalled());
        expect(screen.getAllByText(AI_LABEL)).toHaveLength(1);
    });

    it("si el operador vacía el compositor, lo que escriba después ya no cuenta como borrador usado", async () => {
        const actions = acciones();
        render(drawer({ messages: [mensajeCliente, notaBorrador], actions }));

        fireEvent.click(screen.getByRole("button", { name: S.aiUseAsReply }));
        const box = screen.getByPlaceholderText(S.replyPlaceholder) as HTMLTextAreaElement;
        fireEvent.change(box, { target: { value: "" } });
        expect(screen.getAllByText(AI_LABEL)).toHaveLength(1);

        fireEvent.change(box, { target: { value: "Respuesta escrita a mano." } });
        fireEvent.click(screen.getByRole("button", { name: S.sendReply }));

        await waitFor(() => expect(actions.sendMessage).toHaveBeenCalledWith("Respuesta escrita a mano.", false, undefined));
    });

    it("en un ticket cerrado el borrador no se puede pasar al compositor", () => {
        render(drawer({ tk: ticket({ status: "CLOSED" }), messages: [notaBorrador] }));
        expect(screen.getByText(S.aiDraftTag)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: S.aiUseAsReply })).toBeNull();
    });

    it("el cliente no ve nada de la IA de soporte", () => {
        const actions = acciones({ decideAiTriage: vi.fn(), suggestReply: vi.fn() });
        render(drawer({ tk: ticket({ aiTriage: triage() }), mode: "user", actions }));

        expect(screen.queryByText(S.aiTriageTitle)).toBeNull();
        expect(screen.queryByText(S.aiProductionImpact)).toBeNull();
        expect(screen.queryByRole("button", { name: S.aiSuggestReply })).toBeNull();
    });
});

describe("Soporte (Global): IA de soporte en la cola", () => {
    const conImpacto = ticket({ aiTriage: triage() });
    const sinImpacto = ticket({ id: "2", ticketNumber: "TCK-0002", subject: "Consulta sobre facturas", aiTriage: triage({ productionImpact: false }) });

    function cola(over: Partial<GlobalSupportPayload> = {}): GlobalSupportPayload {
        return {
            summary: { totalTicketsCount: 2, unassignedCount: 2, slaBreachRiskCount: 0, avgResolutionTimeHours: 0, tickets: [conImpacto, sinImpacto] },
            statusCounts: { OPEN: 2, IN_PROGRESS: 0, WAITING_USER: 0, RESOLVED: 0, CLOSED: 0 },
            source: "live",
            lastUpdated: ahora,
            kpis: { windowDays: 30, ticketsCreated: 12, avgFirstResponseHours: 3.5, slaBreaches: 2, aiDraftsGenerated: 4, aiDraftsUsed: 3 },
            ...over,
        };
    }

    const respuesta = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

    function mockFetch(payload: GlobalSupportPayload) {
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            const method = init?.method ?? "GET";
            if (method === "GET" && url.startsWith("/api/admin/support/tickets")) return respuesta(payload);
            // El detalle no trae el triaje: la página tiene que conservar el de la cola.
            if (method === "GET" && url.startsWith("/api/support/tickets/1?")) {
                return respuesta({ ticket: { ...conImpacto, aiTriage: undefined }, messages: [mensajeCliente], attachments: [] });
            }
            if (method === "PATCH" && url === "/api/support/tickets/1") return respuesta({ success: true });
            if (method === "POST" && url === "/api/admin/support/tickets/1/ai-triage") return respuesta({ success: true, status: "accepted" });
            return respuesta({ error: `sin mock: ${method} ${url}` }, 500);
        });
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it("destaca los tickets con impacto productivo y muestra los KPIs de la ventana", async () => {
        mockFetch(cola());
        render(<SuperAdminSupportPage />);

        const fila = (await screen.findByText(conImpacto.subject)).closest("tr") as HTMLElement;
        expect(fila.className).toContain("bg-rose-50/60");
        expect(within(fila).getByText(S.aiProductionImpact)).toBeInTheDocument();
        const otra = screen.getByText(sinImpacto.subject).closest("tr") as HTMLElement;
        expect(otra.className).not.toContain("bg-rose-50/60");
        expect(within(otra).queryByText(S.aiProductionImpact)).toBeNull();

        expect(screen.getByText("Primera respuesta (30 d)")).toBeInTheDocument();
        expect(screen.getByText("3.5 h")).toBeInTheDocument();
        expect(screen.getByText("12 tickets creados")).toBeInTheDocument();
        expect(screen.getByText("SLA incumplido (30 d)")).toBeInTheDocument();
        expect(screen.getByText("Borradores con IA usados (30 d)")).toBeInTheDocument();
        expect(screen.getByText("75%")).toBeInTheDocument();
        expect(screen.getByText("3 de 4 borradores")).toBeInTheDocument();
    });

    it("sin KPIs (no se pudieron calcular) la cola se muestra igual, sin esa fila", async () => {
        mockFetch(cola({ kpis: undefined }));
        render(<SuperAdminSupportPage />);

        expect(await screen.findByText(conImpacto.subject)).toBeInTheDocument();
        expect(screen.queryByText("Primera respuesta (30 d)")).toBeNull();
    });

    it("aceptar la sugerencia hace el PATCH existente con valores de base y después registra la decisión", async () => {
        const fetchMock = mockFetch(cola());
        render(<SuperAdminSupportPage />);

        const fila = (await screen.findByText(conImpacto.subject)).closest("tr") as HTMLElement;
        fireEvent.click(within(fila).getByRole("button", { name: A.attend }));
        await screen.findByText(mensajeCliente.messageText);

        fireEvent.click(within(tarjetaTriaje()).getByRole("button", { name: S.aiTriageAccept }));
        await waitFor(() => expect(screen.queryByText(S.aiTriageTitle)).toBeNull());

        const escrituras = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH" || init?.method === "POST");
        expect(escrituras.map(([url, init]) => `${init?.method} ${url}`)).toEqual([
            "PATCH /api/support/tickets/1",
            "POST /api/admin/support/tickets/1/ai-triage",
        ]);
        // Nunca manda sla_deadline: el vencimiento del SLA no cambia al aceptar.
        expect(JSON.parse(String(escrituras[0][1]?.body))).toEqual({
            tenantId: "tenant-a",
            priority: "urgent",
            category: "technical",
            relatedModule: "Alerts",
        });
        expect(JSON.parse(String(escrituras[1][1]?.body))).toEqual({ decision: "accept" });
        expect(mocks.toastError).not.toHaveBeenCalled();
    });
});
