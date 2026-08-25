import pool, { insertPlatformAiUsage } from '@/modules/storage/db';
import crypto from 'crypto';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAzure } from '@ai-sdk/azure';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createMistral } from '@ai-sdk/mistral';
import { createCohere } from '@ai-sdk/cohere';
import { RowDataPacket } from 'mysql2';
import { getAIConfig } from '@/services/aiService';
import { errorMessage, errorStatus } from '@/lib/apiErrors';

// In-memory cache for AI config (provider + apiKey) por tenant.
// Reduce el round-trip a MySQL en cada request del Copilot.
type CachedConfig = { config: Awaited<ReturnType<typeof getAIConfig>>; expires: number };
const _configCache = new Map<string, CachedConfig>();
const CONFIG_TTL_MS = 5 * 60 * 1000;

async function getCachedAIConfig(tenantId?: string, forceEnterpriseTier?: boolean) {
    const key = (tenantId || '__global__') + (forceEnterpriseTier ? '_ent' : '');
    const now = Date.now();
    const cached = _configCache.get(key);
    if (cached && cached.expires > now) return cached.config;
    const config = await getAIConfig(tenantId, forceEnterpriseTier);
    _configCache.set(key, { config, expires: now + CONFIG_TTL_MS });
    return config;
}

export function invalidateAIConfigCache(tenantId?: string) {
    if (tenantId) _configCache.delete(tenantId);
    else _configCache.clear();
}

// Claves que identifican nombres de recurso / tags en los payloads que arma
// cada página del dashboard antes de mandarlos a generateFinOpsReport/
// getAssessment. No hay un schema único (cada página compone su propio
// metricsData), así que se redacta por nombre de clave en todo el árbol.
const RESOURCE_NAME_KEYS = new Set([
    'resourcename', 'resource_name', 'displayname', 'display_name',
    'resourcegroup', 'resource_group', 'subscriptionname', 'subscription_name',
    'vmname', 'vm_name', 'name',
]);
const TAG_KEYS = new Set(['tags', 'tag']);

interface DataSharingPrefs {
    shareResourceNames: boolean;
    shareTags: boolean;
}

/**
 * Redacta nombres de recursos y/o tags de un payload antes de mandarlo a un
 * proveedor de IA externo, según lo que el tenant eligió compartir en
 * Configuración de IA (ver IA-5 / docs/security/audit-2026-07-05.md). No
 * toca números, fechas ni el resto de las métricas — solo strings/objetos
 * bajo las claves de RESOURCE_NAME_KEYS / TAG_KEYS.
 */
export function redactForDataSharing<T>(data: T, prefs: DataSharingPrefs): T {
    if (prefs.shareResourceNames && prefs.shareTags) return data;

    const walk = (value: any): any => {
        if (Array.isArray(value)) return value.map(walk);
        if (value && typeof value === 'object') {
            const out: Record<string, any> = {};
            for (const [key, val] of Object.entries(value)) {
                const lowerKey = key.toLowerCase();
                if (!prefs.shareTags && TAG_KEYS.has(lowerKey) && val && typeof val === 'object') {
                    out[key] = { _redacted: true, tagCount: Object.keys(val as object).length };
                    continue;
                }
                if (!prefs.shareResourceNames && RESOURCE_NAME_KEYS.has(lowerKey) && typeof val === 'string') {
                    out[key] = '[REDACTED]';
                    continue;
                }
                out[key] = walk(val);
            }
            return out;
        }
        return value;
    };

    return walk(data);
}

/**
 * Lee las preferencias de compartición del tenant. Fail-closed: si la consulta
 * falla no se asume "compartir todo" — se devuelve el modo más restrictivo,
 * porque el costo de un error de DB no puede ser mandar PII a un proveedor
 * externo.
 */
