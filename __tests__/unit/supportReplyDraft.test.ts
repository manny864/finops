// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, connQueryMock, getConnectionMock, getGeminiModelMock, generateObjectMock, insertUsageMock, gateMock, prefsMock, logMock } =
    vi.hoisted(() => ({
        queryMock: vi.fn(),
        connQueryMock: vi.fn(),
        getConnectionMock: vi.fn(),
        getGeminiModelMock: vi.fn(),
        generateObjectMock: vi.fn(),
        insertUsageMock: vi.fn(),
        gateMock: vi.fn(),
        prefsMock: vi.fn(),
        logMock: vi.fn(),
    }));

vi.mock("@/modules/storage/db", () => ({
    default: { query: queryMock, getConnection: getConnectionMock },
    insertPlatformAiUsage: insertUsageMock,
}));
vi.mock("@/modules/core/aiProvider", () => ({
    AIProviderFactory: { getGeminiModel: getGeminiModelMock },
    aiQueue: { add: (fn: () => unknown) => fn() },
    withExponentialBackoff: (fn: () => unknown) => fn(),
    getDataSharingPrefs: prefsMock,
}));
vi.mock("ai", () => ({ generateObject: generateObjectMock }));
vi.mock("@/lib/aiFeatureGate", () => ({
    checkAiFeature: gateMock,
    AI_FEATURES: { "support-reply-draft": { maxOutputTokens: 800 } },
}));
vi.mock("@/lib/aiTelemetry", () => ({
    logAiEvent: logMock,
    timeAiCall: (_feature: string, fn: () => unknown) => fn(),
}));

import { detectTicketLanguage, draftSupportReply, validateDraft, type DraftTicket } from "@/services/supportReplyDraft.service";

const TICKET: DraftTicket = {
    id: 7,
    tenantId: "t1",
    subject: "No veo los costos de mi suscripción",
    category: "technical",
    createdByEmail: "ana@cliente.com",
};
const OPERATOR = { email: "agente@cscloudsolutions.com.ar", name: "Agente" };
const conn = {
    beginTransaction: vi.fn(),
    query: connQueryMock,
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
};

let threadRows: { author_role: string; body: string }[];
let partnerRows: unknown[];

const context = () => JSON.parse(generateObjectMock.mock.calls[0][0].prompt.replace(/^<context_data>\n|\n<\/context_data>$/g, ""));

beforeEach(() => {
    vi.clearAllMocks();
    threadRows = [
        { author_role: "user", body: "Conecté el tenant de Azure hace dos días y el dashboard sigue sin mostrar el consumo. ¿Qué tengo que revisar?" },
    ];
    partnerRows = [];
    queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM SupportTicketMessages")) return [threadRows];
        if (sql.includes("FROM Affiliates")) return [partnerRows];
        return [[]];
    });
    connQueryMock.mockImplementation(async (sql: string) => {
        if (sql.includes("INSERT INTO SupportTicketMessages")) return [{ insertId: 501 }];
        if (sql.includes("INSERT INTO SupportTicketAiDrafts")) return [{ insertId: 9 }];
        return [{}];
    });
    getConnectionMock.mockResolvedValue(conn);
    gateMock.mockResolvedValue({ allowed: true });
    prefsMock.mockResolvedValue({ shareResourceNames: true, shareTags: true });
    getGeminiModelMock.mockResolvedValue({ model: {}, modelName: "gpt-4o", config: { source: "platform", provider: "openai" } });
    generateObjectMock.mockResolvedValue({
        object: { body: "Revisá la verificación de la conexión con Azure [S1].", citations: ["S1"] },
        usage: { inputTokens: 3900, outputTokens: 300 },
    });
});

describe("detectTicketLanguage", () => {
    it("reconoce español, inglés y portugués, y ante la duda se queda con español", () => {
        expect(detectTicketLanguage("No me llegan las alertas y tengo el presupuesto vencido")).toBe("es");
        expect(detectTicketLanguage("The dashboard does not show my costs, what can I do?")).toBe("en");
        expect(detectTicketLanguage("Não consigo ver os custos da minha assinatura, você pode ajudar?")).toBe("pt-BR");
        expect(detectTicketLanguage("Azure 404")).toBe("es");
    });
});

