import crypto from "crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import pool, { insertPlatformAiUsage } from "@/modules/storage/db";
import { checkAiFeature, peekAiFeature, type AiFeature } from "@/lib/aiFeatureGate";
import { logAiEvent, timeAiCall } from "@/lib/aiTelemetry";
import {
    DI_LAYOUT_MODEL, DocumentIntelligenceError, diModelFor, getAnalyzeOperation, isDocumentIntelligenceConfigured, submitAnalyze,
    type DiAnalyzeResult,
} from "@/lib/documentIntelligenceClient";
import { isIso4217, isRealDate, mapAnalyzeResult, validateExtraction } from "@/lib/externalSpendExtraction";
import {
    EXTERNAL_SPEND_RETENTION_DAYS, checkExternalSpendFile, deleteExternalSpendFile, readExternalSpendFile, saveExternalSpendFile,
} from "@/lib/externalSpendFiles";
import { getRateOn, isSupportedCurrency } from "@/lib/fx";
import { errorMessage } from "@/lib/apiErrors";
import {
    BLOCKING_ISSUES, COMMITMENT_TYPES,
    type Commitment, type ExternalSpendAiStatus, type ExternalSpendDocType, type ExternalSpendDocument,
    type ExternalSpendDocumentDetail, type ExternalSpendErrorReason, type ExternalSpendExtraction, type ExternalSpendHeader,
    type ExternalSpendLine, type ExternalSpendOverview, type ExternalSpendStatus, type ExternalSpendSummary, type ValidationIssue,
} from "@/types/externalSpend.types";

/**
 * Gasto externo (Fase 4 de la propuesta de IA, sección 6.7): facturas y
 * contratos que no vienen de Azure, leídos con Document Intelligence y
 * aprobados por una persona.
 *
 * subida (gate, validación del archivo, Blob privado, fila `uploaded`)
 *   → análisis asíncrono (`prebuilt-invoice` / `prebuilt-contract`, con
 *     `prebuilt-layout` de respaldo) que sigue la subida unos segundos y
 *     después el cron `external-spend-poll`
 *   → mapeo y validaciones deterministas → `needs_review`
 *   → revisión humana → `approved` | `rejected`.
 *
 * NUNCA va a CostSnapshots ni a la detección de anomalías: lo aprobado se
 * reporta aparte y etiquetado como gasto externo.
 */
const FEATURE: AiFeature = "document-intelligence";

/** Lo que la subida espera el resultado antes de dejárselo al cron. */
const UPLOAD_WAIT_MS = 20_000;
const POLL_INTERVAL_MS = 2_000;

const STATUS: Record<ExternalSpendErrorReason, number> = {
    global_disabled: 403,
    feature_disabled: 403,
    tenant_disabled: 403,
    tier: 403,
    quota: 429,
    rate_limited: 429,
    not_configured: 503,
    duplicate: 409,
    file_type: 415,
    file_too_large: 413,
    empty_file: 400,
    invalid_input: 400,
    invalid_state: 409,
    blocking_issues: 422,
    not_found: 404,
};

/** La UI traduce `reason`; `message` queda para quien llame a la API directo. */
export class ExternalSpendError extends Error {
    readonly reason: ExternalSpendErrorReason;
    readonly status: number;
    constructor(reason: ExternalSpendErrorReason) {
        super(`Gasto externo: ${reason}`);
        this.reason = reason;
        this.status = STATUS[reason];
    }
}

