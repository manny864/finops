import { cognitiveServicesTokenProvider, hasAiManagedIdentity } from "@/lib/azureAiCredential";
import { EXTERNAL_SPEND_MAX_PAGES, type ExternalSpendDocType } from "@/types/externalSpend.types";

/**
 * Cliente REST mínimo de Azure AI Document Intelligence v4.0 (API
 * `2024-11-30`) para la ingesta de gasto externo. Con `fetch` y no con
 * `@azure-rest/ai-document-intelligence`: son dos llamadas (analizar y
 * consultar la operación) y no justifican una dependencia.
 *
 * Auth con Entra ID y la identidad administrada del stamp: la cuenta corre con
 * `local_auth_enabled = false`, así que no hay key.
 *
 * Contrato verificado en learn.microsoft.com (Document Models - Analyze
 * Document / Get Analyze Result, 2024-11-30): el POST responde 202 con
 * `Operation-Location`, y el GET a esa URL devuelve `status` (notStarted,
 * running, succeeded, failed, canceled, skipped) y `analyzeResult`.
 */
export const DI_API_VERSION = "2024-11-30";

/** Respaldo cuando el modelo específico falla (por ejemplo, un contrato que no está en inglés). */
export const DI_LAYOUT_MODEL = "prebuilt-layout";

export const diModelFor = (docType: ExternalSpendDocType): string =>
    docType === "contract" ? "prebuilt-contract" : "prebuilt-invoice";

/** La variable la pone Terraform; sin barra final para armar las URLs. */
function endpoint(): string | null {
    const raw = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim();
    return raw ? raw.replace(/\/+$/, "") : null;
}

/** Fuera de Azure (local, VPS) no hay identidad con la que autenticar. */
export const isDocumentIntelligenceConfigured = (): boolean => Boolean(endpoint()) && hasAiManagedIdentity();

export interface DiField {
    type?: string;
    content?: string;
    confidence?: number;
    valueString?: string;
    valueDate?: string;
    valueNumber?: number;
    valueInteger?: number;
    valueCurrency?: { amount?: number; currencyCode?: string; currencySymbol?: string };
    valueArray?: DiField[];
    valueObject?: Record<string, DiField>;
}

export interface DiAnalyzeResult {
    apiVersion?: string;
    modelId?: string;
    content?: string;
    pages?: unknown[];
    documents?: Array<{ docType?: string; confidence?: number; fields?: Record<string, DiField> }>;
}

export interface DiAnalyzeOperation {
    status: "notStarted" | "running" | "succeeded" | "failed" | "canceled" | "skipped";
    analyzeResult?: DiAnalyzeResult;
    error?: { code?: string; message?: string };
}

/** `retryable`: vale la pena volver a intentar en la próxima corrida del cron. */
export class DocumentIntelligenceError extends Error {
    readonly status: number;
    readonly retryable: boolean;
    constructor(message: string, status: number, retryable: boolean) {
        super(message);
        this.status = status;
        this.retryable = retryable;
    }
}

async function call(url: string, init: RequestInit): Promise<Response> {
    const token = await cognitiveServicesTokenProvider()();
    const res = await fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return res;
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const message = body?.error?.message || body?.error?.code || `HTTP ${res.status}`;
    throw new DocumentIntelligenceError(message.slice(0, 300), res.status, res.status === 429 || res.status >= 500);
}

/** Manda el archivo a analizar y devuelve la URL de la operación. */
export async function submitAnalyze(modelId: string, bytes: Buffer): Promise<string> {
    const base = endpoint();
    if (!base) throw new DocumentIntelligenceError("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT no está configurado.", 0, false);
    const url = `${base}/documentintelligence/documentModels/${modelId}:analyze?api-version=${DI_API_VERSION}&pages=1-${EXTERNAL_SPEND_MAX_PAGES}`;
    const res = await call(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Source: bytes.toString("base64") }),
    });
    const location = res.headers.get("operation-location");
    if (!location) throw new DocumentIntelligenceError("La respuesta no trae Operation-Location.", res.status, true);
    return location;
}

export async function getAnalyzeOperation(operationLocation: string): Promise<DiAnalyzeOperation> {
    // La URL sale de la base y lleva el token: sólo se consulta si apunta al
    // endpoint configurado.
    const base = endpoint();
    if (!base || new URL(operationLocation).origin !== new URL(base).origin) {
        throw new DocumentIntelligenceError("Operation-Location fuera del endpoint configurado.", 0, false);
    }
    const res = await call(operationLocation, { method: "GET" });
    return (await res.json()) as DiAnalyzeOperation;
}
