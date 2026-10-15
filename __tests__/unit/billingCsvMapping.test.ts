// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, insertUsageMock, getGeminiModelMock, generateObjectMock, gateMock, redactMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    insertUsageMock: vi.fn(),
    getGeminiModelMock: vi.fn(),
    generateObjectMock: vi.fn(),
    gateMock: vi.fn(),
    redactMock: vi.fn(async (_tenantId: string, data: unknown) =>
        JSON.parse(JSON.stringify(data).split("rg-secret").join("[REDACTED]"))
    ),
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: queryMock },
    insertPlatformAiUsage: insertUsageMock,
}));
// El atajo FOCUS es el real: el test cubre que un FOCUS no toca la IA.
vi.mock("@/modules/core/aiProvider", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/modules/core/aiProvider")>()),
    AIProviderFactory: { getGeminiModel: getGeminiModelMock },
    aiQueue: { add: (fn: () => unknown) => fn() },
    withExponentialBackoff: (fn: () => unknown) => fn(),
    redactForTenant: redactMock,
}));
vi.mock("ai", () => ({ generateObject: generateObjectMock }));
vi.mock("@/lib/aiFeatureGate", () => ({
    checkAiFeature: gateMock,
    AI_FEATURES: { "billing-csv-column-mapping": { maxOutputTokens: 800 } },
}));

import {
    applyCsvMapping,
    csvCurrency,
    CsvMappingError,
    decimalSeparatorOf,
    normalizeBillingCsv,
    parseCsvAmount,
    toIsoDate,
    validateCsvMapping,
    type CsvColumnMapping,
} from "@/services/billingCsvMapping.service";

/** Fila de un CUR de AWS: columnas propias, no FOCUS. */
const awsRow = (i: number) => ({
    "lineItem/UsageAccountId": "123456789012",
    "product/ProductName": i % 2 ? "Amazon EC2" : "Amazon S3",
    "lineItem/UsageStartDate": "2026-07-28T00:00:00Z",
    "lineItem/UnblendedCost": "1.50",
    "resourceTags/user:owner": "rg-secret",
});
const HEADERS = Object.keys(awsRow(0));
const MAPPING: CsvColumnMapping = {
    provider: "AWS",
    mappings: [
        { sourceColumn: "lineItem/UsageAccountId", focusField: "SubAccountId" },
        { sourceColumn: "product/ProductName", focusField: "ServiceName" },
        { sourceColumn: "lineItem/UsageStartDate", focusField: "UsageDate" },
        { sourceColumn: "lineItem/UnblendedCost", focusField: "BilledCost" },
    ],
    dateFormat: "YMD",
};
const ROWS = Array.from({ length: 60 }, (_, i) => awsRow(i));
const AI = { model: "m", modelName: "gpt-x", config: { source: "platform", provider: "azure" } };

beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue([[]]);
    insertUsageMock.mockReset();
    getGeminiModelMock.mockReset();
    getGeminiModelMock.mockResolvedValue(AI);
    generateObjectMock.mockReset();
    generateObjectMock.mockResolvedValue({ object: MAPPING, usage: { inputTokens: 3000, outputTokens: 120 } });
    gateMock.mockReset();
    gateMock.mockResolvedValue({ allowed: true });
    redactMock.mockClear();
});

describe("montos", () => {
    it("lee los formatos de un CSV exportado a mano", () => {
        expect(parseCsvAmount("12.34")).toBe(12.34);
        expect(parseCsvAmount("1,234.56")).toBe(1234.56);
        expect(parseCsvAmount("1.234,56", ",")).toBe(1234.56);
        expect(parseCsvAmount("$ 12")).toBe(12);
        expect(parseCsvAmount("1.2E-05")).toBeCloseTo(0.000012);
        expect(parseCsvAmount(7)).toBe(7);
        expect(parseCsvAmount("n/a")).toBe(0);
        expect(parseCsvAmount("")).toBe(0);
    });

    it("el separador decimal lo decide el primer valor no ambiguo del archivo", () => {
        expect(decimalSeparatorOf(["1,234", "12.5"])).toBe(".");
        expect(decimalSeparatorOf(["1.234", "12,5"])).toBe(",");
        expect(decimalSeparatorOf(["1.234,56"])).toBe(",");
        // "0,123" no puede ser un millar: es un decimal.
        expect(decimalSeparatorOf(["0,123"])).toBe(",");
        expect(decimalSeparatorOf(["1,234"])).toBe(".");
        expect(decimalSeparatorOf([])).toBe(".");
    });
});