const dateSchema = z.string().refine(isRealDate);
const amountSchema = z.number().gt(-1e12).lt(1e12);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const reviewSchema = z.object({
    header: z.object({
        vendorName: z.string().trim().max(255).nullable(),
        invoiceNumber: z.string().trim().max(128).nullable(),
        invoiceDate: dateSchema.nullable(),
        dueDate: dateSchema.nullable(),
        periodStart: dateSchema.nullable(),
        periodEnd: dateSchema.nullable(),
        currency: currencySchema.nullable(),
        subtotal: amountSchema.nullable(),
        tax: amountSchema.nullable(),
        total: amountSchema.nullable(),
    }),
    lines: z.array(z.object({
        description: z.string().trim().max(500).nullable(),
        quantity: amountSchema.nullable(),
        unitPrice: amountSchema.nullable(),
        amount: amountSchema.nullable(),
        currency: currencySchema.nullable(),
        serviceCategory: z.string().trim().max(100).nullable(),
        periodStart: dateSchema.nullable(),
        periodEnd: dateSchema.nullable(),
        costCenter: z.string().trim().max(100).nullable(),
        confidence: z.number().min(0).max(1).nullable(),
    })).max(1000),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

export const commitmentSchema = z.object({
    vendorName: z.string().trim().min(1).max(255),
    commitmentType: z.enum(COMMITMENT_TYPES),
    amount: z.number().min(0).lt(1e12),
    currency: z.string().refine(isIso4217),
    startDate: dateSchema,
    endDate: dateSchema,
    renewalDate: dateSchema.nullable().default(null),
    noticeDays: z.number().int().min(0).max(3650).default(0),
    autoRenew: z.boolean().default(false),
    /** El contrato revisado del que sale: queda aprobado al cargar el compromiso. */
    sourceDocumentId: z.number().int().positive().nullable().default(null),
}).refine((c) => c.startDate <= c.endDate && (!c.renewalDate || c.renewalDate >= c.startDate));
export type CommitmentInput = z.infer<typeof commitmentSchema>;

// ── Lectura ────────────────────────────────────────────────────────────────

const ymd = (column: string) => `DATE_FORMAT(${column}, '%Y-%m-%d') AS ${column}`;
const DOC_COLUMNS = [
    "id", "doc_type", "status", "original_name", "size_bytes", "stored_name", "vendor_name", "invoice_number",
    ymd("invoice_date"), ymd("due_date"), ymd("period_start"), ymd("period_end"),
    "currency", "subtotal", "tax", "total", "total_usd", "fx_rate", ymd("fx_rate_date"),
    "model_id", "confidence", "pages", "validation_issues", "error_message", "uploaded_by", "reviewed_by", "reviewed_at", "created_at",
].join(", ");

// DECIMAL llega como string; JSON, según el driver, como objeto o como string.
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const json = <T>(v: unknown): T | null => (v === null || v === undefined ? null : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const today = () => new Date().toISOString().slice(0, 10);

function toDocument(r: RowDataPacket): ExternalSpendDocument {
    return {
        id: Number(r.id),
        docType: r.doc_type,
        status: r.status,
        originalName: r.original_name,
        sizeBytes: Number(r.size_bytes),
        hasFile: Boolean(r.stored_name),
        vendorName: r.vendor_name,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        dueDate: r.due_date,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        currency: r.currency,
        subtotal: num(r.subtotal),
        tax: num(r.tax),
        total: num(r.total),
        totalUsd: num(r.total_usd),
        fxRate: num(r.fx_rate),
        fxRateDate: r.fx_rate_date,
        modelId: r.model_id,
        confidence: num(r.confidence),
        pages: num(r.pages),
        issues: json<ValidationIssue[]>(r.validation_issues) ?? [],
        errorMessage: r.error_message,
        uploadedBy: r.uploaded_by,
        reviewedBy: r.reviewed_by,
        reviewedAt: iso(r.reviewed_at),
        createdAt: iso(r.created_at) ?? "",
    };
}

function toLine(r: RowDataPacket): ExternalSpendLine {
    return {
        description: r.description,
        quantity: num(r.quantity),
        unitPrice: num(r.unit_price),
        amount: num(r.amount),
        currency: r.currency,
        serviceCategory: r.service_category,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        costCenter: r.cost_center,
        confidence: num(r.confidence),
    };
}

function toCommitment(r: RowDataPacket): Commitment {
    return {
        id: Number(r.id),
        vendorName: r.vendor_name,
        commitmentType: r.commitment_type,
        amount: Number(r.amount),
        currency: r.currency,
        startDate: r.start_date,
        endDate: r.end_date,
        renewalDate: r.renewal_date,
        noticeDays: Number(r.notice_days),
        autoRenew: Boolean(r.auto_renew),
        sourceDocumentId: num(r.source_document_id),
        createdBy: r.created_by,
        createdAt: iso(r.created_at) ?? "",
    };
}

/**
 * Fuera de Azure (o sin la identidad del stamp) no hay con qué analizar. Si
 * está configurado, el veredicto del gate sin gastar rate limit.
 */
export async function getAiStatus(tenantId: string): Promise<ExternalSpendAiStatus> {
    if (!isDocumentIntelligenceConfigured()) return { allowed: false, reason: "not_configured" };
    return peekAiFeature(tenantId, FEATURE);
}

/** ponytail: sin paginar; 200 documentos alcanzan para revisar lo pendiente. */
export async function listDocuments(tenantId: string): Promise<ExternalSpendDocument[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${DOC_COLUMNS} FROM ExternalSpendDocuments WHERE tenant_id = ? ORDER BY id DESC LIMIT 200`,
        [tenantId],
    );
    return rows.map(toDocument);
}

export async function getDocumentDetail(tenantId: string, id: number): Promise<ExternalSpendDocumentDetail | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${DOC_COLUMNS}, extraction_json FROM ExternalSpendDocuments WHERE id = ? AND tenant_id = ?`,
        [id, tenantId],
    );
    if (!rows[0]) return null;
    const [lines] = await pool.query<RowDataPacket[]>(
        `SELECT description, quantity, unit_price, amount, currency, service_category, ${ymd("period_start")}, ${ymd("period_end")},
                cost_center, confidence
         FROM ExternalSpendLines WHERE document_id = ? ORDER BY line_no`,
        [id],
    );
    return { ...toDocument(rows[0]), lines: lines.map(toLine), extraction: json<ExternalSpendExtraction>(rows[0].extraction_json) };
}

export async function listCommitments(tenantId: string): Promise<Commitment[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, vendor_name, commitment_type, amount, currency, ${ymd("start_date")}, ${ymd("end_date")}, ${ymd("renewal_date")},
                notice_days, auto_renew, source_document_id, created_by, created_at
         FROM Commitments WHERE tenant_id = ? ORDER BY end_date, id LIMIT 500`,
        [tenantId],
    );
    return rows.map(toCommitment);
}

/**
 * Sólo facturas aprobadas, en USD con la tasa fijada al aprobar. El mes es el
 * del período facturado y, si la factura no lo trae, el de su fecha.
 */
export async function getSummary(tenantId: string): Promise<ExternalSpendSummary> {
    const approved = "tenant_id = ? AND status = 'approved' AND doc_type = 'invoice'";
    const [[totals], [vendors], [months]] = await Promise.all([
        pool.query<RowDataPacket[]>(
            `SELECT COALESCE(SUM(total_usd), 0) AS usd, COALESCE(SUM(total_usd IS NULL), 0) AS unconverted
             FROM ExternalSpendDocuments WHERE ${approved}`,
            [tenantId],
        ),
        pool.query<RowDataPacket[]>(
            `SELECT COALESCE(vendor_name, '') AS vendor, SUM(total_usd) AS usd, COUNT(*) AS docs
             FROM ExternalSpendDocuments WHERE ${approved} AND total_usd IS NOT NULL
             GROUP BY vendor ORDER BY usd DESC LIMIT 20`,
            [tenantId],
        ),
        pool.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(COALESCE(period_start, invoice_date), '%Y-%m') AS ym, SUM(total_usd) AS usd
             FROM ExternalSpendDocuments WHERE ${approved} AND total_usd IS NOT NULL
             GROUP BY ym ORDER BY ym DESC LIMIT 12`,
            [tenantId],
        ),
    ]);
    return {
        totalUsd: Number(totals[0]?.usd ?? 0),
        byVendor: vendors.map((v) => ({ vendorName: v.vendor, totalUsd: Number(v.usd), documents: Number(v.docs) })),
        byMonth: months.map((m) => ({ month: m.ym, totalUsd: Number(m.usd) })).reverse(),
        unconverted: Number(totals[0]?.unconverted ?? 0),
    };
}