export async function getDataSharingPrefs(tenantId: string): Promise<DataSharingPrefs> {
    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT ai_share_resource_names, ai_share_tags FROM Tenants WHERE tenant_id = ? LIMIT 1',
            [tenantId]
        );
        if (!rows[0]) return { shareResourceNames: true, shareTags: true };
        return {
            shareResourceNames: Boolean(rows[0].ai_share_resource_names ?? true),
            shareTags: Boolean(rows[0].ai_share_tags ?? true),
        };
    } catch (err) {
        // Se loguea el mensaje y no el Error: bajo jsdom un Error pasado a
        // console.error se convierte en un jsdomError que rompe los tests.
        console.error(
            `[aiProvider] No se pudieron leer las preferencias de compartición de ${tenantId}; se redacta todo: ${
                err instanceof Error ? err.message : String(err)
            }`
        );
        return { shareResourceNames: false, shareTags: false };
    }
}

/**
 * Redacta un payload según lo que el tenant eligió compartir. Es el punto único
 * que deben usar TODOS los caminos que mandan datos del tenant a un proveedor
 * de IA externo (assessment, copilot, reportes). Antes cada caller repetía la
 * query y el copilot directamente no la hacía, así que las preferencias se
 * guardaban pero no se aplicaban en ese camino.
 */
export async function redactForTenant<T>(tenantId: string, data: T): Promise<T> {
    const prefs = await getDataSharingPrefs(tenantId);
    return redactForDataSharing(data, prefs);
}

/**
 * Variante para payloads que ya llegan serializados (el copilot acepta un
 * string pre-compactado del cliente).
 *
 * Si el string no es JSON parseable no hay forma de redactar por clave, así que
 * **se descarta el contexto** en vez de mandarlo entero: el tenant pidió que
 * esos campos no salieran de la plataforma, y mandar texto libre sin poder
 * inspeccionarlo incumpliría exactamente eso. Cuando el tenant comparte todo,
 * el string pasa intacto y no se paga ningún parseo.
 */
export async function redactSerializedForTenant(
    tenantId: string,
    serialized: string
): Promise<{ payload: string; dropped: boolean }> {
    const prefs = await getDataSharingPrefs(tenantId);
    if (prefs.shareResourceNames && prefs.shareTags) return { payload: serialized, dropped: false };

    try {
        const parsed = JSON.parse(serialized);
        return { payload: JSON.stringify(redactForDataSharing(parsed, prefs)), dropped: false };
    } catch {
        return {
            payload: '{"_redacted":true,"_reason":"context omitted: tenant data-sharing preferences forbid sending un-inspectable payloads"}',
            dropped: true,
        };
    }
}

class RequestQueue {
    private queue: (() => Promise<void>)[] = [];
    private isProcessing = false;

    async add<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await task();
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            });
            this.process();
        });
    }

    private async process() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
                await task();
                // Enforce 4 seconds between AI requests to keep under 15 RPM
                await new Promise(r => setTimeout(r, 4000));
            }
        }
        this.isProcessing = false;
    }
}

export const aiQueue = new RequestQueue();

export async function withExponentialBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let retries = 0;
    while (true) {
        try {
            return await fn();
        } catch (error) {
            const isRateLimit = errorStatus(error) === 429 || errorMessage(error)?.includes('429') || errorMessage(error)?.includes('Too Many Requests') || errorMessage(error)?.includes('quota');
            
            if (isRateLimit && retries < maxRetries) {
                retries++;
                // 2s, 4s, 8s backoff
                const delayMs = Math.pow(2, retries) * 1000;
                console.warn(`[AI Rate Limit] 429 caught. Retrying in ${delayMs}ms (Attempt ${retries}/${maxRetries})...`);
                await new Promise(r => setTimeout(r, delayMs));
            } else {
                throw error;
            }
        }
    }
}

export function extractAiErrorMessage(error: any): string {
    if (!error) return "Error desconocido";
    if (typeof error === "string") return error;

    // Extraer detalle JSON del response body si existe (Azure AI / Anthropic / OpenAI)
    if (error.responseBody) {
        try {
            const parsed = typeof error.responseBody === 'string' ? JSON.parse(error.responseBody) : error.responseBody;
            if (parsed.error?.message) return parsed.error.message;
            if (parsed.message) return parsed.message;
            if (parsed.detail) return parsed.detail;
            return typeof error.responseBody === 'string' ? error.responseBody : JSON.stringify(parsed);
        } catch {
            return String(error.responseBody);
        }
    }

    if (error.data?.error?.message) return error.data.error.message;
    if (error.data?.message) return error.data.message;
    if (error.cause?.message && error.cause.message !== error.message) {
        return `${error.message}: ${error.cause.message}`;
    }

    return error.message || String(error);
}