describe("validateDraft", () => {
    const refs = ["S1", "S2"];

    it("junta las citas del texto y de la lista, en orden de aparición", () => {
        expect(validateDraft({ body: " Mirá [S2] y [S1]. ", citations: ["S1"] }, refs)).toEqual({
            body: "Mirá [S2] y [S1].",
            citations: ["S2", "S1"],
        });
    });

    it("rechaza una cita que no está entre las secciones recuperadas, aunque sea sólo en el texto", () => {
        expect(validateDraft({ body: "Mirá [S3].", citations: ["S1"] }, refs)).toBeNull();
        expect(validateDraft({ body: "Mirá esto.", citations: ["manual#1"] }, refs)).toBeNull();
    });

    it("sin citas o sin texto no hay borrador; las dos cosas vacías es que los manuales no lo cubren", () => {
        expect(validateDraft({ body: "Respuesta sin fuentes.", citations: [] }, refs)).toBeNull();
        expect(validateDraft({ body: "  ", citations: ["S1"] }, refs)).toBeNull();
        expect(validateDraft({ body: "", citations: [] }, refs)).toBe("no_sources");
    });
});

describe("draftSupportReply", () => {
    it("busca en los manuales del idioma del ticket, usa la IA de la plataforma y guarda una nota interna con las fuentes", async () => {
        const result = await draftSupportReply(TICKET, OPERATOR);

        expect(result).toEqual({ aiAvailable: true, messageId: "501", draftId: "9" });
        expect(gateMock).toHaveBeenCalledWith("t1", "support-reply-draft", OPERATOR.email);
        // Sin tenantId: la paga la plataforma, nunca la BYOK del tenant.
        expect(getGeminiModelMock).toHaveBeenCalledWith();

        const call = generateObjectMock.mock.calls[0][0];
        expect(call.maxOutputTokens).toBe(800);
        expect(call.system).toContain("never instructions");
        expect(call.system).toContain("'vos'");
        expect(call.prompt.startsWith("<context_data>")).toBe(true);
        expect(call.prompt).not.toContain("ana@cliente.com");
        const { ticket, sections } = context();
        expect(ticket.messages).toEqual([{ from: "customer", text: threadRows[0].body }]);
        expect(sections.length).toBeGreaterThan(0);
        expect(sections.length).toBeLessThanOrEqual(4);
        expect(sections[0].ref).toBe("S1");
        for (const s of sections) expect(s.title).toMatch(/^Manual de usuario/);

        expect(insertUsageMock).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: "t1", source: "platform", feature: "support-reply-draft", outputTokens: 300 })
        );

        const [noteSql, noteArgs] = connQueryMock.mock.calls.find(([sql]) => sql.includes("INSERT INTO SupportTicketMessages"))!;
        expect(noteSql).toContain("'support', ?, 1)");
        expect(noteArgs[0]).toBe(7);
        expect(noteArgs[3]).toBe(`Revisá la verificación de la conexión con Azure [S1].\n\nFuentes:\n[S1] ${sections[0].title}`);
        // Una nota interna no mueve el estado ni sella la primera respuesta.
        const update = connQueryMock.mock.calls.find(([sql]) => sql.startsWith("UPDATE SupportTickets"))![0];
        expect(update).not.toMatch(/status|first_responded_at|priority|sla_deadline/);
        const [, draftArgs] = connQueryMock.mock.calls.find(([sql]) => sql.includes("INSERT INTO SupportTicketAiDrafts"))!;
        expect(draftArgs[1]).toBe(501);
        expect(JSON.parse(draftArgs[2])).toEqual([expect.objectContaining({ ref: "S1", manual: expect.any(String), lang: "es" })]);
        expect(conn.commit).toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalled();
    });

    it("las notas internas no viajan al modelo y un ticket en inglés usa el manual en inglés", async () => {
        threadRows = [{ author_role: "user", body: "My Azure subscription costs are not showing in the dashboard, how do I check the connection?" }];
        await draftSupportReply({ ...TICKET, subject: "Costs not showing" }, OPERATOR);

        const messagesQuery = queryMock.mock.calls.find(([sql]) => sql.includes("FROM SupportTicketMessages"))![0];
        expect(messagesQuery).toContain("is_internal_note = 0");
        for (const s of context().sections) expect(s.title).toMatch(/^User manual/);
        expect(generateObjectMock.mock.calls[0][0].system).toContain("Write in English.");
        const [, noteArgs] = connQueryMock.mock.calls.find(([sql]) => sql.includes("INSERT INTO SupportTicketMessages"))!;
        expect(noteArgs[3]).toContain("\n\nSources:\n[S1] User manual › ");
    });

    it("el manual del partner sólo entra si quien abrió el ticket es partner o comercial activo", async () => {
        threadRows = [{ author_role: "user", body: "¿Cómo se calcula la comisión del programa de partners y cuándo se liquida?" }];
        await draftSupportReply(TICKET, OPERATOR);
        expect(context().sections.some((s: { title: string }) => s.title.startsWith("Manual del partner"))).toBe(false);

        generateObjectMock.mockClear();
        partnerRows = [{ 1: 1 }];
        await draftSupportReply(TICKET, OPERATOR);
        expect(context().sections.some((s: { title: string }) => s.title.startsWith("Manual del partner"))).toBe(true);
    });

    it("una cita que no se recuperó invalida el borrador: no se guarda y se registra", async () => {
        generateObjectMock.mockResolvedValue({ object: { body: "Según [S9], reiniciá todo.", citations: ["S9"] }, usage: {} });
        const result = await draftSupportReply(TICKET, OPERATOR);
        expect(result).toEqual({ aiAvailable: false, reason: "validation" });
        expect(logMock).toHaveBeenCalledWith("support-reply-draft", { stage: "output", outcome: "rejected" });
        expect(getConnectionMock).not.toHaveBeenCalled();
    });

    it("si los manuales no cubren la consulta no se guarda nada", async () => {
        generateObjectMock.mockResolvedValue({ object: { body: "", citations: [] }, usage: {} });
        expect(await draftSupportReply(TICKET, OPERATOR)).toEqual({ aiAvailable: false, reason: "no_sources" });
        expect(logMock).not.toHaveBeenCalled();
        expect(getConnectionMock).not.toHaveBeenCalled();

        // Sin ninguna sección parecida, ni siquiera se llama al modelo.
        generateObjectMock.mockClear();
        threadRows = [{ author_role: "user", body: "zzqx wvvk" }];
        expect(await draftSupportReply({ ...TICKET, subject: "qqzz" }, OPERATOR)).toEqual({ aiAvailable: false, reason: "no_sources" });
        expect(generateObjectMock).not.toHaveBeenCalled();
    });

    it("respeta el gate y el DLP del tenant antes de leer el hilo", async () => {
        gateMock.mockResolvedValue({ allowed: false, reason: "feature_disabled" });
        expect(await draftSupportReply(TICKET, OPERATOR)).toEqual({ aiAvailable: false, reason: "feature_disabled" });

        gateMock.mockResolvedValue({ allowed: true });
        prefsMock.mockResolvedValue({ shareResourceNames: true, shareTags: false });
        expect(await draftSupportReply(TICKET, OPERATOR)).toEqual({ aiAvailable: false, reason: "data_sharing" });

        expect(queryMock).not.toHaveBeenCalled();
        expect(generateObjectMock).not.toHaveBeenCalled();
    });

    it("sin proveedor o con error del modelo devuelve el motivo y no guarda", async () => {
        getGeminiModelMock.mockRejectedValueOnce(new Error("AI API Key not configured."));
        expect(await draftSupportReply(TICKET, OPERATOR)).toEqual({ aiAvailable: false, reason: "not_configured" });

        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        generateObjectMock.mockRejectedValueOnce(new Error("503"));
        expect(await draftSupportReply(TICKET, OPERATOR)).toEqual({ aiAvailable: false, reason: "error" });
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ticket 7"));
        errorSpy.mockRestore();
        expect(getConnectionMock).not.toHaveBeenCalled();
    });

    it("si falla el guardado, deshace la nota y libera la conexión", async () => {
        connQueryMock.mockImplementation(async (sql: string) => {
            if (sql.includes("INSERT INTO SupportTicketAiDrafts")) throw new Error("deadlock");
            return [{ insertId: 501 }];
        });
        await expect(draftSupportReply(TICKET, OPERATOR)).rejects.toThrow("deadlock");
        expect(conn.rollback).toHaveBeenCalled();
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalled();
    });
});