export async function getOverview(tenantId: string): Promise<ExternalSpendOverview> {
    const [documents, commitments, summary, ai] = await Promise.all([
        listDocuments(tenantId), listCommitments(tenantId), getSummary(tenantId), getAiStatus(tenantId),
    ]);
    return { documents, commitments, summary, ai };
}

// ── Validación ─────────────────────────────────────────────────────────────

/**
 * Las validaciones deterministas más el duplicado por proveedor y número
 * contra otro documento vivo. `approvedTwin`: ese otro ya está aprobado, y
 * aprobar éste contaría la factura dos veces.
 */
async function issuesFor(
    tenantId: string, id: number, docType: ExternalSpendDocType, header: ExternalSpendHeader, lines: ExternalSpendLine[],
): Promise<{ issues: ValidationIssue[]; approvedTwin: boolean }> {
    const issues = validateExtraction(docType, header, lines, today());
    if (docType !== "invoice" || !header.vendorName || !header.invoiceNumber) return { issues, approvedTwin: false };
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, status FROM ExternalSpendDocuments
         WHERE tenant_id = ? AND id <> ? AND doc_type = 'invoice' AND vendor_name = ? AND invoice_number = ?
           AND status NOT IN ('rejected', 'failed')
         ORDER BY status = 'approved' DESC, id LIMIT 1`,
        [tenantId, id, header.vendorName, header.invoiceNumber],
    );
    if (!rows[0]) return { issues, approvedTwin: false };
    issues.push({ code: "duplicate_invoice", documentId: Number(rows[0].id) });
    return { issues, approvedTwin: rows[0].status === "approved" };
}

const HEADER_SET =
    "vendor_name = ?, invoice_number = ?, invoice_date = ?, due_date = ?, period_start = ?, period_end = ?, currency = ?, subtotal = ?, tax = ?, total = ?";
const headerValues = (h: ExternalSpendHeader) =>
    [h.vendorName, h.invoiceNumber, h.invoiceDate, h.dueDate, h.periodStart, h.periodEnd, h.currency, h.subtotal, h.tax, h.total];

async function replaceLines(conn: PoolConnection, tenantId: string, documentId: number, lines: ExternalSpendLine[]): Promise<void> {
    await conn.query("DELETE FROM ExternalSpendLines WHERE document_id = ?", [documentId]);
    if (lines.length === 0) return;
    await conn.query(
        `INSERT INTO ExternalSpendLines (document_id, tenant_id, line_no, description, quantity, unit_price, amount, currency,
            service_category, period_start, period_end, cost_center, confidence)
         VALUES ?`,
        [lines.map((l, i) => [
            documentId, tenantId, i + 1, l.description, l.quantity, l.unitPrice, l.amount, l.currency,
            l.serviceCategory, l.periodStart, l.periodEnd, l.costCenter, l.confidence,
        ])],
    );
}

/** Corre `write` en una transacción; si lanza, no queda nada a medias. */
async function inTransaction(write: (conn: PoolConnection) => Promise<void>): Promise<void> {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await write(conn);
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

async function notFoundOrState(tenantId: string, id: number): Promise<ExternalSpendError> {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT 1 FROM ExternalSpendDocuments WHERE id = ? AND tenant_id = ?", [id, tenantId]);
    return new ExternalSpendError(rows.length ? "invalid_state" : "not_found");
}

// ── Subida y análisis ──────────────────────────────────────────────────────

interface ProcessingRow {
    id: number;
    tenant_id: string;
    doc_type: ExternalSpendDocType;
    status: ExternalSpendStatus;
    stored_name: string | null;
    model_id: string | null;
    operation_location: string | null;
    stale: number;
}

/**
 * Sube un documento y lo manda a analizar. Espera el resultado unos segundos
 * (una factura de una o dos páginas suele estar antes); si no llega, sigue el
 * cron y la pantalla lo muestra en análisis.
 */
export async function uploadDocument(
    input: { tenantId: string; userEmail: string; docType: ExternalSpendDocType; originalName: string; bytes: Buffer },
    opts: { waitMs?: number } = {},
): Promise<ExternalSpendDocument> {
    const { tenantId, bytes } = input;
    if (!isDocumentIntelligenceConfigured()) throw new ExternalSpendError("not_configured");

    const file = checkExternalSpendFile(bytes);
    if (!file.ok) throw new ExternalSpendError(file.reason);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

    const [existing] = await pool.query<RowDataPacket[]>(
        "SELECT id, status, stored_name FROM ExternalSpendDocuments WHERE tenant_id = ? AND sha256 = ?",
        [tenantId, sha256],
    );
    const previous = existing[0];
    // Rechazado o fallido no bloquea: se puede volver a subir (por ejemplo, con el tipo correcto).
    if (previous && previous.status !== "rejected" && previous.status !== "failed") throw new ExternalSpendError("duplicate");

    // El gate va después de lo que se puede rechazar gratis: no gasta rate limit en un archivo inválido.
    const gate = await checkAiFeature(tenantId, FEATURE, input.userEmail);
    if (!gate.allowed) throw new ExternalSpendError(gate.reason);

    if (previous) {
        await pool.query("DELETE FROM ExternalSpendDocuments WHERE id = ?", [previous.id]);
        if (previous.stored_name) await deleteExternalSpendFile(previous.stored_name);
    }

    const storedName = await saveExternalSpendFile(bytes, file.ext);
    let id: number;
    try {
        const [res] = await pool.query<ResultSetHeader>(
            `INSERT INTO ExternalSpendDocuments (tenant_id, doc_type, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [tenantId, input.docType, input.originalName.slice(0, 255), storedName, file.mime, bytes.length, sha256, input.userEmail],
        );
        id = res.insertId;
    } catch (e) {
        await deleteExternalSpendFile(storedName);
        // Dos subidas simultáneas del mismo archivo: la segunda choca con la clave única.
        if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new ExternalSpendError("duplicate");
        throw e;
    }

    const deadline = Date.now() + (opts.waitMs ?? UPLOAD_WAIT_MS);
    try {
        for (;;) {
            const status = await processDocument(id);
            if ((status !== "uploaded" && status !== "extracting") || Date.now() >= deadline) break;
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
    } catch (e) {
        // El documento ya quedó subido: lo retoma el cron.
        console.warn(`[externalSpend] el análisis del documento ${id} sigue en el cron:`, errorMessage(e));
    }
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${DOC_COLUMNS} FROM ExternalSpendDocuments WHERE id = ? AND tenant_id = ?`,
        [id, tenantId],
    );
    if (!rows[0]) throw new ExternalSpendError("not_found");
    return toDocument(rows[0]);
}

/**
 * Avanza un documento un paso: manda a analizar lo subido o consulta lo que
 * está en análisis. Devuelve el estado en que queda.
 *
 * Cada cambio de estado es condicional al estado y a la operación leídos
 * (`operation_location <=> ?`): si la subida y el cron llegan a la vez, sólo
 * uno avanza y el otro no pisa nada.
 */
export async function processDocument(id: number): Promise<ExternalSpendStatus | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, tenant_id, doc_type, status, stored_name, model_id, operation_location,
                updated_at < NOW() - INTERVAL 1 DAY AS stale
         FROM ExternalSpendDocuments WHERE id = ?`,
        [id],
    );
    const doc = rows[0] as ProcessingRow | undefined;
    if (!doc) return null;
    if (doc.status === "uploaded") return submit(doc, diModelFor(doc.doc_type));
    if (doc.status === "extracting") return poll(doc);
    return doc.status;
}