export function resolveAzureAiModel(config: {
    apiKey: string;
    azureOpenAIEndpoint?: string;
    azureOpenAIResourceName?: string;
    azureOpenAIDeployment?: string;
    provider?: string;
}) {
    const rawDeployment = (config.azureOpenAIDeployment || '').trim();
    const deployment = rawDeployment || 'gpt-4o';
    const rawEndpoint = (config.azureOpenAIEndpoint || '').trim();

    // 1. Anthropic Claude en Azure AI Foundry / Azure AI Services
    const isAnthropicOnAzure = 
        rawEndpoint.toLowerCase().includes('/anthropic') || 
        (rawEndpoint.toLowerCase().includes('.services.ai.azure.com') && rawDeployment.toLowerCase().includes('claude')) ||
        (config.provider === 'anthropic' && rawEndpoint.length > 0);

    if (isAnthropicOnAzure && rawEndpoint) {
        let baseURL = rawEndpoint
            .replace(/\/messages\/?$/i, '')
            .replace(/\/+$/, '');
        
        // Azure AI Foundry Anthropic Messages API expone en /anthropic/v1
        if (!baseURL.toLowerCase().includes('/anthropic')) {
            baseURL = `${baseURL}/anthropic`;
        }
        if (!baseURL.toLowerCase().endsWith('/v1')) {
            baseURL = `${baseURL}/v1`;
        }

        // Si el usuario configuró un deployment específico (ej. claude-3-5-sonnet-20241022 o su propio nombre de deployment),
        // usarlo; si está vacío o venía con el default "gpt-4o", usar el identificador oficial de Azure AI
        let modelName = 'claude-3-5-sonnet-20241022';
        if (rawDeployment && !rawDeployment.toLowerCase().startsWith('gpt-')) {
            modelName = rawDeployment;
        }

        const anthropic = createAnthropic({
            apiKey: config.apiKey,
            baseURL,
            headers: {
                'api-key': config.apiKey,
                'x-api-key': config.apiKey,
            },
        });

        return {
            model: anthropic(modelName) as any,
            modelName,
        };
    }

    // 2. Azure AI Foundry Model Catalog / Serverless / OpenAI Compatible
    if (rawEndpoint) {
        let normalized = rawEndpoint
            .replace(/\/responses\/?$/i, '')
            .replace(/\/chat\/completions\/?$/i, '')
            .replace(/\/+$/, '');

        // Si es un endpoint raíz de services.ai.azure.com sin path, mapear a /models
        if (normalized.includes('.services.ai.azure.com') && !normalized.includes('/models') && !normalized.includes('/openai') && !normalized.includes('/anthropic')) {
            normalized = `${normalized}/models`;
        }

        // Es fundamental usar .chat(deployment) para que el AI SDK invoque Chat Completions
        // (/chat/completions) y no el Responses API (/responses) que Azure AI rechaza con NotSupported
        const customOpenAi = createOpenAI({
            apiKey: config.apiKey,
            baseURL: normalized,
            headers: {
                'api-key': config.apiKey,
                'Authorization': `Bearer ${config.apiKey}`
            }
        });

        return {
            model: customOpenAi.chat(deployment) as any,
            modelName: deployment,
        };
    }

    // 3. Azure OpenAI Resource Name estándar
    if (config.azureOpenAIResourceName) {
        const azure = createAzure({ apiKey: config.apiKey, resourceName: config.azureOpenAIResourceName });
        return {
            model: azure.chat(deployment) as any,
            modelName: deployment,
        };
    }

    throw new Error("Azure AI / Azure OpenAI no configurado: faltan Endpoint URL o Resource Name.");
}

