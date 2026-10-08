// @vitest-environment node
/**
 * Cliente REST de Document Intelligence (API 2024-11-30) con fetch mockeado:
 * URL del análisis con el tope de páginas, Bearer de Entra ID (no hay key),
 * Operation-Location, errores reintentables y que el token nunca salga hacia
 * una URL que no sea la del endpoint configurado.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ identity: true }));
vi.mock("@/lib/azureAiCredential", () => ({
    hasAiManagedIdentity: () => m.identity,
    cognitiveServicesTokenProvider: () => async () => "tok-entra",
}));

import {
    DocumentIntelligenceError, getAnalyzeOperation, isDocumentIntelligenceConfigured, submitAnalyze,
} from "@/lib/documentIntelligenceClient";

const OP = "https://di.example.com/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/abc?api-version=2024-11-30";
const fetchMock = vi.fn();

beforeEach(() => {
    m.identity = true;
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://di.example.com/";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

describe("configuración", () => {
    it("hace falta el endpoint y la identidad administrada", () => {
        expect(isDocumentIntelligenceConfigured()).toBe(true);
        m.identity = false;
        expect(isDocumentIntelligenceConfigured()).toBe(false);
        m.identity = true;
        process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = " ";
        expect(isDocumentIntelligenceConfigured()).toBe(false);
    });
});

describe("submitAnalyze", () => {
    it("manda el archivo en base64 con Bearer y el tope de páginas, y devuelve Operation-Location", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { "Operation-Location": OP } }));
        await expect(submitAnalyze("prebuilt-invoice", Buffer.from("%PDF-1.7"))).resolves.toBe(OP);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://di.example.com/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30&pages=1-20");
        expect(init.method).toBe("POST");
        expect(init.headers).toMatchObject({ Authorization: "Bearer tok-entra", "Content-Type": "application/json" });
        expect(JSON.parse(init.body)).toEqual({ base64Source: Buffer.from("%PDF-1.7").toString("base64") });
    });

    it("sin Operation-Location es un error que vale reintentar", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
        await expect(submitAnalyze("prebuilt-invoice", Buffer.from("x"))).rejects.toMatchObject({ retryable: true });
    });

    it.each([
        [400, false],
        [404, false],
        [429, true],
        [503, true],
    ])("HTTP %i → retryable %s, con el mensaje del servicio", async (status, retryable) => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "X", message: "detalle del servicio" } }), { status }));
        const err = await submitAnalyze("prebuilt-invoice", Buffer.from("x")).catch((e) => e);
        expect(err).toBeInstanceOf(DocumentIntelligenceError);
        expect(err).toMatchObject({ status, retryable, message: "detalle del servicio" });
    });

    it("sin endpoint no llama a nadie", async () => {
        delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
        await expect(submitAnalyze("prebuilt-invoice", Buffer.from("x"))).rejects.toMatchObject({ retryable: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("getAnalyzeOperation", () => {
    it("consulta la operación con Bearer y devuelve el estado", async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "running" }), { status: 200 }));
        await expect(getAnalyzeOperation(OP)).resolves.toEqual({ status: "running" });
        expect(fetchMock.mock.calls[0][0]).toBe(OP);
        expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer tok-entra" });
    });

    it("no manda el token a otro origen aunque la URL venga de la base", async () => {
        await expect(getAnalyzeOperation("https://evil.example.com/documentintelligence/x")).rejects.toMatchObject({ retryable: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
