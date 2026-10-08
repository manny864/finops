import { DI_API_VERSION, type DiAnalyzeResult, type DiField } from "@/lib/documentIntelligenceClient";
import type {
    ContractTerms, ExternalSpendDocType, ExternalSpendExtraction, ExternalSpendHeader, ExternalSpendLine, ValidationIssue,
} from "@/types/externalSpend.types";

/**
 * Del resultado de Document Intelligence a la cabecera y las líneas de gasto
 * externo, y las validaciones deterministas que corren antes de la revisión
 * humana (sección 6.7 de la propuesta). Funciones puras: el servicio pone la
 * base y la detección de duplicados.
 */

/** Texto que se guarda para cargar a mano cuando el modelo no reconoció campos. */
const CONTENT_MAX_CHARS = 20_000;

/** `YYYY-MM-DD` y que exista: MySQL rechaza un 2026-02-30. */
export function isRealDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

// Los recortes son los anchos de las columnas: lo que no entra no se guarda.
const text = (f?: DiField, max = 255): string | null => (f?.valueString ?? f?.content)?.trim().slice(0, max) || null;
const date = (f?: DiField): string | null => (f?.valueDate && isRealDate(f.valueDate) ? f.valueDate : null);
// Un importe de 10^12 o más en una factura es un error de lectura, y no entra en DECIMAL(18,6).
const finite = (v?: number): number | null => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e12 ? v : null);
const num = (f?: DiField): number | null => finite(f?.valueNumber ?? f?.valueInteger);
// Según el modelo y la versión, un importe llega como `currency` o como `number`.
const money = (f?: DiField): number | null => finite(f?.valueCurrency?.amount ?? f?.valueNumber ?? f?.valueInteger);
const currency = (f?: DiField): string | null => {
    const code = f?.valueCurrency?.currencyCode?.trim().toUpperCase();
    return code && /^[A-Z]{3}$/.test(code) ? code : null;
};

interface Mapped {
    header: ExternalSpendHeader;
    lines: ExternalSpendLine[];
    /** El campo de DI del que salió cada dato de la cabecera, por su confianza. */
    source: Partial<Record<keyof ExternalSpendHeader, DiField | undefined>>;
    contract?: ContractTerms;
}

function mapInvoice(fields: Record<string, DiField>): Mapped {
    const header: ExternalSpendHeader = {
        vendorName: text(fields.VendorName),
        invoiceNumber: text(fields.InvoiceId, 128),
        invoiceDate: date(fields.InvoiceDate),
        dueDate: date(fields.DueDate),
        periodStart: date(fields.ServiceStartDate),
        periodEnd: date(fields.ServiceEndDate),
        currency: [fields.InvoiceTotal, fields.SubTotal, fields.TotalTax, fields.AmountDue].map(currency).find(Boolean) ?? null,
        subtotal: money(fields.SubTotal),
        tax: money(fields.TotalTax),
        // AmountDue no sirve de respaldo: puede arrastrar saldos anteriores.
        total: money(fields.InvoiceTotal),
    };
    const lines: ExternalSpendLine[] = (fields.Items?.valueArray ?? []).map((item) => {
        const o = item.valueObject ?? {};
        return {
            description: text(o.Description, 500) ?? text(o.ProductCode, 500),
            quantity: num(o.Quantity),
            unitPrice: money(o.UnitPrice),
            amount: money(o.Amount),
            currency: currency(o.Amount) ?? header.currency,
            serviceCategory: null,
            periodStart: date(o.Date),
            periodEnd: date(o.Date),
            costCenter: null,
            confidence: item.confidence ?? null,
        };
    });
    const source: Mapped["source"] = {
        vendorName: fields.VendorName, invoiceNumber: fields.InvoiceId, invoiceDate: fields.InvoiceDate,
        dueDate: fields.DueDate, periodStart: fields.ServiceStartDate, periodEnd: fields.ServiceEndDate,
        subtotal: fields.SubTotal, tax: fields.TotalTax, total: fields.InvoiceTotal,
    };
    return { header, lines, source };
}

/**
 * `prebuilt-contract` no extrae montos: quien revisa los carga al dar de alta
 * el compromiso. De las partes no se sabe cuál es el proveedor; se propone la
 * primera y se corrige en la revisión.
 */