export class AIProviderFactory {
    /** Devuelve también `config` (incluye `source`: 'byok'|'platform') y `modelName`, para que el caller pueda loggear PlatformAiUsage sin reimplementar el switch. */
    static async getGeminiModel(
        tenantId?: string,
        forceEnterpriseTier?: boolean,
        overrideConfig?: {
            provider: string;
            apiKey: string;
            source: 'byok' | 'platform';
            azureOpenAIEndpoint?: string;
            azureOpenAIResourceName?: string;
            azureOpenAIDeployment?: string;
        }
    ) {
        const config = overrideConfig || await getCachedAIConfig(tenantId, forceEnterpriseTier);
        if (!config.apiKey) {
            throw new Error("AI API Key not configured.");
        }

        switch (config.provider) {
            case 'openai': {
                const openai = createOpenAI({ apiKey: config.apiKey });
                const modelName = 'gpt-4o';
                return { model: openai(modelName) as any, modelName, config };
            }
            case 'azure_openai': {
                const { model, modelName } = resolveAzureAiModel(config);
                return { model, modelName, config };
            }
            case 'anthropic': {
                if (config.azureOpenAIEndpoint) {
                    const { model, modelName } = resolveAzureAiModel(config);
                    return { model, modelName, config };
                }
                const anthropic = createAnthropic({ apiKey: config.apiKey });
                const modelName = config.azureOpenAIDeployment && config.azureOpenAIDeployment.toLowerCase().includes('claude')
                    ? config.azureOpenAIDeployment
                    : 'claude-sonnet-5';
                return { model: anthropic(modelName) as any, modelName, config };
            }
            case 'deepseek': {
                const deepseek = createOpenAI({ apiKey: config.apiKey, baseURL: 'https://api.deepseek.com/v1' });
                // deepseek(...) sin .chat usa por defecto la Responses API de OpenAI
                // (/responses), que DeepSeek no implementa — 404 Not Found. DeepSeek
                // solo soporta Chat Completions (/chat/completions), hay que pedirlo explícito.
                const modelName = 'deepseek-chat';
                return { model: deepseek.chat(modelName) as any, modelName, config };
            }
            case 'chatgpt': {
                const openai = createOpenAI({ apiKey: config.apiKey });
                const modelName = 'gpt-4o';
                return { model: openai(modelName) as any, modelName, config };
            }
            case 'kimi': {
                const kimi = createOpenAI({ apiKey: config.apiKey, baseURL: 'https://api.moonshot.cn/v1' });
                const modelName = 'moonshot-v1-8k';
                return { model: kimi.chat(modelName) as any, modelName, config };
            }
            case 'mistral': {
                const mistral = createMistral({ apiKey: config.apiKey });
                const modelName = 'mistral-small-latest';
                return { model: mistral(modelName) as any, modelName, config };
            }
            case 'cohere': {
                const cohere = createCohere({ apiKey: config.apiKey });
                const modelName = 'command-r-plus';
                return { model: cohere(modelName) as any, modelName, config };
            }
            case 'google': {
                const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
                const modelName = 'gemini-flash-latest';
                return { model: google(modelName) as any, modelName, config };
            }
            default: {
                if (config.azureOpenAIEndpoint || config.provider === 'azure_openai') {
                    const { model, modelName } = resolveAzureAiModel(config);
                    return { model, modelName, config };
                }
                const openai = createOpenAI({ apiKey: config.apiKey });
                const modelName = 'gpt-4o';
                return { model: openai(modelName) as any, modelName, config };
            }
        }
    }
}

