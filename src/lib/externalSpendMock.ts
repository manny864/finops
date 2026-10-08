import type {
    Commitment, ExternalSpendDocument, ExternalSpendDocumentDetail, ExternalSpendExtraction, ExternalSpendLine,
    ExternalSpendOverview, ExternalSpendSummary,
} from "@/types/externalSpend.types";

/**
 * Datos de la demo para gasto externo. Las fechas se arman relativas a hoy
 * para que la demo no envejezca: facturas del mes, un compromiso cerca de su
 * preaviso. Los importes cierran (líneas, impuestos, conversión a USD) salvo
 * donde la demo muestra una observación a propósito.
 */

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const now = () => new Date();
/** Primer día del mes, `back` meses atrás (negativo = adelante). */
const monthStart = (back: number) => ymd(new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth() - back, 1)));
const monthEnd = (back: number) => ymd(new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth() - back + 1, 0)));
const plusDays = (iso: string, days: number) => ymd(new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000));

const ANA = "ana.torres@empresa-demo.com";
const BRUNO = "bruno.rios@empresa-demo.com";

function line(description: string, quantity: number, unitPrice: number, currency: string, period: [string, string], confidence: number, serviceCategory: string | null = null): ExternalSpendLine {
    return {
        description, quantity, unitPrice, amount: Math.round(quantity * unitPrice * 100) / 100, currency,
        serviceCategory, periodStart: period[0], periodEnd: period[1], costCenter: null, confidence,
    };
}

function base(id: number, partial: Partial<ExternalSpendDocument>): ExternalSpendDocument {
    return {
        id, docType: "invoice", status: "needs_review", originalName: "", sizeBytes: 184_320, hasFile: true,
        vendorName: null, invoiceNumber: null, invoiceDate: null, dueDate: null, periodStart: null, periodEnd: null,
        currency: null, subtotal: null, tax: null, total: null, totalUsd: null, fxRate: null, fxRateDate: null,
        modelId: "prebuilt-invoice", confidence: null, pages: 1, issues: [], errorMessage: null,
        uploadedBy: ANA, reviewedBy: null, reviewedAt: null, createdAt: `${monthStart(0)}T12:00:00.000Z`,
        ...partial,
    };
}

interface Sample {
    doc: ExternalSpendDocument;
    lines: ExternalSpendLine[];
    extraction: ExternalSpendExtraction | null;
}

function samples(): Sample[] {
    const prev: [string, string] = [monthStart(1), monthEnd(1)];
    const prev2: [string, string] = [monthStart(2), monthEnd(2)];
    const contoso = [
        line("Microsoft 365 E5 (200 usuarios)", 200, 57, "USD", prev, 0.97, "Licencias"),
        line("Soporte premium", 1, 1000, "USD", prev, 0.95, "Soporte"),
    ];
    const northwind = [line("Consultoría FinOps (horas)", 40, 200, "EUR", prev2, 0.93, "Consultoría")];
    // La línea de logs que el modelo leyó mal: la suma no llega al subtotal.
    const fabrikam = [
        line("Plan Enterprise, 150 hosts", 150, 20, "USD", prev, 0.94, "Monitoreo"),
        line("Logs ingeridos (TB)", 3, 40, "USD", prev, 0.58, "Monitoreo"),
    ];
    const contractStart = monthStart(11);
    const contractEnd = monthEnd(-25);

    const extraction = (doc: ExternalSpendDocument, lines: ExternalSpendLine[], extra: Partial<ExternalSpendExtraction> = {}): ExternalSpendExtraction => ({
        modelId: doc.modelId ?? "prebuilt-invoice", apiVersion: "2024-11-30", pages: doc.pages ?? 1, confidence: doc.confidence,
        header: {
            vendorName: doc.vendorName, invoiceNumber: doc.invoiceNumber, invoiceDate: doc.invoiceDate, dueDate: doc.dueDate,
            periodStart: doc.periodStart, periodEnd: doc.periodEnd, currency: doc.currency, subtotal: doc.subtotal, tax: doc.tax, total: doc.total,
        },
        fieldConfidence: { vendorName: 0.98, invoiceNumber: 0.96, invoiceDate: 0.97, total: 0.98 },
        lines,
        ...extra,
    });

    const docs: Array<[ExternalSpendDocument, ExternalSpendLine[], Partial<ExternalSpendExtraction>?]> = [
        [base(106, {
            status: "rejected", originalName: "contoso-escaneo.jpg", modelId: "prebuilt-invoice", confidence: 0.91,
            vendorName: "Contoso Software Ltd.", invoiceNumber: "CSL-48213", invoiceDate: monthStart(0), dueDate: plusDays(monthStart(0), 30),
            periodStart: prev[0], periodEnd: prev[1], currency: "USD", subtotal: 12_400, tax: 2_604, total: 15_004,
            issues: [{ code: "duplicate_invoice", documentId: 101 }], reviewedBy: BRUNO, reviewedAt: `${monthStart(0)}T16:10:00.000Z`,
        }), contoso],
        [base(105, { status: "extracting", originalName: "factura-saas.pdf", pages: null, uploadedBy: BRUNO }), []],
        [base(104, {
            docType: "contract", originalName: "acuerdo-enterprise-contoso.pdf", modelId: "prebuilt-contract", confidence: 0.88, pages: 14,
            vendorName: "Contoso Software Ltd.", invoiceNumber: "EA-7781", invoiceDate: plusDays(contractStart, -10),
            periodStart: contractStart, periodEnd: contractEnd,
        }), [], {
            fieldConfidence: { vendorName: 0.88, invoiceNumber: 0.95, invoiceDate: 0.93, periodStart: 0.96, periodEnd: 0.94 },
            contract: {
                title: "Enterprise Agreement", parties: ["Contoso Software Ltd.", "Empresa Demo S.A."],
                effectiveDate: contractStart, expirationDate: contractEnd, renewalDate: plusDays(contractEnd, 1), duration: "36 meses",
            },
        }],
        [base(103, {
            originalName: "fabrikam-monitoring.pdf", confidence: 0.62,
            vendorName: "Fabrikam Cloud Monitoring", invoiceNumber: "FCM-2210", invoiceDate: monthStart(0), dueDate: plusDays(monthStart(0), 15),
            periodStart: prev[0], periodEnd: prev[1], currency: "USD", subtotal: 3_150, tax: 0, total: 3_150,
            issues: [{ code: "lines_mismatch" }],
        }), fabrikam, { fieldConfidence: { vendorName: 0.97, invoiceNumber: 0.62, invoiceDate: 0.95, subtotal: 0.93, total: 0.96 } }],
        [base(102, {
            status: "approved", originalName: "northwind-consultoria.pdf", confidence: 0.93, uploadedBy: BRUNO,
            vendorName: "Northwind Consulting S.L.", invoiceNumber: "NW-2026-117", invoiceDate: monthStart(1), dueDate: plusDays(monthStart(1), 30),
            periodStart: prev2[0], periodEnd: prev2[1], currency: "EUR", subtotal: 8_000, tax: 1_680, total: 9_680,
            totalUsd: 10_521.74, fxRate: 0.92, fxRateDate: monthStart(1), reviewedBy: ANA, reviewedAt: `${monthStart(1)}T15:00:00.000Z`,
            createdAt: `${monthStart(1)}T11:00:00.000Z`,
        }), northwind],
        [base(101, {
            status: "approved", originalName: "contoso-licencias.pdf", confidence: 0.95, pages: 2,
            vendorName: "Contoso Software Ltd.", invoiceNumber: "CSL-48213", invoiceDate: monthStart(0), dueDate: plusDays(monthStart(0), 30),
            periodStart: prev[0], periodEnd: prev[1], currency: "USD", subtotal: 12_400, tax: 2_604, total: 15_004,
            totalUsd: 15_004, fxRate: 1, fxRateDate: monthStart(0), reviewedBy: ANA, reviewedAt: `${monthStart(0)}T14:30:00.000Z`,
        }), contoso],
    ];
    return docs.map(([doc, lines, extra]) => ({
        doc,
        lines,
        extraction: doc.status === "extracting" ? null : extraction(doc, lines, extra),
    }));
}

