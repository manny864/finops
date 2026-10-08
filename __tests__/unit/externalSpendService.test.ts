// @vitest-environment node
/**
 * Fase 4 de IA (gasto externo): la máquina de estados del documento con la
 * base y fetch mockeados. Lo que se cuida:
 *
 * - el poller manda a analizar, consulta y deja para revisión, con
 *   `prebuilt-layout` de respaldo y los errores reintentables para el cron;
 * - cada cambio de estado es condicional: si la subida y el cron llegan a la
 *   vez, uno solo avanza y el uso se registra una vez;
 * - la subida rechaza gratis (sin gate) lo que puede, y el gate decide antes
 *   de guardar nada;
 * - aprobar fija el USD con la tasa de la fecha de la factura y nunca aprueba
 *   con bloqueantes ni dos veces la misma factura;
 * - un contrato se aprueba junto con su compromiso o no se aprueba, y
 *   aprobado ya no se rechaza (su compromiso seguiría avisando).
 */
import crypto from "crypto";
import { vi, describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { invoiceResult } from "../fixtures/documentIntelligence";

const m = vi.hoisted(() => ({
    query: vi.fn(),
    usage: vi.fn(),
    gate: vi.fn(),
    logAiEvent: vi.fn(),
    read: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    rateOn: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
}));
vi.mock("@/modules/storage/db", () => ({
    default: {
        query: m.query,
        getConnection: async () => ({
            query: m.query, beginTransaction: async () => {}, commit: m.commit, rollback: m.rollback, release: () => {},
        }),
    },
    insertPlatformAiUsage: m.usage,
}));
vi.mock("@/lib/azureAiCredential", () => ({ hasAiManagedIdentity: () => true, cognitiveServicesTokenProvider: () => async () => "tok" }));
vi.mock("@/lib/aiFeatureGate", () => ({ checkAiFeature: m.gate, peekAiFeature: vi.fn() }));
vi.mock("@/lib/aiTelemetry", () => ({ timeAiCall: (_f: string, fn: () => unknown) => fn(), logAiEvent: m.logAiEvent }));
vi.mock("@/lib/externalSpendFiles", async (importActual) => ({
    ...(await importActual<typeof import("@/lib/externalSpendFiles")>()),
    readExternalSpendFile: m.read,
    saveExternalSpendFile: m.save,
    deleteExternalSpendFile: m.remove,
}));
vi.mock("@/lib/fx", async (importActual) => ({ ...(await importActual<typeof import("@/lib/fx")>()), getRateOn: m.rateOn }));

import {
    approveDocument, createCommitment, processDocument, processPendingDocuments, rejectDocument, uploadDocument,
} from "@/services/externalSpend.service";

const BASE = "https://di.example.com/documentintelligence/documentModels";
const opFor = (model: string) => `${BASE}/${model}/analyzeResults/r-${model}?api-version=2024-11-30`;

interface Doc {
    id: number; tenant_id: string; doc_type: "invoice" | "contract"; status: string; stored_name: string | null;
    model_id: string | null; operation_location: string | null; stale: number; error_message?: string;
}
let doc: Doc;
/** false: otro proceso avanzó el documento entre la lectura y el UPDATE. */
let casWins: boolean;
let twin: { id: number; status: string } | null;
let transitions: string[];
let lines: unknown[][];
/** El SQL que no es del poller, por test. */
let extra: (sql: string, params: unknown[]) => unknown;

let post: (url: string) => Response;
let operation: unknown;
const fetchMock = vi.fn(async (url: string, init: RequestInit) =>
    init.method === "POST" ? post(url) : new Response(JSON.stringify(operation), { status: 200 }));
const accepted = (url: string) =>
    new Response(null, { status: 202, headers: { "Operation-Location": opFor(url.split("/").pop()!.split(":")[0]) } });
const diError = (status: number) => new Response(JSON.stringify({ error: { code: "X", message: `HTTP ${status} del servicio` } }), { status });
const posted = () => fetchMock.mock.calls.filter(([, init]) => init.method === "POST").map(([url]) => url.split("/").pop()!.split(":")[0]);

beforeEach(() => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://di.example.com";
    doc = { id: 1, tenant_id: "t1", doc_type: "invoice", status: "uploaded", stored_name: "f.pdf", model_id: null, operation_location: null, stale: 0 };
    casWins = true;
    twin = null;
    transitions = [];
    lines = [];
    extra = (sql) => { throw new Error(`SQL no esperado: ${sql}`); };
    post = accepted;
    operation = { status: "running" };
    for (const fn of Object.values(m)) fn.mockReset();
    m.read.mockResolvedValue(Buffer.from("%PDF-1.7"));
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);

    m.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("AS stale")) return [[{ ...doc }]];
        if (sql.startsWith("UPDATE ExternalSpendDocuments SET") && sql.includes("operation_location <=> ?")) {
            const [id, status, op] = params.slice(-3);
            if (!casWins || id !== doc.id || status !== doc.status || op !== doc.operation_location) return [{ affectedRows: 0 }];
            doc.status = /status = '(\w+)'/.exec(sql)![1];
            transitions.push(doc.status);
            if (sql.includes("model_id = ?, operation_location = ?")) [doc.model_id, doc.operation_location] = params as [string, string];
            else doc.operation_location = null;
            if (doc.status === "failed") doc.error_message = params[0] as string;
            return [{ affectedRows: 1 }];
        }
        if (sql.includes("vendor_name = ? AND invoice_number = ?")) return [twin ? [twin] : []];
        if (sql.startsWith("DELETE FROM ExternalSpendLines")) return [{ affectedRows: 0 }];
        if (sql.includes("INSERT INTO ExternalSpendLines")) {
            lines.push(...(params[0] as unknown[][]));
            return [{ affectedRows: 1 }];
        }
        return extra(sql, params);
    });
});

