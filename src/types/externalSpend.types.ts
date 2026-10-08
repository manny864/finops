/**
 * Gasto externo (Fase 4 de la propuesta de IA, sección 6.7): facturas y
 * contratos que no vienen de la ingesta de Azure. Los dominios viven acá y no
 * en el servicio para que la UI y el test de claves i18n los importen sin
 * arrastrar la base.
 */
export const EXTERNAL_SPEND_DOC_TYPES = ["invoice", "contract"] as const;
export type ExternalSpendDocType = (typeof EXTERNAL_SPEND_DOC_TYPES)[number];

/** `uploaded → extracting → needs_review → approved | rejected`; `failed` desde cualquiera de los dos primeros. */
export const EXTERNAL_SPEND_STATUSES = ["uploaded", "extracting", "needs_review", "approved", "rejected", "failed"] as const;
export type ExternalSpendStatus = (typeof EXTERNAL_SPEND_STATUSES)[number];

/** Tamaño máximo del original. Lo aplica el servidor y lo anuncia la pantalla. */
export const EXTERNAL_SPEND_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Tope duro de páginas por documento (parámetro `pages` del análisis). DI
 * cobra por página analizada: una factura o un contrato normales entran de
 * sobra, y un PDF de 300 páginas no se come la cuota de un mes.
 */
export const EXTERNAL_SPEND_MAX_PAGES = 20;

export const COMMITMENT_TYPES = ["EA", "MACC", "savings_plan", "reservation", "saas_subscription", "other"] as const;
export type CommitmentType = (typeof COMMITMENT_TYPES)[number];

/**
 * Por qué no se pudo subir o revisar un documento: los motivos del gate
 * (`aiFeatureGate.ts`) más los propios. La página muestra
 * `ExternalSpend.error_<motivo>`.
 */
export const EXTERNAL_SPEND_ERROR_REASONS = [
    "global_disabled",
    "feature_disabled",
    "tenant_disabled",
    "tier",
    "quota",
    "rate_limited",
    "not_configured",
    "duplicate",
    "file_type",
    "file_too_large",
    "empty_file",
    "invalid_input",
    "invalid_state",
    "blocking_issues",
    "not_found",
] as const;
export type ExternalSpendErrorReason = (typeof EXTERNAL_SPEND_ERROR_REASONS)[number];

/**
 * Observaciones de la validación determinista (`ExternalSpend.issue_<código>`).
 * Las de `BLOCKING_ISSUES` impiden aprobar; el resto son avisos para quien
 * revisa, que conoce el documento mejor que la regla.
 */
export const VALIDATION_ISSUE_CODES = [
    "no_fields",
    "total_missing",
    "date_missing",
    "currency_invalid",
    "lines_mismatch",
    "total_mismatch",
    "dates_incoherent",
    "duplicate_invoice",
] as const;
export type ValidationIssueCode = (typeof VALIDATION_ISSUE_CODES)[number];

export const BLOCKING_ISSUES: readonly ValidationIssueCode[] = ["total_missing", "date_missing", "currency_invalid"];

export interface ValidationIssue {
    code: ValidationIssueCode;
    /** El otro documento, en `duplicate_invoice`. */
    documentId?: number;
}

/** Cabecera revisable. Fechas `YYYY-MM-DD`; importes en la moneda del documento. */
export interface ExternalSpendHeader {
    vendorName: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    dueDate: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    currency: string | null;
    subtotal: number | null;
    tax: number | null;
    total: number | null;
}

export interface ExternalSpendLine {
    description: string | null;
    quantity: number | null;
    unitPrice: number | null;
    amount: number | null;
    currency: string | null;
    serviceCategory: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    costCenter: string | null;
    confidence: number | null;
}

/** Lo que un contrato trae además de la cabecera; precarga el alta del compromiso. */
export interface ContractTerms {
    title: string | null;
    parties: string[];
    effectiveDate: string | null;
    expirationDate: string | null;
    renewalDate: string | null;
    duration: string | null;
}

/** El resultado del modelo ya mapeado: se guarda tal cual en `extraction_json`. */
export interface ExternalSpendExtraction {
    modelId: string;
    apiVersion: string;
    pages: number;
    /** La menor confianza entre los campos de cabecera que el modelo llenó. */
    confidence: number | null;
    header: ExternalSpendHeader;
    /** Confianza por campo de la cabecera, para marcar en la revisión lo dudoso. */
    fieldConfidence: Partial<Record<keyof ExternalSpendHeader, number>>;
    lines: ExternalSpendLine[];
    contract?: ContractTerms;
    /**
     * El texto del documento, recortado, cuando el modelo no reconoció campos:
     * quien revisa los carga a mano (es el respaldo de `prebuilt-layout`).
     */
    content?: string;
}

export interface ExternalSpendDocument extends ExternalSpendHeader {
    id: number;
    docType: ExternalSpendDocType;
    status: ExternalSpendStatus;
    originalName: string;
    sizeBytes: number;
    /** false cuando la retención ya borró el original. */
    hasFile: boolean;
    totalUsd: number | null;
    fxRate: number | null;
    fxRateDate: string | null;
    modelId: string | null;
    confidence: number | null;
    pages: number | null;
    issues: ValidationIssue[];
    errorMessage: string | null;
    uploadedBy: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    createdAt: string;
}

export interface ExternalSpendDocumentDetail extends ExternalSpendDocument {
    lines: ExternalSpendLine[];
    extraction: ExternalSpendExtraction | null;
}

export interface Commitment {
    id: number;
    vendorName: string;
    commitmentType: CommitmentType;
    amount: number;
    currency: string;
    startDate: string;
    endDate: string;
    renewalDate: string | null;
    noticeDays: number;
    autoRenew: boolean;
    sourceDocumentId: number | null;
    createdBy: string | null;
    createdAt: string;
}

/** Gasto externo aprobado, en USD, por proveedor y mes. */
export interface ExternalSpendSummary {
    totalUsd: number;
    byVendor: Array<{ vendorName: string; totalUsd: number; documents: number }>;
    byMonth: Array<{ month: string; totalUsd: number }>;
    /** Aprobados en una moneda sin tasa: quedan fuera de la suma en USD. */
    unconverted: number;
}

/** Si la pantalla puede ofrecer la subida, y si no, por qué. */
export type ExternalSpendAiStatus = { allowed: true } | { allowed: false; reason: ExternalSpendErrorReason };

/** Lo que carga la pantalla de una vez. */
export interface ExternalSpendOverview {
    documents: ExternalSpendDocument[];
    commitments: Commitment[];
    summary: ExternalSpendSummary;
    ai: ExternalSpendAiStatus;
}
