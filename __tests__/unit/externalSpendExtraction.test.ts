// @vitest-environment node
/**
 * Fase 4 de IA (gasto externo): del resultado de Document Intelligence a la
 * cabecera y las líneas, las validaciones deterministas que corren antes de la
 * revisión humana y el chequeo del archivo subido. Los fixtures tienen la
 * forma de la API 2024-11-30.
 */
import { describe, it, expect } from "vitest";
import { isIso4217, isRealDate, mapAnalyzeResult, near, validateExtraction } from "@/lib/externalSpendExtraction";
import { checkExternalSpendFile } from "@/lib/externalSpendFiles";
import { EXTERNAL_SPEND_MAX_BYTES, type ExternalSpendHeader, type ExternalSpendLine } from "@/types/externalSpend.types";
import { contractResult, invoiceResult, layoutResult } from "../fixtures/documentIntelligence";

const TODAY = "2026-10-08";

describe("mapeo de prebuilt-invoice", () => {
    it("lleva la cabecera, las líneas, las páginas y la confianza más baja", () => {
        const x = mapAnalyzeResult("invoice", "prebuilt-invoice", invoiceResult());
        expect(x.header).toEqual({
            vendorName: "Contoso Ltd.", invoiceNumber: "INV-100", invoiceDate: "2026-09-30", dueDate: "2026-10-30",
            periodStart: "2026-09-01", periodEnd: "2026-09-30", currency: "EUR", subtotal: 120, tax: 25.2, total: 145.2,
        });
        expect(x.lines).toEqual([
            expect.objectContaining({ description: "Licencia anual", quantity: 2, unitPrice: 50, amount: 100, currency: "EUR", confidence: 0.93 }),
            expect.objectContaining({ description: "Soporte", quantity: 1, unitPrice: 20, amount: 20, currency: "EUR", confidence: 0.71 }),
        ]);
        expect(x).toMatchObject({ modelId: "prebuilt-invoice", apiVersion: "2024-11-30", pages: 2, confidence: 0.88 });
        expect(x.fieldConfidence).toMatchObject({ vendorName: 0.97, invoiceNumber: 0.91, total: 0.88 });
        expect(x).not.toHaveProperty("content");
        expect(x).not.toHaveProperty("contract");
    });

    it("acepta importes como number y toma la moneda de otro importe", () => {
        const x = mapAnalyzeResult("invoice", "prebuilt-invoice", invoiceResult({
            SubTotal: { type: "number", valueNumber: 120, confidence: 0.9 },
            InvoiceTotal: { type: "number", valueNumber: 145.2, confidence: 0.9 },
        }));
        expect(x.header).toMatchObject({ subtotal: 120, total: 145.2, currency: "EUR" });
    });

    it("no usa AmountDue como total: puede arrastrar saldos anteriores", () => {
        const x = mapAnalyzeResult("invoice", "prebuilt-invoice", invoiceResult({ InvoiceTotal: undefined }));
        expect(x.header.total).toBeNull();
        expect(x.fieldConfidence).not.toHaveProperty("total");
    });

    it("descarta fechas que no existen e importes absurdos", () => {
        const x = mapAnalyzeResult("invoice", "prebuilt-invoice", invoiceResult({
            InvoiceDate: { type: "date", valueDate: "2026-02-30", confidence: 0.9 },
            TotalTax: { type: "currency", valueCurrency: { amount: 1e13, currencyCode: "EUR" }, confidence: 0.9 },
        }));
        expect(x.header).toMatchObject({ invoiceDate: null, tax: null });
    });
});

describe("mapeo de prebuilt-contract", () => {
    it("propone la primera parte como proveedor y guarda los términos para el compromiso", () => {
        const x = mapAnalyzeResult("contract", "prebuilt-contract", contractResult());
        expect(x.header).toEqual({
            vendorName: "Fabrikam Inc.", invoiceNumber: "MSA-42", invoiceDate: "2026-01-10", dueDate: null,
            periodStart: "2026-02-01", periodEnd: "2027-01-31", currency: null, subtotal: null, tax: null, total: null,
        });
        expect(x.contract).toEqual({
            title: "Master Subscription Agreement", parties: ["Fabrikam Inc.", "Empresa Demo S.A."],
            effectiveDate: "2026-02-01", expirationDate: "2027-01-31", renewalDate: "2027-02-01", duration: "12 months",
        });
        expect(x).toMatchObject({ pages: 3, confidence: 0.85, lines: [] });
    });
});

describe("sin campos reconocidos (respaldo de prebuilt-layout)", () => {
    it("guarda el texto para cargar a mano", () => {
        const x = mapAnalyzeResult("invoice", "prebuilt-layout", layoutResult());
        expect(Object.values(x.header).every((v) => v === null)).toBe(true);
        expect(x).toMatchObject({ modelId: "prebuilt-layout", pages: 1, confidence: null, lines: [] });
        expect(x.content).toContain("Texto libre");
    });
});