export async function getAssessment(metricsData: any, tenantId: string): Promise<string> {
    if (!tenantId) {
        // Aislamiento multi-tenant obligatorio: sin tenantId el caché podría
        // cruzar reportes entre tenants (IA-1) y la key resuelta sería la global.
        throw new Error("getAssessment requires a tenantId for cache/config isolation.");
    }
    // DLP (IA-5): metricsData se envía a un proveedor de IA EXTERNO. Puede
    // contener nombres de recursos y tags con potencial PII. El tenant elige
    // en Configuración de IA ("Qué datos se comparten") si esos campos van
    // redactados antes del envío — ver redactForDataSharing. Ver
    // docs/security/audit-2026-07-05.md.
    const redactedMetrics = await redactForTenant(tenantId, metricsData);
    const dataString = JSON.stringify(redactedMetrics);
    // El hash incluye el tenantId para que dos tenants con el mismo payload
    // NO compartan la misma entrada de caché (fuga cross-tenant IA-1).
    const hashPrompt = crypto.createHash('sha256').update(`${tenantId}:${dataString}`).digest('hex');

    // Query Cache
    const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT response_text, created_at FROM AiCache WHERE hash_prompt = ?',
        [hashPrompt]
    );

    if (rows.length > 0) {
        const cachedRow = rows[0];
        const createdAt = new Date(cachedRow.created_at).getTime();
        const now = Date.now();
        const hours24 = 24 * 60 * 60 * 1000;

        if (now - createdAt < hours24) {
            console.log(`[AI Cache] Hit for hash ${hashPrompt}`);
            return cachedRow.response_text;
        }
    }

    console.log(`[AI Cache] Miss for hash ${hashPrompt}. Calling Gemini...`);

    // Call Gemini — usa la config/key del tenant (no la global) para respetar
    // el aislamiento por tenant y la key configurada por cada cliente (IA-1).
    const { model, modelName, config } = await AIProviderFactory.getGeminiModel(tenantId);
    const systemPrompt = `Eres el Arquitecto Principal de Azure FinOps y Asesor Estratégico Cloud (FinOps Copilot) de la plataforma SaaS de CSCloudSolutions.
Tu objetivo es analizar el JSON del tenant y redactar un Reporte Ejecutivo Estratégico C-Level (dirigido a CFO, CTO, CEO y Líderes de Infraestructura) en Markdown estructurado con 6 secciones obligatorias:

## 1. Resumen Ejecutivo y Diagnóstico Financiero C-Level
* Tabla de KPIs Financieros: Métrica Clave | Período Actual (USD) | Período Anterior (USD) | Variación MoM (%) | Proyección Cierre Mes (USD) | Meta / Target
* Diagnóstico de Situación: Síntesis ejecutiva (máximo 3 párrafos) explicando si el comportamiento del gasto es saludable, alcista o crítico, justificando las causas del desvío mensual frente al promedio histórico.

## 2. Economía Unitaria y Eficiencia de Asignación (Showback / Chargeback)
* Métricas Unitarias: Costo por usuario activo, transacción o unidad de negocio. Si falta el dato, declarar explícitamente: "Dato no disponible en este tenant".
* Higiene de Asignación: Porcentaje de gasto etiquetado vs. no asignado (Tagging Coverage) y su impacto financiero.

## 3. Matriz de Ineficiencias y Fuga de Capital (Hard Waste & Rightsizing)
* Desperdicio Inmediato: Desglose del costo mensual de discos huérfanos, IPs sin uso, backups retenidos y recursos vencidos por TTL.
* Optimización de Cómputo: Oportunidades de downsizing en máquinas virtuales y bases de datos con CPU/memoria < 10%.
* Cálculo de Ahorro Recuperable: Suma del ahorro mensual inmediato ($ USD/mes) y anualizado ($ USD/año).

## 4. Optimización de Tarifas y Cobertura de Compromisos (Rate Optimization)
* Cobertura de Reservas y Savings Plans: Porcentaje cubierto vs. exposición a tarifa bajo demanda (Pay-As-You-Go).
* Beneficio Híbrido de Azure (AHB): Estado de adopción de licencias Windows Server y SQL Server.

## 5. Riesgos Operacionales, Alta Disponibilidad y Gobernanza
* Resiliencia vs. Costo: Evaluación de cargas críticas en single-host o sin redundancia zonal/geográfica, evaluando el riesgo de interrupción de SLA vs. el costo de remediación.
* Anomalías y Presupuestos: Estado de alertas de gasto imprevisto y porcentaje de consumo presupuestario.
* Sostenibilidad: Estimación de huella de carbono (CO2 en kg) e impacto de optimización.

## 6. Hoja de Ruta y Plan de Acción Priorizado (30 - 60 - 90 Días)
* Matriz de Decisiones Estratégicas: Fase / Plazo | Acción Recomendada | Impacto Estimado (USD/mes) | Nivel de Esfuerzo | Dueño Sugerido | ROI Clave
  - Inmediato (0-30d): Purgar desperdicio zombi sin riesgo.
  - Medio Plazo (30-60d): Rightsizing y políticas TTL.
  - Estratégico (60-90d): Commitments RIs/SPs y arquitectura HA.

Reglas estrictas:
1. Cero Alucinación: Basa cada afirmación en números concretos del JSON. Si falta algún dato, declara "Dato no disponible en este tenant".
2. Moneda y Formato: Todo en USD con formato estándar ($X,XXX.XX USD).
3. Tono: Ejecutivo, analítico y orientado a la toma de decisiones. Redacta en Español formal.`;

    const { text, usage } = await aiQueue.add(() =>
        withExponentialBackoff(() =>
            generateText({
                model: model as any,
                system: systemPrompt,
                prompt: `Here are the latest metrics for the tenant:\n\n${dataString}`
            })
        )
    );

    insertPlatformAiUsage({
        tenantId,
        source: config.source,
        provider: config.provider,
        modelName,
        feature: 'assessment',
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
    });

    // Save to cache (REPLACE INTO overwrites if it exists but is expired)
    await pool.query(
        'REPLACE INTO AiCache (hash_prompt, response_text, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [hashPrompt, text]
    );

    return text;
}

