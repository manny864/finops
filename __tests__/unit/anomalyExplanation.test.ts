// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, getGeminiModelMock, generateObjectMock, insertUsageMock, gateMock, redactMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    getGeminiModelMock: vi.fn(),
    generateObjectMock: vi.fn(),
    insertUsageMock: vi.fn(),
    gateMock: vi.fn(),
    // Redacción "de verdad" sobre el payload: así el test prueba que al modelo
    // le llega lo que devolvió el DLP y no el contexto original.
    redactMock: vi.fn(async (_tenantId: string, data: unknown) =>
        JSON.parse(JSON.stringify(data).split("rg-secret").join("[REDACTED]"))
    ),
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: queryMock },
    insertPlatformAiUsage: insertUsageMock,
}));
vi.mock("@/modules/core/aiProvider", () => ({
    AIProviderFactory: { getGeminiModel: getGeminiModelMock },
    aiQueue: { add: (fn: () => unknown) => fn() },
    withExponentialBackoff: (fn: () => unknown) => fn(),
    redactForTenant: redactMock,
}));
vi.mock("ai", () => ({ generateObject: generateObjectMock }));
vi.mock("@/lib/aiFeatureGate", () => ({
    checkAiFeature: gateMock,
    AI_FEATURES: { "anomaly-explanation": { maxOutputTokens: 600 } },
}));

import {
    buildExplanationContext,
    explanationFactsHash,
    getAnomalyExplanation,
    normalizeExplanationLocale,
    saveExplanationFeedback,
    validateExplanation,
    type ExplainableAnomaly,
} from "@/services/anomalyExplanation.service";
import type { AnomalyExplanation, RootCauseFact } from "@/types/anomalyRootCause.types";

const FACTS: RootCauseFact[] = [
    { id: "f1", type: "USAGE_INCREASE", serviceName: "Virtual Machines", meterName: "D4s v5", baseline: 100, actual: 180, delta: 80, costChangePct: 80, quantityChangePct: 75.5, unitCostChangePct: 2.5 },
    { id: "f2", type: "NEW_METER", serviceName: "Storage", meterName: "P30 LRS Disk", baseline: 0, actual: 40, delta: 40 },
];
const CONTRIBUTORS = [
    { resource_group: "rg-secret", service_name: "Virtual Machines", cost: 180, baseline_avg: 100, delta: 80, delta_pct_of_total: 66.7 },
    { resource_group: "rg-data", service_name: "Storage", cost: 40, baseline_avg: 0, delta: 40, delta_pct_of_total: 33.3 },
];
// Como llega de mysql2: DATE con timezone Z, DECIMAL como string, un JSON sin parsear.
const ANOMALY: ExplainableAnomaly = {
    id: 7,
    date: new Date("2026-10-05T00:00:00Z"),
    amount: "400.0000",
    expected_amount: "250.0000",
    z_score: "3.4567",
    top_contributors: JSON.stringify(CONTRIBUTORS),
    root_cause_facts: FACTS,
};
const GOOD: AnomalyExplanation = {
    summary: "El 5 de octubre el gasto fue un 60% mayor a lo esperado (z-score 3,5).",
    causes: [
        { factId: "f1", text: "El uso de D4s v5 en Virtual Machines subió un 75,5 % y el precio unitario apenas un 2,5 %." },
        { factId: "f2", text: "Apareció el medidor P30 LRS Disk, sin consumo en los 30 días previos." },
    ],
};
const CTX = buildExplanationContext(ANOMALY);
const explain = (anomaly: ExplainableAnomaly = ANOMALY) =>
    getAnomalyExplanation({ tenantId: "t1", userEmail: "ana@x.com", locale: "es", anomaly });
const insertCall = () => queryMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO AnomalyExplanations"));

beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue([[]]);
    gateMock.mockReset();
    gateMock.mockResolvedValue({ allowed: true });
    getGeminiModelMock.mockReset();
    getGeminiModelMock.mockResolvedValue({ model: {}, modelName: "gpt-4o", config: { source: "platform", provider: "openai" } });
    generateObjectMock.mockReset();
    generateObjectMock.mockResolvedValue({ object: GOOD, usage: { inputTokens: 300, outputTokens: 120 } });
    insertUsageMock.mockReset();
    redactMock.mockClear();
});