const header = (h: Partial<ExternalSpendHeader> = {}): ExternalSpendHeader => ({
    vendorName: "Contoso", invoiceNumber: "1", invoiceDate: "2026-09-30", dueDate: "2026-10-30",
    periodStart: "2026-09-01", periodEnd: "2026-09-30", currency: "USD", subtotal: 120, tax: 25.2, total: 145.2, ...h,
});
const line = (amount: number | null, l: Partial<ExternalSpendLine> = {}): ExternalSpendLine => ({
    description: "x", quantity: null, unitPrice: null, amount, currency: "USD", serviceCategory: null,
    periodStart: null, periodEnd: null, costCenter: null, confidence: null, ...l,
});
const codes = (h: ExternalSpendHeader, lines: ExternalSpendLine[] = [line(100), line(20)], docType: "invoice" | "contract" = "invoice") =>
    validateExtraction(docType, h, lines, TODAY).map((i) => i.code);

describe("validaciones deterministas", () => {
    it("una factura que cierra no tiene observaciones", () => {
        expect(codes(header())).toEqual([]);
    });

    it.each([
        ["total_missing", { total: null, subtotal: null }],
        ["date_missing", { invoiceDate: null }],
        ["currency_invalid", { currency: "usd" }],
        ["currency_invalid", { currency: "ABC" }],
        ["total_mismatch", { tax: 30 }],
    ] as const)("%s", (code, h) => {
        expect(codes(header(h))).toEqual([code]);
    });

    it("las líneas tienen que sumar el subtotal, con tolerancia de redondeo", () => {
        expect(codes(header(), [line(100), line(10)])).toEqual(["lines_mismatch"]);
        expect(codes(header(), [line(100), line(20.3)])).toEqual([]);
        // Líneas sin importe no se comparan: el modelo no siempre los lee.
        expect(codes(header(), [line(null)])).toEqual([]);
    });

    it.each([
        ["vencimiento antes de la fecha", { dueDate: "2026-09-01" }],
        ["período al revés", { periodStart: "2026-10-01" }],
        ["factura del futuro", { invoiceDate: "2026-10-09", dueDate: null }],
    ])("fechas incoherentes: %s", (_caso, h) => {
        expect(codes(header(h))).toEqual(["dates_incoherent"]);
    });

    it("también mira el período de cada línea", () => {
        expect(codes(header(), [line(100), line(20, { periodStart: "2026-09-30", periodEnd: "2026-09-01" })])).toEqual(["dates_incoherent"]);
    });

    it("sin nada reconocido avisa no_fields además de lo que falta", () => {
        const empty = Object.fromEntries(Object.keys(header()).map((k) => [k, null])) as unknown as ExternalSpendHeader;
        expect(codes(empty, [])).toEqual(["no_fields", "total_missing", "date_missing", "currency_invalid"]);
    });

    it("un contrato no exige importes ni moneda", () => {
        expect(codes(header({ currency: null, subtotal: null, tax: null, total: null }), [], "contract")).toEqual([]);
    });

    it("near: medio punto de tolerancia con piso de un centavo", () => {
        expect(near(100.5, 100)).toBe(true);
        expect(near(100.6, 100)).toBe(false);
        expect(near(0.01, 0)).toBe(true);
        expect(near(0.02, 0)).toBe(false);
    });

    it("isRealDate e isIso4217", () => {
        expect(isRealDate("2028-02-29")).toBe(true);
        expect(isRealDate("2026-02-29")).toBe(false);
        expect(isRealDate("2026-9-30")).toBe(false);
        expect(isIso4217("ARS")).toBe(true);
        expect(isIso4217(null)).toBe(false);
    });
});

describe("archivo subido", () => {
    const withMagic = (bytes: number[], size = 64) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(size)]);

    it.each([
        ["pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
        ["jpg", [0xff, 0xd8, 0xff, 0xe0]],
        ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]],
        ["tiff", [0x49, 0x49, 0x2a, 0x00]],
        ["tiff", [0x4d, 0x4d, 0x00, 0x2a]],
    ])("reconoce %s por sus magic bytes", (ext, magic) => {
        expect(checkExternalSpendFile(withMagic(magic))).toMatchObject({ ok: true, ext });
    });

    it("rechaza lo que no es PDF ni imagen soportada aunque diga serlo", () => {
        expect(checkExternalSpendFile(Buffer.from("GIF89a....."))).toEqual({ ok: false, reason: "file_type" });
        expect(checkExternalSpendFile(Buffer.from("<html>%PDF"))).toEqual({ ok: false, reason: "file_type" });
    });

    it("rechaza vacío y más de 10 MB", () => {
        expect(checkExternalSpendFile(Buffer.alloc(0))).toEqual({ ok: false, reason: "empty_file" });
        expect(checkExternalSpendFile(withMagic([0x25, 0x50, 0x44, 0x46], EXTERNAL_SPEND_MAX_BYTES))).toEqual({ ok: false, reason: "file_too_large" });
    });
});