async function transition(doc: ProcessingRow, set: string, values: unknown[], conn: Pick<PoolConnection, "query"> = pool): Promise<boolean> {
    const [res] = await conn.query<ResultSetHeader>(
        `UPDATE ExternalSpendDocuments SET ${set} WHERE id = ? AND status = ? AND operation_location <=> ?`,
        [...values, doc.id, doc.status, doc.operation_location],
    );
    return res.affectedRows === 1;
}

async function fail(doc: ProcessingRow, message: string): Promise<ExternalSpendStatus> {
    await transition(doc, "status = 'failed', operation_location = NULL, error_message = ?", [message.slice(0, 500)]);
    return "failed";
}

async function submit(doc: ProcessingRow, modelId: string): Promise<ExternalSpendStatus> {
    let bytes: Buffer | null;
    try {
        bytes = doc.stored_name ? await readExternalSpendFile(doc.stored_name) : null;
    } catch (e) {
        // Storage caído o sin permisos: no es que falte el archivo. Lo reintenta el cron, hasta un día.
        console.warn(`[externalSpend] no se pudo leer el original del documento ${doc.id}:`, errorMessage(e));
        return doc.stale ? fail(doc, "No se pudo leer el archivo original en 24 horas.") : doc.status;
    }
    if (!bytes) return fail(doc, "No se encontró el archivo original.");
    try {
        const location = await timeAiCall(FEATURE, () => submitAnalyze(modelId, bytes));
        await transition(doc, "status = 'extracting', model_id = ?, operation_location = ?, error_message = NULL", [modelId, location]);
        return "extracting";
    } catch (e) {
        if (e instanceof DocumentIntelligenceError && !e.retryable) {
            // Por ejemplo, un modelo que no está en la región: el layout lee igual el texto.
            if (modelId !== DI_LAYOUT_MODEL) return submit(doc, DI_LAYOUT_MODEL);
            return fail(doc, e.message);
        }
        // 429, 5xx o red: queda como está y lo reintenta el cron, hasta un día.
        console.warn(`[externalSpend] no se pudo mandar a analizar el documento ${doc.id}:`, errorMessage(e));
        return doc.stale ? fail(doc, "No se pudo mandar a analizar en 24 horas.") : doc.status;
    }
}