describe("processDocument (el poller)", () => {
    it.each([
        ["invoice", "prebuilt-invoice"],
        ["contract", "prebuilt-contract"],
    ] as const)("un %s subido va a %s y queda en análisis", async (docType, model) => {
        doc.doc_type = docType;
        await expect(processDocument(1)).resolves.toBe("extracting");
        expect(posted()).toEqual([model]);
        expect(doc).toMatchObject({ status: "extracting", model_id: model, operation_location: opFor(model) });
    });

    it("todavía corriendo: no toca la fila", async () => {
        Object.assign(doc, { status: "extracting", model_id: "prebuilt-invoice", operation_location: opFor("prebuilt-invoice") });
        await expect(processDocument(1)).resolves.toBe("extracting");
        expect(fetchMock.mock.calls[0][0]).toBe(opFor("prebuilt-invoice"));
        expect(transitions).toEqual([]);
    });

    it("corriendo hace más de un día: falla, DI guarda el resultado 24 horas", async () => {
        Object.assign(doc, { status: "extracting", model_id: "prebuilt-invoice", operation_location: opFor("prebuilt-invoice"), stale: 1 });
        await expect(processDocument(1)).resolves.toBe("failed");
        expect(doc.error_message).toMatch(/24 horas/);
    });

    it("terminó: mapea, guarda las líneas y registra las páginas como uso", async () => {
        Object.assign(doc, { status: "extracting", model_id: "prebuilt-invoice", operation_location: opFor("prebuilt-invoice") });
        operation = { status: "succeeded", analyzeResult: invoiceResult() };
        await expect(processDocument(1)).resolves.toBe("needs_review");
        expect(doc.operation_location).toBeNull();
        expect(lines).toHaveLength(2);
        expect(lines[0]).toEqual([1, "t1", 1, "Licencia anual", 2, 50, 100, "EUR", null, null, null, null, 0.93]);
        expect(m.usage).toHaveBeenCalledWith({
            tenantId: "t1", source: "platform", provider: "azure_document_intelligence", modelName: "prebuilt-invoice",
            feature: "document-intelligence", inputTokens: 2, outputTokens: 0,
        });
        expect(m.logAiEvent).not.toHaveBeenCalled();
    });

    it("con observaciones (y un duplicado por proveedor y número) la salida cuenta como rechazada", async () => {
        Object.assign(doc, { status: "extracting", model_id: "prebuilt-invoice", operation_location: opFor("prebuilt-invoice") });
        operation = { status: "succeeded", analyzeResult: invoiceResult({ InvoiceTotal: undefined }) };
        twin = { id: 7, status: "approved" };
        await expect(processDocument(1)).resolves.toBe("needs_review");
        const update = m.query.mock.calls.find(([sql]) => String(sql).includes("validation_issues = ?"))!;
        expect(update[1]).toContain(JSON.stringify([{ code: "total_missing" }, { code: "duplicate_invoice", documentId: 7 }]));
        expect(m.logAiEvent).toHaveBeenCalledWith("document-intelligence", { stage: "output", outcome: "rejected" });
    });

    it("si otro proceso ya lo avanzó, no pisa las líneas ni registra el uso dos veces", async () => {
        Object.assign(doc, { status: "extracting", model_id: "prebuilt-invoice", operation_location: opFor("prebuilt-invoice") });
        operation = { status: "succeeded", analyzeResult: invoiceResult() };
        casWins = false;
        await expect(processDocument(1)).resolves.toBe("extracting");
        expect(lines).toEqual([]);
        expect(m.usage).not.toHaveBeenCalled();
    });

    it("el modelo falló (un contrato que no está en inglés): reintenta con prebuilt-layout", async () => {
        Object.assign(doc, { doc_type: "contract", status: "extracting", model_id: "prebuilt-contract", operation_location: opFor("prebuilt-contract") });
        operation = { status: "failed", error: { code: "UnsupportedContent", message: "Unsupported language" } };
        await expect(processDocument(1)).resolves.toBe("extracting");
        expect(posted()).toEqual(["prebuilt-layout"]);
        expect(doc).toMatchObject({ model_id: "prebuilt-layout", operation_location: opFor("prebuilt-layout") });
    });

    it("si también falla el layout, queda failed con el motivo", async () => {
        Object.assign(doc, { status: "extracting", model_id: "prebuilt-layout", operation_location: opFor("prebuilt-layout") });
        operation = { status: "failed", error: { message: "Unsupported language" } };
        await expect(processDocument(1)).resolves.toBe("failed");
        expect(doc.error_message).toBe("Unsupported language");
        expect(posted()).toEqual([]);
    });

    it("al mandar, un error que no se arregla reintentando pasa al layout", async () => {
        post = (url) => (url.includes("prebuilt-invoice") ? diError(404) : accepted(url));
        await expect(processDocument(1)).resolves.toBe("extracting");
        expect(posted()).toEqual(["prebuilt-invoice", "prebuilt-layout"]);
        expect(doc.model_id).toBe("prebuilt-layout");
    });

    it("un 429 o un 5xx lo deja para el cron, hasta que pasa un día", async () => {
        post = () => diError(429);
        await expect(processDocument(1)).resolves.toBe("uploaded");
        expect(transitions).toEqual([]);
        doc.stale = 1;
        post = () => diError(503);
        await expect(processDocument(1)).resolves.toBe("failed");
    });

    it("sin el original no hay nada que analizar", async () => {
        m.read.mockResolvedValue(null);
        await expect(processDocument(1)).resolves.toBe("failed");
        expect(doc.error_message).toBe("No se encontró el archivo original.");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("si el storage no responde, no es que falte el original: lo reintenta el cron, hasta que pasa un día", async () => {
        m.read.mockRejectedValue(new Error("getaddrinfo ENOTFOUND cuenta.blob.core.windows.net"));
        await expect(processDocument(1)).resolves.toBe("uploaded");
        expect(transitions).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
        doc.stale = 1;
        await expect(processDocument(1)).resolves.toBe("failed");
        expect(doc.error_message).toBe("No se pudo leer el archivo original en 24 horas.");
    });

    it("el cron sigue con el resto si un documento falla", async () => {
        doc.status = "needs_review";
        extra = (sql) => {
            if (sql.includes("updated_at < NOW() - INTERVAL 1 MINUTE")) return [[{ id: 1 }, { id: 2 }]];
            throw new Error(`SQL no esperado: ${sql}`);
        };
        const base = m.query.getMockImplementation()!;
        m.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
            if (sql.includes("AS stale") && params[0] === 2) throw new Error("se cayó la base");
            return base(sql, params);
        });
        await expect(processPendingDocuments()).resolves.toEqual({ processed: 2, errors: ["2: se cayó la base"] });
    });
});

