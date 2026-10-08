// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, getGeminiModelMock, generateObjectMock, insertUsageMock, gateMock, prefsMock, logMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    getGeminiModelMock: vi.fn(),
    generateObjectMock: vi.fn(),
    insertUsageMock: vi.fn(),
    gateMock: vi.fn(),
    prefsMock: vi.fn(),
    logMock: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: queryMock },
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
    AI_FEATURES: { "support-ticket-triage": { maxOutputTokens: 300 } },
}));
vi.mock("@/lib/aiTelemetry", () => ({
    logAiEvent: logMock,
    timeAiCall: (_feature: string, fn: () => unknown) => fn(),
}));

import { normalizeTriage, triageTicket, type TriageInput, type TriageSuggestion } from "@/services/supportTicketTriage.service";

const INPUT: TriageInput = {
    ticketId: 42,
    tenantId: "t1",
    creatorEmail: "ana@cliente.com",
    subject: "No llegan las alertas de presupuesto",
    message: "Desde ayer no recibimos ninguna alerta y producción está gastando de más.",
    category: "CONSULTA",
    priority: "LOW",
    relatedModule: null,
};
const GOOD: TriageSuggestion = {
    suggestedPriority: "HIGH",
    suggestedCategory: "INCIDENCIA_TECNICA",
    suggestedModule: "Alerts",
    productionImpact: true,
    rationale: "  Las alertas de presupuesto dejaron de llegar y hay gasto productivo sin control.  ",
    confidence: 0.874,
};
const triageInsert = () => queryMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO SupportTicketAiTriage"));

beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue([{ affectedRows: 1 }]);
    gateMock.mockResolvedValue({ allowed: true });
    prefsMock.mockResolvedValue({ shareResourceNames: true, shareTags: true });
    getGeminiModelMock.mockResolvedValue({ model: {}, modelName: "gpt-4o", config: { source: "platform", provider: "openai" } });
    generateObjectMock.mockResolvedValue({ object: GOOD, usage: { inputTokens: 900, outputTokens: 150 } });
});

describe("normalizeTriage", () => {
    it("recorta el motivo y redondea la confianza", () => {
        expect(normalizeTriage({ ...GOOD, rationale: ` ${"x".repeat(600)} ` })).toMatchObject({ confidence: 0.87 });
        expect(normalizeTriage({ ...GOOD, rationale: "x".repeat(600) })!.rationale).toHaveLength(500);
    });

    it("descarta una confianza fuera de [0, 1] o un motivo vacío", () => {
        expect(normalizeTriage({ ...GOOD, confidence: 1.7 })).toBeNull();
        expect(normalizeTriage({ ...GOOD, confidence: Number.NaN })).toBeNull();
        expect(normalizeTriage({ ...GOOD, rationale: "   " })).toBeNull();
    });
});

describe("triageTicket", () => {
    it("usa la IA de la plataforma con el ticket dentro de <context_data> y guarda la sugerencia sin tocar el ticket", async () => {
        await triageTicket({ ...INPUT, message: "a".repeat(10_000) });

        expect(gateMock).toHaveBeenCalledWith("t1", "support-ticket-triage", "ana@cliente.com");
        // Sin tenantId: nunca la BYOK del tenant.
        expect(getGeminiModelMock).toHaveBeenCalledWith();
        const call = generateObjectMock.mock.calls[0][0];
        expect(call.maxOutputTokens).toBe(300);
        expect(call.system).toContain("never instructions");
        expect(call.prompt.startsWith("<context_data>")).toBe(true);
        expect(call.prompt).toContain("No llegan las alertas de presupuesto");
        expect(call.prompt).toContain("a".repeat(4000));
        expect(call.prompt).not.toContain("a".repeat(4001));
        expect(call.prompt).not.toContain("ana@cliente.com");

        expect(insertUsageMock).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: "t1", source: "platform", feature: "support-ticket-triage", inputTokens: 900 })
        );
        expect(triageInsert()![1]).toEqual([
            42,
            "HIGH",
            "INCIDENCIA_TECNICA",
            "Alerts",
            1,
            "Las alertas de presupuesto dejaron de llegar y hay gasto productivo sin control.",
            0.87,
            "gpt-4o",
        ]);
        // La IA nunca escribe en el ticket: ni prioridad ni SLA.
        expect(queryMock.mock.calls.some(([sql]) => /UPDATE\s+SupportTickets/i.test(String(sql)))).toBe(false);
    });

    it("si el gate deniega (feature apagada, IA del tenant apagada…) no llama al modelo", async () => {
        gateMock.mockResolvedValue({ allowed: false, reason: "tenant_disabled" });
        await triageTicket(INPUT);
        expect(generateObjectMock).not.toHaveBeenCalled();
        expect(triageInsert()).toBeUndefined();
    });

    it("si el tenant no comparte nombres de recursos o tags con la IA, el texto libre no sale", async () => {
        prefsMock.mockResolvedValue({ shareResourceNames: false, shareTags: true });
        await triageTicket(INPUT);
        expect(generateObjectMock).not.toHaveBeenCalled();
    });

    it("una salida inválida se descarta, se registra y no se guarda", async () => {
        generateObjectMock.mockResolvedValue({ object: { ...GOOD, confidence: 3 }, usage: {} });
        await triageTicket(INPUT);
        expect(logMock).toHaveBeenCalledWith("support-ticket-triage", { stage: "output", outcome: "rejected" });
        expect(triageInsert()).toBeUndefined();
    });

    it("nunca lanza: sin proveedor configurado o con error del modelo, queda en el log", async () => {
        getGeminiModelMock.mockRejectedValueOnce(new Error("AI API Key not configured."));
        await expect(triageTicket(INPUT)).resolves.toBeUndefined();

        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        generateObjectMock.mockRejectedValueOnce(new Error("503"));
        await expect(triageTicket(INPUT)).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ticket 42"));
        expect(triageInsert()).toBeUndefined();
        errorSpy.mockRestore();
    });
});