describe("fechas", () => {
    it("normaliza a YYYY-MM-DD y no adivina", () => {
        expect(toIsoDate("2026-07-28T03:00:00Z", "YMD")).toBe("2026-07-28");
        expect(toIsoDate("2026-07-28 00:00:00 UTC", "YMD")).toBe("2026-07-28");
        expect(toIsoDate("20260728", "YMD")).toBe("2026-07-28");
        expect(toIsoDate("07/28/2026", "MDY")).toBe("2026-07-28");
        expect(toIsoDate("28/07/2026", "DMY")).toBe("2026-07-28");
        expect(toIsoDate("28/07/2026", "MDY")).toBe("");
        expect(toIsoDate("Jul 28", "YMD")).toBe("");
        expect(toIsoDate("", "YMD")).toBe("");
    });
});

describe("validateCsvMapping", () => {
    it("acepta un mapeo con costo y servicio sobre columnas reales", () => {
        expect(validateCsvMapping(MAPPING, HEADERS)).toBeNull();
    });

    it("rechaza columnas inventadas, campos duplicados y faltantes", () => {
        const inventada = { ...MAPPING, mappings: [...MAPPING.mappings, { sourceColumn: "Cost", focusField: "EffectiveCost" as const }] };
        expect(validateCsvMapping(inventada, HEADERS)).toContain("Cost");
        const duplicada = { ...MAPPING, mappings: [...MAPPING.mappings, { sourceColumn: "lineItem/UsageAccountId", focusField: "BilledCost" as const }] };
        expect(validateCsvMapping(duplicada, HEADERS)).toContain("BilledCost");
        const sinServicio = { ...MAPPING, mappings: MAPPING.mappings.filter((m) => m.focusField !== "ServiceName") };
        expect(validateCsvMapping(sinServicio, HEADERS)).toContain("ServiceName");
    });
});

describe("applyCsvMapping", () => {
    it("mapea todas las filas con los montos del archivo y defaults de FOCUS", () => {
        const out = applyCsvMapping(ROWS, MAPPING);
        expect(out).toHaveLength(60);
        expect(out[1]).toEqual({
            ProviderName: "AWS",
            SubAccountId: "123456789012",
            ServiceName: "Amazon EC2",
            ChargeCategory: "Usage",
            UsageDate: "2026-07-28",
            BilledCost: 1.5,
            EffectiveCost: 1.5,
        });
    });

    it("AISEC-06: las etiquetas del CSV salen sin controles/bidi y con largo acotado", () => {
        const mapping: CsvColumnMapping = {
            provider: "",
            mappings: [{ sourceColumn: "Svc", focusField: "ServiceName" }, { sourceColumn: "Cost", focusField: "BilledCost" }],
            dateFormat: "YMD",
        };
        const [out] = applyCsvMapping([{ Svc: "VM\u2066\r\n" + "y".repeat(400), Cost: "1" }], mapping);
        expect(out.ServiceName).not.toMatch(/[\r\n\u2066]/);
        expect(out.ServiceName.length).toBeLessThanOrEqual(120);
        expect(out.ProviderName).toBe("Unknown");
    });

    it("con decimales con coma lee bien todo el archivo, también el valor ambiguo", () => {
        const rows = [{ Svc: "VM", Cost: "1.234" }, { Svc: "VM", Cost: "12,5" }];
        const mapping: CsvColumnMapping = {
            provider: "",
            mappings: [{ sourceColumn: "Svc", focusField: "ServiceName" }, { sourceColumn: "Cost", focusField: "BilledCost" }],
            dateFormat: "DMY",
        };
        const out = applyCsvMapping(rows, mapping);
        expect(out.map((r) => r.BilledCost)).toEqual([1234, 12.5]);
        expect(out[0].ProviderName).toBe("Unknown");
        expect(out[0].UsageDate).toBe("");
    });
});