describe("uploadDocument", () => {
    const input = (bytes = Buffer.from("%PDF-1.7 factura")) =>
        ({ tenantId: "t1", userEmail: "ana@x.com", docType: "invoice" as const, originalName: "f.pdf", bytes });
    let existing: Array<{ id: number; status: string; stored_name: string | null }>;

    beforeEach(() => {
        existing = [];
        m.gate.mockResolvedValue({ allowed: true });
        m.save.mockResolvedValue("nuevo.pdf");
        extra = (sql, params) => {
            if (sql.includes("AND sha256 = ?")) return [existing];
            if (sql.startsWith("DELETE FROM ExternalSpendDocuments")) return [{ affectedRows: 1 }];
            if (sql.includes("INSERT INTO ExternalSpendDocuments")) {
                doc = { ...doc, id: 9, stored_name: params[3] as string };
                return [{ insertId: 9 }];
            }
            if (sql.includes("FROM ExternalSpendDocuments WHERE id = ? AND tenant_id = ?")) {
                return [[{ id: 9, doc_type: "invoice", status: doc.status, original_name: "f.pdf", size_bytes: 16, stored_name: doc.stored_name, model_id: doc.model_id }]];
            }
            throw new Error(`SQL no esperado: ${sql}`);
        };
    });

    it("sin endpoint: not_configured, sin pasar por el gate", async () => {
        delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
        await expect(uploadDocument(input())).rejects.toMatchObject({ reason: "not_configured", status: 503 });
        expect(m.gate).not.toHaveBeenCalled();
    });

    it("un archivo inválido o ya subido se rechaza antes del gate: no gasta rate limit", async () => {
        await expect(uploadDocument(input(Buffer.from("GIF89a")))).rejects.toMatchObject({ reason: "file_type", status: 415 });
        existing = [{ id: 3, status: "approved", stored_name: "a.pdf" }];
        await expect(uploadDocument(input())).rejects.toMatchObject({ reason: "duplicate", status: 409 });
        expect(m.gate).not.toHaveBeenCalled();
    });

    it("el gate decide antes de guardar nada", async () => {
        m.gate.mockResolvedValue({ allowed: false, reason: "quota" });
        await expect(uploadDocument(input())).rejects.toMatchObject({ reason: "quota", status: 429 });
        expect(m.gate).toHaveBeenCalledWith("t1", "document-intelligence", "ana@x.com");
        expect(m.save).not.toHaveBeenCalled();
    });

    it("dos subidas a la vez del mismo archivo: la segunda borra su copia y es duplicate", async () => {
        const base = extra;
        extra = (sql, params) => {
            if (sql.includes("INSERT INTO ExternalSpendDocuments")) throw Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" });
            return base(sql, params);
        };
        await expect(uploadDocument(input())).rejects.toMatchObject({ reason: "duplicate" });
        expect(m.remove).toHaveBeenCalledWith("nuevo.pdf");
    });

    it("reemplaza un rechazado con el mismo hash, guarda, manda a analizar y devuelve el documento sin líneas", async () => {
        existing = [{ id: 3, status: "rejected", stored_name: "viejo.pdf" }];
        const bytes = Buffer.from("%PDF-1.7 factura");
        const doc9 = await uploadDocument(input(bytes), { waitMs: 0 });
        expect(m.remove).toHaveBeenCalledWith("viejo.pdf");
        expect(m.save).toHaveBeenCalledWith(bytes, "pdf");
        const insert = m.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO ExternalSpendDocuments"))!;
        expect(insert[1]).toEqual([
            "t1", "invoice", "f.pdf", "nuevo.pdf", "application/pdf", bytes.length,
            crypto.createHash("sha256").update(bytes).digest("hex"),
            "ana@x.com",
        ]);
        expect(posted()).toEqual(["prebuilt-invoice"]);
        expect(doc9).toMatchObject({ id: 9, status: "extracting", hasFile: true });
        expect(doc9).not.toHaveProperty("lines");
        expect(doc9).not.toHaveProperty("extraction");
    });
});