async function poll(doc: ProcessingRow): Promise<ExternalSpendStatus> {
    if (!doc.operation_location) return fail(doc, "Falta la operación de análisis.");
    let op;
    try {
        op = await timeAiCall(FEATURE, () => getAnalyzeOperation(doc.operation_location!));
    } catch (e) {
        if (e instanceof DocumentIntelligenceError && !e.retryable) return fail(doc, e.message);
        console.warn(`[externalSpend] no se pudo consultar el análisis del documento ${doc.id}:`, errorMessage(e));
        return doc.stale ? fail(doc, "El análisis no terminó en 24 horas.") : doc.status;
    }
    if (op.status === "notStarted" || op.status === "running") {
        // Document Intelligence guarda el resultado 24 horas.
        return doc.stale ? fail(doc, "El análisis no terminó en 24 horas.") : doc.status;
    }
    if (op.status !== "succeeded" || !op.analyzeResult) {
        // `prebuilt-contract` sólo lee contratos en inglés: el layout trae al menos el texto.
        if (doc.model_id !== DI_LAYOUT_MODEL) return submit(doc, DI_LAYOUT_MODEL);
        return fail(doc, op.error?.message || `El análisis terminó en ${op.status}.`);
    }
    return complete(doc, op.analyzeResult);
}

