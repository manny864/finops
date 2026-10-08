import type { DiAnalyzeResult, DiField } from "@/lib/documentIntelligenceClient";

/**
 * Respuestas de Document Intelligence (API 2024-11-30) con la forma de
 * learn.microsoft.com: `analyzeResult.documents[0].fields`, importes como
 * `currency` (o `number`, según el modelo) y las páginas en `pages`.
 */

const money = (amount: number, currencyCode = "EUR", confidence = 0.95): DiField =>
    ({ type: "currency", valueCurrency: { amount, currencyCode, currencySymbol: "€" }, content: String(amount), confidence });
const str = (value: string, confidence = 0.95): DiField => ({ type: "string", valueString: value, content: value, confidence });
const day = (value: string, confidence = 0.95): DiField => ({ type: "date", valueDate: value, content: value, confidence });

const item = (description: string, quantity: number, unitPrice: number, amount: number, confidence = 0.9): DiField => ({
    type: "object",
    confidence,
    valueObject: {
        Description: str(description),
        Quantity: { type: "number", valueNumber: quantity, confidence: 0.9 },
        UnitPrice: money(unitPrice),
        Amount: money(amount),
    },
});

/** Una factura que cierra: 2 × 50 + 20 = 120; 120 + 25,20 de IVA = 145,20. */
export function invoiceResult(overrides: Record<string, DiField | undefined> = {}): DiAnalyzeResult {
    return {
        apiVersion: "2024-11-30",
        modelId: "prebuilt-invoice",
        content: "Contoso Ltd.\nFactura INV-100\n...",
        pages: [{ pageNumber: 1 }, { pageNumber: 2 }],
        documents: [{
            docType: "invoice",
            confidence: 1,
            fields: {
                VendorName: str("Contoso Ltd.", 0.97),
                InvoiceId: str("INV-100", 0.91),
                InvoiceDate: day("2026-09-30"),
                DueDate: day("2026-10-30"),
                ServiceStartDate: day("2026-09-01"),
                ServiceEndDate: day("2026-09-30"),
                SubTotal: money(120),
                TotalTax: money(25.2),
                InvoiceTotal: money(145.2, "EUR", 0.88),
                AmountDue: money(300),
                Items: { type: "array", valueArray: [item("Licencia anual", 2, 50, 100, 0.93), item("Soporte", 1, 20, 20, 0.71)] },
                ...overrides,
            },
        }],
    };
}

export function contractResult(): DiAnalyzeResult {
    return {
        apiVersion: "2024-11-30",
        modelId: "prebuilt-contract",
        content: "MASTER SUBSCRIPTION AGREEMENT ...",
        pages: [{}, {}, {}],
        documents: [{
            docType: "contract",
            fields: {
                Title: str("Master Subscription Agreement"),
                ContractId: str("MSA-42"),
                Parties: {
                    type: "array",
                    valueArray: [
                        { type: "object", valueObject: { Name: str("Fabrikam Inc.") } },
                        { type: "object", valueObject: { Name: str("Empresa Demo S.A.") } },
                    ],
                },
                ExecutionDate: day("2026-01-10"),
                EffectiveDate: day("2026-02-01", 0.9),
                ExpirationDate: day("2027-01-31", 0.85),
                RenewalDate: day("2027-02-01"),
                ContractDuration: str("12 months"),
            },
        }],
    };
}

/** Lo que vuelve cuando el modelo no reconoce nada: sólo el texto. */
export function layoutResult(): DiAnalyzeResult {
    return {
        apiVersion: "2024-11-30",
        modelId: "prebuilt-layout",
        content: "Texto libre de una factura que el modelo no entendió",
        pages: [{}],
    };
}