describe("approveDocument", () => {
    let row: Record<string, unknown>;
    let approval: unknown[] | null;

    beforeEach(() => {
        row = {
            id: 5, doc_type: "invoice", status: "needs_review", original_name: "f.pdf", size_bytes: 10, stored_name: "f.pdf",
            vendor_name: "Contoso", invoice_number: "INV-1", invoice_date: "2026-09-30", due_date: null, period_start: null, period_end: null,
            currency: "EUR", subtotal: "120.000000", tax: "25.200000", total: "145.200000", total_usd: null, fx_rate: null, fx_rate_date: null,
            model_id: "prebuilt-invoice", confidence: "0.8800", pages: 2, validation_issues: "[]", error_message: null,
            uploaded_by: "ana@x.com", reviewed_by: null, reviewed_at: null, created_at: new Date("2026-10-01T00:00:00Z"), extraction_json: null,
        };
        approval = null;
        m.rateOn.mockResolvedValue({ rate: new Decimal("0.92"), rateDate: "2026-09-29" });
        extra = (sql, params) => {
            if (sql.includes("extraction_json FROM ExternalSpendDocuments")) return [[row]];
            if (sql.includes("FROM ExternalSpendLines")) return [[]];
            if (sql.includes("SET status = 'approved'")) {
                approval = params;
                return [{ affectedRows: 1 }];
            }
            if (sql.startsWith("UPDATE ExternalSpendDocuments SET validation_issues = ?")) return [{ affectedRows: 1 }];
            throw new Error(`SQL no esperado: ${sql}`);
        };
    });

    it("fija el equivalente en USD con la tasa de la fecha de la factura, y la deja anotada", async () => {
        await approveDocument("t1", 5, "rev@x.com");
        expect(m.rateOn).toHaveBeenCalledWith("EUR", "2026-09-30");
        expect(approval).toEqual(["157.8261", "0.92", "2026-09-29", "[]", "rev@x.com", 5, "t1"]);
    });

    it("una moneda sin tasa se aprueba sin USD: el resumen la cuenta aparte", async () => {
        row.currency = "SEK";
        await approveDocument("t1", 5, "rev@x.com");
        expect(m.rateOn).not.toHaveBeenCalled();
        expect(approval!.slice(0, 3)).toEqual([null, null, null]);
    });

    it("con un bloqueante no se aprueba y quedan las observaciones", async () => {
        row.total = null;
        await expect(approveDocument("t1", 5, "rev@x.com")).rejects.toMatchObject({ reason: "blocking_issues", status: 422 });
        expect(approval).toBeNull();
        const saved = m.query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE ExternalSpendDocuments SET validation_issues = ?"))!;
        expect(saved[1]).toEqual([JSON.stringify([{ code: "total_missing" }]), 5]);
    });

    it("la misma factura ya aprobada no se cuenta dos veces; pendiente en otro documento, sólo avisa", async () => {
        twin = { id: 4, status: "approved" };
        await expect(approveDocument("t1", 5, "rev@x.com")).rejects.toMatchObject({ reason: "blocking_issues" });
        twin = { id: 4, status: "needs_review" };
        await approveDocument("t1", 5, "rev@x.com");
        expect(approval![3]).toBe(JSON.stringify([{ code: "duplicate_invoice", documentId: 4 }]));
    });

    it("los contratos se aprueban al cargar su compromiso, no por acá", async () => {
        row.doc_type = "contract";
        await expect(approveDocument("t1", 5, "rev@x.com")).rejects.toMatchObject({ reason: "invalid_state" });
    });
});