describe("normalizeBillingCsv", () => {
    it("un CSV FOCUS no pasa por la caché, el gate ni el modelo", async () => {
        const focus = { BilledCost: "2", EffectiveCost: "1", ChargeCategory: "Usage", ProviderName: "Azure", ServiceName: "VM" };
        const out = await normalizeBillingCsv([focus], "t1", "ana@x.com");
        expect(out[0]).toMatchObject({ BilledCost: 2, EffectiveCost: 1, ServiceName: "VM" });
        expect(queryMock).not.toHaveBeenCalled();
        expect(gateMock).not.toHaveBeenCalled();
    });

    it("sin filas no llama a nada", async () => {
        expect(await normalizeBillingCsv([], "t1", "ana@x.com")).toEqual([]);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("con el mapeo en caché no pasa por el gate ni el modelo", async () => {
        queryMock.mockResolvedValueOnce([[{ response_text: JSON.stringify(MAPPING) }]]);
        const out = await normalizeBillingCsv(ROWS, "t1", "ana@x.com");
        expect(out).toHaveLength(60);
        const [sql, [key]] = queryMock.mock.calls[0];
        expect(sql).toContain("FROM AiCache");
        // AiCache.hash_prompt es VARCHAR(64).
        expect(key).toMatch(/^[0-9a-f]{64}$/);
        expect(gateMock).not.toHaveBeenCalled();
        expect(generateObjectMock).not.toHaveBeenCalled();
    });

    it("una caché ilegible cuenta como vacía", async () => {
        queryMock.mockResolvedValueOnce([[{ response_text: "{roto" }]]);
        await normalizeBillingCsv(ROWS, "t1", "ana@x.com");
        expect(generateObjectMock).toHaveBeenCalledTimes(1);
    });

    it("si el gate niega, lanza el motivo sin llamar al modelo", async () => {
        gateMock.mockResolvedValue({ allowed: false, reason: "quota" });
        const err = await normalizeBillingCsv(ROWS, "t1", "ana@x.com").catch((e) => e);
        expect(err).toBeInstanceOf(CsvMappingError);
        expect(err.reason).toBe("quota");
        expect(gateMock).toHaveBeenCalledWith("t1", "billing-csv-column-mapping", "ana@x.com");
        expect(generateObjectMock).not.toHaveBeenCalled();
    });

    it("pide el mapeo con 20 filas redactadas, lo cachea y lo aplica a todas", async () => {
        const out = await normalizeBillingCsv(ROWS, "t1", "ana@x.com");

        expect(out).toHaveLength(60);
        expect(out.reduce((s, r) => s + r.BilledCost, 0)).toBe(90);
        const { prompt, maxOutputTokens } = generateObjectMock.mock.calls[0][0];
        const sent = JSON.parse(prompt.replace(/<\/?context_data>/g, ""));
        expect(sent.headers).toEqual(HEADERS);
        expect(sent.sample).toHaveLength(20);
        expect(prompt).not.toContain("rg-secret");
        expect(maxOutputTokens).toBe(800);
        expect(insertUsageMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", feature: "billing-csv-column-mapping", source: "platform" }));
        const [sql, [key, tenant, json]] = queryMock.mock.calls[1];
        expect(sql).toContain("INSERT INTO AiCache");
        expect(tenant).toBe("t1");
        expect(queryMock.mock.calls[0][1]).toEqual([key, "t1"]);
        expect(JSON.parse(json)).toEqual(MAPPING);
    });

    it("la misma clave sirve aunque las columnas vengan en otro orden", async () => {
        await normalizeBillingCsv(ROWS, "t1", "ana@x.com");
        const reordered = ROWS.map((r) => Object.fromEntries(Object.entries(r).reverse()));
        await normalizeBillingCsv(reordered, "t1", "ana@x.com");
        expect(queryMock.mock.calls[2][1][0]).toBe(queryMock.mock.calls[0][1][0]);
    });

    it("un mapeo inválido del modelo no se cachea ni se aplica", async () => {
        generateObjectMock.mockResolvedValue({
            object: { ...MAPPING, mappings: MAPPING.mappings.filter((m) => m.focusField !== "BilledCost") },
            usage: { inputTokens: 1, outputTokens: 1 },
        });
        const err = await normalizeBillingCsv(ROWS, "t1", "ana@x.com").catch((e) => e);
        expect(err).toBeInstanceOf(CsvMappingError);
        expect(err.reason).toBe("invalid_mapping");
        expect(insertUsageMock).toHaveBeenCalledTimes(1);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("si no se puede cachear, el archivo se procesa igual", async () => {
        queryMock.mockResolvedValueOnce([[]]).mockRejectedValueOnce(new Error("db down"));
        expect(await normalizeBillingCsv(ROWS, "t1", "ana@x.com")).toHaveLength(60);
    });
});

// Sin esto el análisis rotulaba en USD los montos de un archivo en EUR.
describe("csvCurrency", () => {
    it("lee la moneda de las columnas de FOCUS y de los exports de Azure", () => {
        expect(csvCurrency([{ BillingCurrency: "eur" }])).toBe("EUR");
        expect(csvCurrency([{ billingCurrency: "MXN" }])).toBe("MXN");
        expect(csvCurrency([{ BillingCurrencyCode: "BRL" }])).toBe("BRL");
        expect(csvCurrency([{ Currency: " usd " }])).toBe("USD");
    });

    it("sin columna de moneda, o con un valor que no es un código, no inventa una", () => {
        expect(csvCurrency([{ Service: "VM", Cost: "1" }])).toBeNull();
        expect(csvCurrency([{ BillingCurrency: "" }])).toBeNull();
        expect(csvCurrency([{ BillingCurrency: "Euro" }])).toBeNull();
        expect(csvCurrency([{ CurrencyRate: "EUR" }])).toBeNull();
        expect(csvCurrency([])).toBeNull();
    });
});