async function complete(doc: ProcessingRow, result: DiAnalyzeResult): Promise<ExternalSpendStatus> {
    const extraction = mapAnalyzeResult(doc.doc_type, doc.model_id ?? DI_LAYOUT_MODEL, result);
    const { issues } = await issuesFor(doc.tenant_id, doc.id, doc.doc_type, extraction.header, extraction.lines);
    let won = false;
    await inTransaction(async (conn) => {
        won = await transition(
            doc,
            `status = 'needs_review', ${HEADER_SET}, extraction_json = ?, validation_issues = ?, api_version = ?, confidence = ?,
             pages = ?, operation_location = NULL, error_message = NULL`,
            [
                ...headerValues(extraction.header), JSON.stringify(extraction), JSON.stringify(issues), extraction.apiVersion,
                extraction.confidence, extraction.pages,
            ],
            conn,
        );
        if (won) await replaceLines(conn, doc.tenant_id, doc.id, extraction.lines);
    });
    if (!won) return doc.status;

    // Una fila por documento analizado, que es lo que cuenta la cuota del gate;
    // las páginas que cobra Azure van en input_tokens (no hay tokens acá).
    await insertPlatformAiUsage({
        tenantId: doc.tenant_id,
        source: "platform",
        provider: "azure_document_intelligence",
        modelName: extraction.modelId,
        feature: FEATURE,
        inputTokens: extraction.pages,
        outputTokens: 0,
    });
    if (issues.length > 0) logAiEvent(FEATURE, { stage: "output", outcome: "rejected" });
    return "needs_review";
}

