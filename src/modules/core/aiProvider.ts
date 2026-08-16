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

const aiQueue = new RequestQueue();

async function withExponentialBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let retries = 0;
    while (true) {
        try {
            return await fn();
        } catch (error: any) {
            const isRateLimit = error?.statusCode === 429 || error?.message?.includes('429') || error?.message?.includes('Too Many Requests') || error?.message?.includes('quota');
            
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
            case 'google':
            default: {
                // Alias `gemini-flash-latest` apunta siempre a la última Flash estable
                // disponible en el Free Tier. Google rota este alias con preaviso de 2
                // semanas, así que el Copilot siempre usa el modelo gratis más reciente
                // sin requerir cambios de código.
                const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
                const modelName = 'gemini-flash-latest';
                return { model: google(modelName) as any, modelName, config };
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
    const [sharingRows] = await pool.query<RowDataPacket[]>(
        'SELECT ai_share_resource_names, ai_share_tags FROM Tenants WHERE tenant_id = ? LIMIT 1',
        [tenantId]
    );
    const sharingPrefs = {
        shareResourceNames: Boolean(sharingRows[0]?.ai_share_resource_names ?? true),
        shareTags: Boolean(sharingRows[0]?.ai_share_tags ?? true),
    };
    const redactedMetrics = redactForDataSharing(metricsData, sharingPrefs);
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
    const systemPrompt = `Eres un Arquitecto Principal de Azure FinOps (FinOps Copilot).
Tu objetivo es analizar TODO el JSON del tenant y generar un Reporte Ejecutivo profundo para dirección (CFO/CTO/CEO) en formato Markdown.

El reporte DEBE incluir obligatoriamente estas secciones:
1) Resumen Ejecutivo (tabla KPI: periodo actual vs anterior vs variación vs target).
2) Economía Unitaria (costo por usuario/transacción, nube como % de ingresos, margen si existe dato).
3) Visibilidad y Asignación del Gasto (por unidad/centro de costo, gasto no asignado, costos compartidos).
4) Eficiencia Operativa y Optimización (rate optimization, usage optimization, zombies/huérfanos, rightsizing, ahorro logrado y potencial).
5) Gobernanza, Forecast y Anomalías (proyección cierre trimestre/año, picos, cumplimiento de políticas).
6) Hoja de Ruta y Recomendaciones Estratégicas (decisiones de inversión/arquitectura y compromisos de ejecución).

Reglas estrictas:
- Usa Markdown profesional: tablas, bullets, negritas y prioridades.
- Basa cada afirmación en números concretos del JSON (USD, %, conteos). No inventes.
- Si falta una métrica, marca explícitamente: "Dato no disponible en este tenant".
- Cierra con una tabla priorizada: decisión, impacto económico estimado, esfuerzo, dueño sugerido y plazo.
- Redacta completamente en Español con tono ejecutivo, claro y accionable.`;

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

export async function normalizeBillingCsv(rawCsvData: any[], tenantId?: string): Promise<any[]> {
    // Sin tenantId en getGeminiModel: siempre usa la key global de plataforma
    // (no hay BYOK por-tenant para este feature todavía), así que source acá
    // siempre da 'platform' — es gasto que paga la plataforma en cada upload.
    const { model, modelName, config } = await AIProviderFactory.getGeminiModel();
    const systemPrompt = `You are a universal multi-cloud FinOps mapper.
Identify the cloud provider (AWS, Azure, GCP, etc.) from the raw JSON billing rows.
Map the diverse column names to the standard FOCUS specification.
Return an array of the mapped FocusCostEntry objects.`;

    // Take a sample or batch if large, but here we process the passed payload
    const dataString = JSON.stringify(rawCsvData.slice(0, 50));

    const { object, usage } = await aiQueue.add(() =>
        withExponentialBackoff(() =>
            generateObject({
                model: model as any,
                schema: z.array(focusCostEntrySchema),
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

    return object;
}