export async function generateExecutiveReportEmailIntro(params: {
    tenantId: string;
    tenantName: string;
    scopeSubscriptionName: string;
    reportMarkdown: string;
}): Promise<string> {
    const { tenantId, tenantName, scopeSubscriptionName, reportMarkdown } = params;
    if (!tenantId) throw new Error("tenantId is required");

    const { model, modelName, config } = await AIProviderFactory.getGeminiModel(tenantId);
    const reportSample = reportMarkdown.slice(0, 6000);

    const { text, usage } = await aiQueue.add(() =>
        withExponentialBackoff(() =>
            generateText({
                model: model as any,
                system: `Eres un asistente FinOps de CSCloudSolutions.
Tu tarea es redactar un mensaje breve, amistoso y profesional para el cuerpo de un correo que entrega un reporte ejecutivo.
Reglas:
- Español neutro.
- 2 o 3 frases, máximo 70 palabras.
- Menciona que el reporte fue generado con IA y que se adjunta en PDF/HTML.
- No uses listas, títulos ni markdown.`,
                prompt: `Tenant: ${tenantName}
Alcance: ${scopeSubscriptionName}
Extracto del reporte:
${reportSample}`,
            })
        )
    );

    insertPlatformAiUsage({
        tenantId,
        source: config.source,
        provider: config.provider,
        modelName,
        feature: "executive-report-email-intro",
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
    });

    return text.replace(/\s+/g, " ").trim();
}

export const focusCostEntrySchema = z.object({
    ProviderName: z.string().describe("E.g., Azure, AWS, GCP"),
    SubAccountId: z.string().describe("E.g., Subscription ID or AWS Account ID"),
    ServiceName: z.string(),
    ChargeCategory: z.string(),
    UsageDate: z.string(),
    BilledCost: z.number(),
    EffectiveCost: z.number()
});

/** Campos que definen el schema destino; si el CSV ya los trae, no hace falta IA. */
const FOCUS_REQUIRED_COLUMNS = ['BilledCost', 'EffectiveCost', 'ChargeCategory', 'ProviderName', 'ServiceName'];

function num(value: unknown): number {
    const n = Number(String(value ?? '').trim());
    return Number.isFinite(n) ? n : 0;
}

/** Primera fecha utilizable de la fila, en YYYY-MM-DD. */
function focusDate(row: Record<string, unknown>): string {
    for (const key of ['ChargePeriodStart', 'UsageDate', 'BillingPeriodStart']) {
        const raw = String(row[key] ?? '').trim();
        if (raw) return raw.slice(0, 10);
    }
    return '';
}

/**
 * Un CSV que ya viene en FOCUS no necesita que un modelo adivine el mapeo: las
 * columnas SON el estándar destino.
 *
 * Mandarlo igual a la IA costaba ~16k tokens y 40 s por archivo, procesaba sólo
 * las primeras 50 filas de 256 y podía fallar por schema, deployment o 429. El
 * atajo determinista es instantáneo, gratis, cubre el archivo completo y no
 * puede fallar. La IA queda para lo que realmente la necesita: exports con
 * columnas propias de cada proveedor.
 */