function commitments(): Commitment[] {
    const created = `${monthStart(2)}T10:00:00.000Z`;
    const saasEnd = monthEnd(-1);
    return [
        {
            id: 3, vendorName: "Fabrikam Cloud Monitoring", commitmentType: "saas_subscription", amount: 37_800, currency: "USD",
            startDate: monthStart(10), endDate: saasEnd, renewalDate: plusDays(saasEnd, 1), noticeDays: 30, autoRenew: true,
            sourceDocumentId: null, createdBy: ANA, createdAt: created,
        },
        {
            id: 2, vendorName: "Northwind Consulting S.L.", commitmentType: "other", amount: 96_000, currency: "EUR",
            startDate: monthStart(9), endDate: monthEnd(-2), renewalDate: null, noticeDays: 60, autoRenew: false,
            sourceDocumentId: null, createdBy: BRUNO, createdAt: created,
        },
        {
            id: 1, vendorName: "Microsoft", commitmentType: "MACC", amount: 500_000, currency: "USD",
            startDate: monthStart(9), endDate: monthEnd(-27), renewalDate: null, noticeDays: 0, autoRenew: false,
            sourceDocumentId: null, createdBy: ANA, createdAt: created,
        },
    ];
}

function summarize(docs: ExternalSpendDocument[]): ExternalSpendSummary {
    const approved = docs.filter((d) => d.status === "approved" && d.docType === "invoice");
    const byVendor = new Map<string, { totalUsd: number; documents: number }>();
    const byMonth = new Map<string, number>();
    for (const d of approved) {
        if (d.totalUsd === null) continue;
        const v = byVendor.get(d.vendorName ?? "") ?? { totalUsd: 0, documents: 0 };
        byVendor.set(d.vendorName ?? "", { totalUsd: v.totalUsd + d.totalUsd, documents: v.documents + 1 });
        const month = (d.periodStart ?? d.invoiceDate ?? "").slice(0, 7);
        byMonth.set(month, (byMonth.get(month) ?? 0) + d.totalUsd);
    }
    return {
        totalUsd: approved.reduce((s, d) => s + (d.totalUsd ?? 0), 0),
        byVendor: [...byVendor].map(([vendorName, v]) => ({ vendorName, ...v })).sort((a, b) => b.totalUsd - a.totalUsd),
        byMonth: [...byMonth].map(([month, totalUsd]) => ({ month, totalUsd })).sort((a, b) => a.month.localeCompare(b.month)),
        unconverted: approved.filter((d) => d.totalUsd === null).length,
    };
}

export function mockExternalSpendOverview(): ExternalSpendOverview {
    const documents = samples().map((s) => s.doc);
    return { documents, commitments: commitments(), summary: summarize(documents), ai: { allowed: true } };
}

export function mockExternalSpendDocument(id: number): ExternalSpendDocumentDetail | null {
    const s = samples().find((x) => x.doc.id === id);
    return s ? { ...s.doc, lines: s.lines, extraction: s.extraction } : null;
}