describe("createCommitment", () => {
    const input = {
        vendorName: "Contoso Software Ltd.", commitmentType: "EA" as const, amount: 120000, currency: "USD",
        startDate: "2026-01-01", endDate: "2026-12-31", renewalDate: null, noticeDays: 60, autoRenew: true, sourceDocumentId: 7,
    };
    let approvedRows: number;
    const inserted = () => m.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO Commitments"));

    beforeEach(() => {
        approvedRows = 1;
        extra = (sql) => {
            if (sql.includes("SET status = 'approved'") && sql.includes("doc_type = 'contract'")) return [{ affectedRows: approvedRows }];
            if (sql.startsWith("SELECT 1 FROM ExternalSpendDocuments")) return [[{ 1: 1 }]];
            if (sql.includes("INSERT INTO Commitments")) return [{ insertId: 42 }];
            throw new Error(`SQL no esperado: ${sql}`);
        };
    });

    it("desde un contrato: lo aprueba y carga el compromiso en la misma transacción", async () => {
        await expect(createCommitment("t1", "ana@contoso.com", input)).resolves.toBe(42);
        expect(m.commit).toHaveBeenCalledTimes(1);
        expect(m.rollback).not.toHaveBeenCalled();
    });

    it("si el alta falla, se deshace la aprobación: el contrato no queda aprobado sin compromiso", async () => {
        const base = extra;
        extra = (sql, params) => {
            if (sql.includes("INSERT INTO Commitments")) throw new Error("se cortó la conexión");
            return base(sql, params);
        };
        await expect(createCommitment("t1", "ana@contoso.com", input)).rejects.toThrow("se cortó la conexión");
        expect(m.rollback).toHaveBeenCalledTimes(1);
        expect(m.commit).not.toHaveBeenCalled();
    });

    it("un contrato que ya no espera revisión: invalid_state y no se carga nada", async () => {
        approvedRows = 0;
        await expect(createCommitment("t1", "ana@contoso.com", input)).rejects.toMatchObject({ reason: "invalid_state" });
        expect(inserted()).toBe(false);
        expect(m.rollback).toHaveBeenCalledTimes(1);
    });
});