export function isAlreadyFocusFormat(rawCsvData: any[]): boolean {
    const first = rawCsvData?.[0];
    if (!first || typeof first !== 'object') return false;
    const columns = new Set(Object.keys(first));
    return FOCUS_REQUIRED_COLUMNS.every((c) => columns.has(c));
}

export function mapNativeFocusRows(rawCsvData: any[]): any[] {
    return rawCsvData.map((row) => ({
        ProviderName: String(row.ProviderName ?? '').trim() || 'Unknown',
        SubAccountId: String(row.SubAccountId ?? row.BillingAccountId ?? '').trim(),
        ServiceName: String(row.ServiceName ?? '').trim() || 'Unknown',
        ChargeCategory: String(row.ChargeCategory ?? '').trim() || 'Usage',
        UsageDate: focusDate(row),
        BilledCost: num(row.BilledCost),
        // Si EffectiveCost viene vacío se cae a BilledCost: dejarlo en 0
        // subestimaría el gasto amortizado en el resumen.
        EffectiveCost: row.EffectiveCost === '' || row.EffectiveCost == null
            ? num(row.BilledCost)
            : num(row.EffectiveCost),
    }));
}

export async function normalizeBillingCsv(rawCsvData: any[], tenantId?: string): Promise<any[]> {
    // Atajo: si ya es FOCUS, se mapea sin IA (ver isAlreadyFocusFormat).
    if (isAlreadyFocusFormat(rawCsvData)) {
        console.log(`[normalizeBillingCsv] CSV ya en formato FOCUS: ${rawCsvData.length} filas mapeadas sin IA.`);
        return mapNativeFocusRows(rawCsvData);
    }

    // Usa la configuración de IA DEL TENANT (BYOK) y cae a la global sólo si el
    // tenant no tiene la suya, igual que el resto de los caminos de IA.
    //
    // Antes llamaba a getGeminiModel() sin tenantId y forzaba la key global.
    // Con una config global apuntando a un deployment inexistente, la ingesta
    // de CSV devolvía 404 DeploymentNotFound -> 500 "Internal server error
    // processing CSV", aunque el tenant tuviera un proveedor válido cargado.
    // Además hacía que el upload lo pagara siempre la plataforma.
    const { model, modelName, config } = await AIProviderFactory.getGeminiModel(tenantId);
    const systemPrompt = `You are a universal multi-cloud FinOps mapper.
Identify the cloud provider (AWS, Azure, GCP, etc.) from the raw JSON billing rows.
Map the diverse column names to the standard FOCUS specification.
Return an array of the mapped FocusCostEntry objects.`;

    // DLP (IA-5): el CSV lleva nombres de recursos y sale hacia el proveedor de
    // IA. Este camino tampoco aplicaba las preferencias del tenant. Se redacta
    // por clave, que no afecta al mapeo: lo que se infiere son los NOMBRES DE
    // COLUMNA, no los valores.
    const sample = tenantId
        ? await redactForTenant(tenantId, rawCsvData.slice(0, 50))
        : rawCsvData.slice(0, 50);
    const dataString = JSON.stringify(sample);

    // El schema raíz va envuelto en un objeto y no como z.array(...).
    // Structured outputs de OpenAI/Azure OpenAI rechaza un array en la raíz:
    // "schema must be a JSON Schema of type object, got type array" (400).
    // Se desenvuelve abajo para conservar el contrato de la función.
    const { object, usage } = await aiQueue.add(() =>
        withExponentialBackoff(() =>
            generateObject({
                model: model as any,
                schema: z.object({ entries: z.array(focusCostEntrySchema) }),
                system: systemPrompt,
                prompt: `Map these billing records to FOCUS format:\n\n${dataString}`
            })
        )
    );

    insertPlatformAiUsage({
        tenantId,
        source: config.source,
        provider: config.provider,
        modelName,
        feature: 'billing-csv-normalize',
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
    });

    return object.entries ?? [];
}