describe("buildExplanationContext", () => {
    it("sólo porcentajes calculados por código: ningún monto llega al modelo", () => {
        expect(CTX).toMatchObject({ date: "2026-10-05", zScore: 3.5, pctAboveExpected: 60, baselineDays: 30 });
        const json = JSON.stringify(CTX);
        for (const money of ['"baseline":', '"actual":', '"delta":', '"cost":', '"baseline_avg":']) {
            expect(json).not.toContain(money);
        }
    });
});

describe("validateExplanation", () => {
    it("acepta cifras de los hechos en formato es (coma) o en (punto) y nombres con dígitos", () => {
        expect(validateExplanation(GOOD, CTX)).toBeNull();
        const en = { ...GOOD, summary: "On 10/5 spend was 60% above expected; usage rose 75.5% in the E8s series." };
        expect(validateExplanation(en, CTX)).toBeNull();
    });

    it("rechaza una cifra que no está en los hechos", () => {
        expect(validateExplanation({ ...GOOD, summary: "El gasto subió un 45%." }, CTX)).toBe("number");
    });

    it("rechaza un factId que no existe", () => {
        expect(validateExplanation({ ...GOOD, causes: [{ factId: "f9", text: "Algo." }] }, CTX)).toBe("unknown_fact");
    });

    it("rechaza URLs, links markdown y HTML", () => {
        for (const summary of ["Mirá https://evil.example", "Ver [esto](x)", "<b>ojo</b>", "en www.evil.example"]) {
            expect(validateExplanation({ ...GOOD, summary }, CTX)).toBe("link");
        }
    });

    it("rechaza montos con moneda: la pantalla convierte, el modelo no", () => {
        expect(validateExplanation({ ...GOOD, summary: "Subió USD 80." }, CTX)).toBe("currency");
        expect(validateExplanation({ ...GOOD, summary: "Subió $80." }, CTX)).toBe("currency");
    });

    it("rechaza textos vacíos o demasiado largos", () => {
        expect(validateExplanation({ ...GOOD, summary: "  " }, CTX)).toBe("empty");
        expect(validateExplanation({ ...GOOD, summary: "a".repeat(401) }, CTX)).toBe("length");
    });
});