/**
 * Lo que la subida no llegó a terminar. Un minuto de gracia para no pisarse
 * con la subida, que sigue su documento en línea los primeros segundos.
 */
export async function processPendingDocuments(limit = 20): Promise<{ processed: number; errors: string[] }> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM ExternalSpendDocuments
         WHERE status IN ('uploaded', 'extracting') AND updated_at < NOW() - INTERVAL 1 MINUTE
         ORDER BY updated_at LIMIT ?`,
        [limit],
    );
    const errors: string[] = [];
    for (const r of rows) {
        try {
            await processDocument(Number(r.id));
        } catch (e) {
            errors.push(`${r.id}: ${errorMessage(e)}`);
        }
    }
    return { processed: rows.length, errors };
}

/**
 * Retención: el original se borra a los 365 días; lo extraído y lo revisado
 * quedan. Lo que sigue pendiente de revisión conserva el archivo.
 */
export async function purgeExpiredFiles(limit = 200): Promise<number> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, stored_name FROM ExternalSpendDocuments
         WHERE stored_name IS NOT NULL AND status IN ('approved', 'rejected', 'failed')
           AND created_at < NOW() - INTERVAL ? DAY
         LIMIT ?`,
        [EXTERNAL_SPEND_RETENTION_DAYS, limit],
    );
    for (const r of rows) {
        await deleteExternalSpendFile(r.stored_name);
        await pool.query("UPDATE ExternalSpendDocuments SET stored_name = NULL WHERE id = ?", [r.id]);
    }
    return rows.length;
}

export async function getDocumentFile(tenantId: string, id: number): Promise<{ name: string; mime: string; bytes: Buffer } | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT original_name, mime_type, stored_name FROM ExternalSpendDocuments WHERE id = ? AND tenant_id = ?",
        [id, tenantId],
    );
    if (!rows[0]) throw new ExternalSpendError("not_found");
    const bytes = rows[0].stored_name ? await readExternalSpendFile(rows[0].stored_name) : null;
    return bytes ? { name: rows[0].original_name, mime: rows[0].mime_type, bytes } : null;
}

// ── Revisión ───────────────────────────────────────────────────────────────

/** Corrige la cabecera y las líneas y vuelve a validar. Sólo mientras espera revisión. */
export async function updateDocument(tenantId: string, id: number, input: ReviewInput): Promise<void> {
    const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT doc_type, status FROM ExternalSpendDocuments WHERE id = ? AND tenant_id = ?",
        [id, tenantId],
    );
    if (!rows[0]) throw new ExternalSpendError("not_found");
    if (rows[0].status !== "needs_review") throw new ExternalSpendError("invalid_state");
    const docType: ExternalSpendDocType = rows[0].doc_type;
    const lines = docType === "invoice" ? input.lines : [];
    const { issues } = await issuesFor(tenantId, id, docType, input.header, lines);
    await inTransaction(async (conn) => {
        const [res] = await conn.query<ResultSetHeader>(
            `UPDATE ExternalSpendDocuments SET ${HEADER_SET}, validation_issues = ?
             WHERE id = ? AND tenant_id = ? AND status = 'needs_review'`,
            [...headerValues(input.header), JSON.stringify(issues), id, tenantId],
        );
        if (res.affectedRows !== 1) throw new ExternalSpendError("invalid_state");
        await replaceLines(conn, tenantId, id, lines);
    });
}

/**
 * Aprueba una factura: desde acá cuenta en los reportes de gasto externo. Se
 * vuelve a validar y se fija el equivalente en USD con la tasa de la fecha de
 * la factura. Los contratos se aprueban al cargar su compromiso.
 */