describe("rejectDocument", () => {
    let row: { status: string; doc_type: string } | null;

    beforeEach(() => {
        row = { status: "needs_review", doc_type: "invoice" };
        extra = (sql) => {
            if (sql.includes("SET status = 'rejected'")) {
                // El WHERE es la regla: pendiente de revisión, o una factura aprobada.
                expect(sql).toContain("(status = 'needs_review' OR (status = 'approved' AND doc_type = 'invoice'))");
                const matches = !!row && (row.status === "needs_review" || (row.status === "approved" && row.doc_type === "invoice"));
                if (matches) row!.status = "rejected";
                return [{ affectedRows: matches ? 1 : 0 }];
            }
            if (sql.startsWith("SELECT 1 FROM ExternalSpendDocuments")) return [row ? [{ 1: 1 }] : []];
            throw new Error(`SQL no esperado: ${sql}`);
        };
    });

    it.each([
        ["invoice", "needs_review"],
        ["contract", "needs_review"],
        ["invoice", "approved"],
    ])("un documento %s en %s se rechaza (la factura aprobada sale de los reportes)", async (docType, status) => {
        row = { status, doc_type: docType };
        await rejectDocument("t1", 5, "rev@x.com");
        expect(row.status).toBe("rejected");
    });

    it("un contrato aprobado no: su compromiso seguiría avisando y, si se vuelve a subir, quedarían dos", async () => {
        row = { status: "approved", doc_type: "contract" };
        await expect(rejectDocument("t1", 5, "rev@x.com")).rejects.toMatchObject({ reason: "invalid_state", status: 409 });
        expect(row.status).toBe("approved");
    });

    it("de otro tenant o inexistente: not_found", async () => {
        row = null;
        await expect(rejectDocument("t1", 5, "rev@x.com")).rejects.toMatchObject({ reason: "not_found", status: 404 });
    });
});