describe("getAnomalyExplanation", () => {
    it("sin hechos no gasta: ni gate ni modelo", async () => {
        expect(await explain({ ...ANOMALY, root_cause_facts: null })).toEqual({ aiAvailable: false, reason: "no_facts" });
        expect(gateMock).not.toHaveBeenCalled();
    });

    it("gate denegado: devuelve el motivo sin tocar caché ni modelo", async () => {
        gateMock.mockResolvedValue({ allowed: false, reason: "quota" });
        expect(await explain()).toEqual({ aiAvailable: false, reason: "quota" });
        expect(gateMock).toHaveBeenCalledWith("t1", "anomaly-explanation", "ana@x.com");
        expect(queryMock).not.toHaveBeenCalled();
        expect(generateObjectMock).not.toHaveBeenCalled();
    });

    it("hit de caché: no llama al modelo y devuelve el feedback guardado", async () => {
        queryMock.mockResolvedValueOnce([[{ explanation_json: JSON.stringify(GOOD), source: "ai", feedback: "up" }]]);
        const r = await explain();
        const hash = explanationFactsHash(await redactMock.mock.results[0].value);
        expect(r).toEqual({ aiAvailable: true, explanation: GOOD, factsHash: hash, feedback: "up" });
        expect(queryMock.mock.calls[0][1]).toEqual([7, "es", hash]);
        expect(getGeminiModelMock).not.toHaveBeenCalled();
        expect(generateObjectMock).not.toHaveBeenCalled();
    });

    it("una salida rechazada guardada no se vuelve a pedir", async () => {
        queryMock.mockResolvedValueOnce([[{ explanation_json: { reason: "number" }, source: "template", feedback: null }]]);
        expect(await explain()).toEqual({ aiAvailable: false, reason: "validation" });
        expect(generateObjectMock).not.toHaveBeenCalled();
    });

    it("genera con el payload redactado, mide el uso y guarda la explicación", async () => {
        const r = await explain();
        const redacted = await redactMock.mock.results[0].value;
        const hash = explanationFactsHash(redacted);
        expect(r).toEqual({ aiAvailable: true, explanation: GOOD, factsHash: hash, feedback: null });

        const call = generateObjectMock.mock.calls[0][0];
        expect(call.prompt).toContain("<context_data>");
        expect(call.prompt).toContain("[REDACTED]");
        expect(call.prompt).not.toContain("rg-secret");
        expect(call.system).toContain("Spanish");
        expect(call.maxOutputTokens).toBe(600);
        expect(insertUsageMock).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: "t1", feature: "anomaly-explanation", source: "platform", inputTokens: 300, outputTokens: 120,
        }));
        expect(insertCall()?.[1]).toEqual([7, "es", hash, JSON.stringify(GOOD), "ai", "gpt-4o"]);
    });

    it("salida con un número inventado: se guarda como plantilla con el motivo y no se muestra", async () => {
        generateObjectMock.mockResolvedValue({ object: { ...GOOD, summary: "Subió un 45%." }, usage: {} });
        expect(await explain()).toEqual({ aiAvailable: false, reason: "validation" });
        const params = insertCall()?.[1];
        expect(params?.[3]).toBe(JSON.stringify({ reason: "number" }));
        expect(params?.[4]).toBe("template");
        expect(insertUsageMock).toHaveBeenCalled();
    });

    it("sin proveedor de IA configurado: not_configured y nada guardado", async () => {
        getGeminiModelMock.mockRejectedValue(new Error("AI API Key not configured."));
        expect(await explain()).toEqual({ aiAvailable: false, reason: "not_configured" });
        expect(insertCall()).toBeUndefined();
    });

    it("un error del modelo es transitorio: no se guarda ni se mide", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        generateObjectMock.mockRejectedValue(new Error("timeout"));
        expect(await explain()).toEqual({ aiAvailable: false, reason: "error" });
        expect(insertCall()).toBeUndefined();
        expect(insertUsageMock).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("si falla el guardado, la explicación ya pagada se devuelve igual", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        queryMock.mockResolvedValueOnce([[]]).mockRejectedValueOnce(new Error("db down"));
        expect((await explain()).aiAvailable).toBe(true);
        spy.mockRestore();
    });
});

describe("saveExplanationFeedback", () => {
    const HASH = "a".repeat(64);
    const save = () => saveExplanationFeedback({ tenantId: "t1", anomalyId: 7, locale: "es", factsHash: HASH, feedback: "up", userEmail: "ana@x.com" });

    it("filtra por tenant vía Anomalies y sólo sobre explicaciones de IA", async () => {
        queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
        expect(await save()).toBe(true);
        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain("JOIN Anomalies a ON a.id = e.anomaly_id");
        expect(sql).toContain("a.tenant_id = ?");
        expect(sql).toContain("e.source = 'ai'");
        expect(params).toEqual(["up", "ana@x.com", 7, "t1", "es", HASH]);
    });

    it("false si no hay fila (otro tenant, otro hash o una plantilla)", async () => {
        queryMock.mockResolvedValueOnce([{ affectedRows: 0 }]);
        expect(await save()).toBe(false);
    });
});

describe("normalizeExplanationLocale", () => {
    it("lleva accept-language o ?locale a es, en o pt-BR", () => {
        expect(normalizeExplanationLocale("pt-BR,pt;q=0.9")).toBe("pt-BR");
        expect(normalizeExplanationLocale("en-US,en;q=0.8")).toBe("en");
        expect(normalizeExplanationLocale("fr")).toBe("es");
        expect(normalizeExplanationLocale(null)).toBe("es");
    });
});