function mapContract(fields: Record<string, DiField>): Mapped {
    const parties = (fields.Parties?.valueArray ?? [])
        .map((p) => text(p.valueObject?.Name) ?? text(p))
        .filter((p): p is string => Boolean(p));
    const contract: ContractTerms = {
        title: text(fields.Title),
        parties,
        effectiveDate: date(fields.EffectiveDate),
        expirationDate: date(fields.ExpirationDate),
        renewalDate: date(fields.RenewalDate),
        duration: text(fields.ContractDuration),
    };
    const header: ExternalSpendHeader = {
        vendorName: parties[0] ?? null,
        invoiceNumber: text(fields.ContractId, 128),
        invoiceDate: date(fields.ExecutionDate),
        dueDate: null,
        periodStart: contract.effectiveDate,
        periodEnd: contract.expirationDate,
        currency: null,
        subtotal: null,
        tax: null,
        total: null,
    };
    const source: Mapped["source"] = {
        vendorName: fields.Parties, invoiceNumber: fields.ContractId, invoiceDate: fields.ExecutionDate,
        periodStart: fields.EffectiveDate, periodEnd: fields.ExpirationDate,
    };
    return { header, lines: [], contract, source };
}

export function mapAnalyzeResult(docType: ExternalSpendDocType, modelId: string, result: DiAnalyzeResult): ExternalSpendExtraction {
    const fields = result.documents?.[0]?.fields ?? {};
    const mapped = docType === "contract" ? mapContract(fields) : mapInvoice(fields);

    const fieldConfidence: ExternalSpendExtraction["fieldConfidence"] = {};
    for (const [key, field] of Object.entries(mapped.source) as Array<[keyof ExternalSpendHeader, DiField | undefined]>) {
        if (mapped.header[key] !== null && typeof field?.confidence === "number") fieldConfidence[key] = field.confidence;
    }
    const confidences = Object.values(fieldConfidence);
    const recognized = Object.values(mapped.header).some((v) => v !== null) || mapped.lines.length > 0;

    return {
        modelId: result.modelId || modelId,
        apiVersion: result.apiVersion || DI_API_VERSION,
        pages: result.pages?.length ?? 0,
        confidence: confidences.length ? Math.min(...confidences) : null,
        header: mapped.header,
        fieldConfidence,
        lines: mapped.lines,
        ...(mapped.contract ? { contract: mapped.contract } : {}),
        // Es el respaldo de `prebuilt-layout`: los modelos prebuilt ya traen el
        // texto del layout, así que no hace falta una segunda llamada (que se
        // paga) para tenerlo cuando no reconocieron campos.
        ...(recognized ? {} : { content: (result.content ?? "").slice(0, CONTENT_MAX_CHARS) }),
    };
}

// `Intl.supportedValuesOf` es la lista ISO 4217 que trae el runtime (Node 18+).
const ISO_4217 = typeof Intl.supportedValuesOf === "function" ? new Set(Intl.supportedValuesOf("currency")) : null;

export const isIso4217 = (code: string | null): boolean =>
    Boolean(code && /^[A-Z]{3}$/.test(code) && (!ISO_4217 || ISO_4217.has(code)));

/**
 * Medio punto de tolerancia, con un piso de un centavo: absorbe el redondeo
 * por línea sin tapar una línea faltante.
 */
export const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005) + 1e-9;

/**
 * Validaciones deterministas sobre lo extraído o lo editado. Los duplicados
 * por proveedor y número los agrega el servicio, que tiene la base; los
 * duplicados por hash ni llegan acá (se rechazan al subir).
 *
 * `today` en `YYYY-MM-DD` (UTC).
 */
export function validateExtraction(
    docType: ExternalSpendDocType,
    header: ExternalSpendHeader,
    lines: ExternalSpendLine[],
    today: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (Object.values(header).every((v) => v === null) && lines.length === 0) issues.push({ code: "no_fields" });

    if (docType === "invoice") {
        if (header.total === null) issues.push({ code: "total_missing" });
        if (!header.invoiceDate) issues.push({ code: "date_missing" });
        if (!isIso4217(header.currency)) issues.push({ code: "currency_invalid" });

        const amounts = lines.map((l) => l.amount).filter((a): a is number => a !== null);
        if (header.subtotal !== null && amounts.length > 0 && !near(amounts.reduce((s, a) => s + a, 0), header.subtotal)) {
            issues.push({ code: "lines_mismatch" });
        }
        if (header.subtotal !== null && header.total !== null && !near(header.subtotal + (header.tax ?? 0), header.total)) {
            issues.push({ code: "total_mismatch" });
        }
    }

    const backwards = (from: string | null, to: string | null) => Boolean(from && to && from > to);
    if (
        backwards(header.invoiceDate, header.dueDate) ||
        backwards(header.periodStart, header.periodEnd) ||
        backwards(header.invoiceDate, today) ||
        lines.some((l) => backwards(l.periodStart, l.periodEnd))
    ) {
        issues.push({ code: "dates_incoherent" });
    }
    return issues;
}