export async function approveDocument(tenantId: string, id: number, reviewer: string): Promise<void> {
    const doc = await getDocumentDetail(tenantId, id);
    if (!doc) throw new ExternalSpendError("not_found");
    if (doc.docType !== "invoice" || doc.status !== "needs_review") throw new ExternalSpendError("invalid_state");

    const { issues, approvedTwin } = await issuesFor(tenantId, id, "invoice", doc, doc.lines);
    if (approvedTwin || issues.some((i) => BLOCKING_ISSUES.includes(i.code))) {
        await pool.query("UPDATE ExternalSpendDocuments SET validation_issues = ? WHERE id = ?", [JSON.stringify(issues), id]);
        throw new ExternalSpendError("blocking_issues");
    }

    // Sin bloqueantes hay moneda, fecha y total. Una moneda sin tasa queda sin
    // USD y el resumen la cuenta aparte.
    let usd: { total: string; rate: string; rateDate: string | null } | null = null;
    if (doc.currency && isSupportedCurrency(doc.currency)) {
        const fx = await getRateOn(doc.currency, doc.invoiceDate!);
        usd = { total: new Decimal(doc.total!).div(fx.rate).toFixed(4), rate: fx.rate.toString(), rateDate: fx.rateDate };
    }
    const [res] = await pool.query<ResultSetHeader>(
        `UPDATE ExternalSpendDocuments
         SET status = 'approved', total_usd = ?, fx_rate = ?, fx_rate_date = ?, validation_issues = ?, reviewed_by = ?, reviewed_at = NOW()
         WHERE id = ? AND tenant_id = ? AND status = 'needs_review'`,
        [usd?.total ?? null, usd?.rate ?? null, usd?.rateDate ?? null, JSON.stringify(issues), reviewer, id, tenantId],
    );
    if (res.affectedRows !== 1) throw new ExternalSpendError("invalid_state");
}

/**
 * También deshace la aprobación de una factura: sale de los reportes. Un
 * contrato aprobado no: su compromiso seguiría avisando y, si se vuelve a
 * subir el PDF, quedarían dos. Se deshace borrando el compromiso.
 */
export async function rejectDocument(tenantId: string, id: number, reviewer: string): Promise<void> {
    const [res] = await pool.query<ResultSetHeader>(
        `UPDATE ExternalSpendDocuments SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW()
         WHERE id = ? AND tenant_id = ? AND (status = 'needs_review' OR (status = 'approved' AND doc_type = 'invoice'))`,
        [reviewer, id, tenantId],
    );
    if (res.affectedRows !== 1) throw await notFoundOrState(tenantId, id);
}

// ── Compromisos ────────────────────────────────────────────────────────────

/** Con `sourceDocumentId`, en la misma transacción que aprueba el contrato: no queda uno sin el otro. */
export async function createCommitment(tenantId: string, user: string, input: CommitmentInput): Promise<number> {
    let id = 0;
    await inTransaction(async (conn) => {
        if (input.sourceDocumentId) {
            const [res] = await conn.query<ResultSetHeader>(
                `UPDATE ExternalSpendDocuments SET status = 'approved', reviewed_by = ?, reviewed_at = NOW()
                 WHERE id = ? AND tenant_id = ? AND doc_type = 'contract' AND status = 'needs_review'`,
                [user, input.sourceDocumentId, tenantId],
            );
            if (res.affectedRows !== 1) throw await notFoundOrState(tenantId, input.sourceDocumentId);
        }
        const [res] = await conn.query<ResultSetHeader>(
            `INSERT INTO Commitments (tenant_id, vendor_name, commitment_type, amount, currency, start_date, end_date, renewal_date,
                notice_days, auto_renew, source_document_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId, input.vendorName, input.commitmentType, input.amount, input.currency, input.startDate, input.endDate,
                input.renewalDate, input.noticeDays, input.autoRenew ? 1 : 0, input.sourceDocumentId, user,
            ],
        );
        id = res.insertId;
    });
    return id;
}

export async function deleteCommitment(tenantId: string, id: number): Promise<void> {
    const [res] = await pool.query<ResultSetHeader>("DELETE FROM Commitments WHERE id = ? AND tenant_id = ?", [id, tenantId]);
    if (res.affectedRows !== 1) throw new ExternalSpendError("not_found");
}
