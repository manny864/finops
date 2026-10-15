// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, usageMock, genMock, timedMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    usageMock: vi.fn(),
    genMock: vi.fn(),
    timedMock: vi.fn((_feature: string, call: () => unknown) => call()),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock }, insertPlatformAiUsage: usageMock }));
vi.mock("@/services/aiService", () => ({ getAIConfig: vi.fn() }));
vi.mock("@/lib/aiTelemetry", () => ({ timeAiCall: timedMock }));
vi.mock("ai", () => ({ generateText: genMock }));

import { AIProviderFactory, aiQueue, getAssessment } from "@/modules/core/aiProvider";

const METRICS = [{ ServiceName: "VM", BilledCost: 10 }];
const system = () => String(genMock.mock.calls.at(-1)?.[0].system);
const cacheHash = (i: number) => queryMock.mock.calls.filter(([sql]) => String(sql).startsWith("SELECT response_text"))[i][1][0];

beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([[]]);
    usageMock.mockReset();
    timedMock.mockClear();
    genMock.mockReset().mockResolvedValue({ text: "## r", usage: { inputTokens: 1, outputTokens: 2 } });
    // La cola real espacia las llamadas al proveedor; acá no aporta.
    vi.spyOn(aiQueue, "add").mockImplementation((fn) => fn());
    vi.spyOn(AIProviderFactory, "getGeminiModel").mockResolvedValue({
        model: {},
        modelName: "gpt",
        config: { source: "platform", provider: "azure" },
    } as never);
});

describe("getAssessment", () => {
    it("sin opciones sigue como antes: español, USD y el uso como 'assessment'", async () => {
        await getAssessment(METRICS, "t1");
        expect(system()).toContain("en español formal");
        expect(system()).toContain("Período Actual (USD)");
        expect(system()).toContain("$X,XXX.XX USD");
        expect(genMock.mock.calls[0][0].maxOutputTokens).toBeUndefined();
        expect(timedMock).not.toHaveBeenCalled();
        expect(usageMock).toHaveBeenCalledWith(expect.objectContaining({ feature: "assessment" }));
    });

    // MEJ-42 punto 2: el prompt pedía USD y español sin importar el tenant.
    it("con la feature del gate, escribe en el idioma de la UI y rotula la moneda del archivo", async () => {
        await getAssessment(METRICS, "t1", {
            feature: "billing-upload-assessment",
            maxOutputTokens: 4000,
            locale: "en",
            currency: "EUR",
        });
        expect(system()).toContain("en inglés formal");
        expect(system()).toContain("Período Actual (EUR)");
        expect(system()).toContain("X,XXX.XX EUR");
        expect(system()).not.toContain("USD");
        expect(genMock.mock.calls[0][0].maxOutputTokens).toBe(4000);
        expect(timedMock).toHaveBeenCalledWith("billing-upload-assessment", expect.any(Function));
        // El cupo del gate cuenta las filas de PlatformAiUsage de su feature.
        expect(usageMock).toHaveBeenCalledWith(expect.objectContaining({ feature: "billing-upload-assessment" }));
    });

    it("si el archivo no dice la moneda, no la inventa", async () => {
        await getAssessment(METRICS, "t1", { currency: null });
        expect(system()).not.toContain("USD");
        expect(system()).toContain("sin símbolo ni código de moneda");
    });

    it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
        "AISEC-06: locale=%s (propiedad heredada) cae en español, no inyecta una función en el prompt",
        async (locale) => {
            await getAssessment(METRICS, "t1", { locale });
            expect(system()).toContain("en español formal");
            expect(system()).not.toMatch(/function|native code|\[object/);
        }
    );

    it("un idioma desconocido cae en español", async () => {
        await getAssessment(METRICS, "t1", { locale: "fr" });
        expect(system()).toContain("en español formal");
    });

    it("el idioma y la moneda separan la caché: no se sirve un reporte en otro idioma", async () => {
        await getAssessment(METRICS, "t1", { locale: "es" });
        await getAssessment(METRICS, "t1", { locale: "en" });
        await getAssessment(METRICS, "t1", { locale: "en", currency: "EUR" });
        expect(new Set([cacheHash(0), cacheHash(1), cacheHash(2)]).size).toBe(3);
    });
});
