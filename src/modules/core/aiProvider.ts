import pool from '@/modules/storage/db';
import crypto from 'crypto';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { RowDataPacket } from 'mysql2';
import { getAIConfig } from '@/services/aiService';

// In-memory cache for AI config (provider + apiKey) por tenant.
// Reduce el round-trip a MySQL en cada request del Copilot.
type CachedConfig = { config: Awaited<ReturnType<typeof getAIConfig>>; expires: number };
const _configCache = new Map<string, CachedConfig>();
const CONFIG_TTL_MS = 5 * 60 * 1000;

async function getCachedAIConfig(tenantId?: string) {
    const key = tenantId || '__global__';
    const now = Date.now();
    const cached = _configCache.get(key);
    if (cached && cached.expires > now) return cached.config;
    const config = await getAIConfig(tenantId);
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

export class AIProviderFactory {
    static async getGeminiModel(tenantId?: string) {
        const config = await getCachedAIConfig(tenantId);
        if (!config.apiKey) {
            throw new Error("AI API Key not configured.");
        }
        
        switch (config.provider) {
            case 'openai': {
                const { createOpenAI } = await import('@ai-sdk/openai');
                const openai = createOpenAI({ apiKey: config.apiKey });
                return openai('gpt-4o');
            }
            case 'azure_openai': {
                const { createAzure } = await import('@ai-sdk/azure');
                const azure = createAzure({ apiKey: config.apiKey, resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME });
                // azure(...) sin .chat usa por defecto la Responses API, que requiere
                // una apiVersion reciente + deployment habilitado (muchos recursos no
                // lo tienen). .chat apunta al deployment de Chat Completions estándar
                // ('gpt-4o' acá es el nombre del deployment), el camino universal.
                return azure.chat('gpt-4o');
            }
            case 'anthropic': {
                const { createAnthropic } = await import('@ai-sdk/anthropic');
                const anthropic = createAnthropic({ apiKey: config.apiKey });
                // claude-3-opus-20240229 fue retirado por Anthropic (2026-01-05).
                // claude-sonnet-5 es el modelo Sonnet actual (calidad casi-Opus en
                // tareas de análisis a menor costo que Opus).
                return anthropic('claude-sonnet-5');
            }
            case 'deepseek': {
                const { createOpenAI } = await import('@ai-sdk/openai');
                const deepseek = createOpenAI({ apiKey: config.apiKey, baseURL: 'https://api.deepseek.com/v1' });
                // deepseek(...) sin .chat usa por defecto la Responses API de OpenAI
                // (/responses), que DeepSeek no implementa — 404 Not Found. DeepSeek
                // solo soporta Chat Completions (/chat/completions), hay que pedirlo explícito.
                return deepseek.chat('deepseek-chat');
            }
            case 'google':
            default: {
                // Alias `gemini-flash-latest` apunta siempre a la última Flash estable
                // disponible en el Free Tier. Google rota este alias con preaviso de 2
                // semanas, así que el Copilot siempre usa el modelo gratis más reciente
                // sin requerir cambios de código.
                const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
                return google('gemini-flash-latest');
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
    const model = await AIProviderFactory.getGeminiModel(tenantId);
    const systemPrompt = `Eres un Arquitecto Principal de Azure FinOps (FinOps Copilot).
Tu objetivo es analizar las métricas JSON proporcionadas y generar un Reporte Ejecutivo exhaustivo y altamente estructurado en formato Markdown.

El reporte DEBE contener obligatoriamente las siguientes secciones:
1. 📊 Resumen Ejecutivo (Impacto financiero general y tendencias de costos).
2. 💰 Oportunidades de Ahorro Inmediato (Identifica recursos huérfanos/zombies y cuantifica el dinero que se está desperdiciando).
3. 📉 Recomendaciones de Rightsizing (Menciona instancias específicas sobre-aprovisionadas y sugiere reducciones).
4. ⚠️ Alertas de Presupuesto y Anomalías (Detecta picos de gasto inusuales).
5. 🏷️ Estado de Gobernanza y Etiquetas (Analiza el cumplimiento de tagging, si los datos están disponibles).
6. 🚀 Plan de Acción a 30 días (3 pasos claros que el equipo de IT debe ejecutar hoy mismo).

Reglas estrictas:
- Usa formato Markdown profesional (tablas, listas, negritas).
- Mantén un tono ejecutivo, directo y procesable.
- NUNCA uses lenguaje genérico de relleno. Basa cada afirmación en los números concretos provistos en el JSON.
- Redacta el reporte completamente en Español.`;

    const { text } = await aiQueue.add(() => 
        withExponentialBackoff(() => 
            generateText({
                model,
                system: systemPrompt,
                prompt: `Here are the latest metrics for the tenant:\n\n${dataString}`
            })
        )
    );

    // Save to cache (REPLACE INTO overwrites if it exists but is expired)
    await pool.query(
        'REPLACE INTO AiCache (hash_prompt, response_text, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [hashPrompt, text]
    );

    return text;
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

export async function normalizeBillingCsv(rawCsvData: any[]): Promise<any[]> {
    const model = await AIProviderFactory.getGeminiModel();
    const systemPrompt = `You are a universal multi-cloud FinOps mapper. 
Identify the cloud provider (AWS, Azure, GCP, etc.) from the raw JSON billing rows.
Map the diverse column names to the standard FOCUS specification.
Return an array of the mapped FocusCostEntry objects.`;

    // Take a sample or batch if large, but here we process the passed payload
    const dataString = JSON.stringify(rawCsvData.slice(0, 50)); 

    const { object } = await aiQueue.add(() =>
        withExponentialBackoff(() =>
            generateObject({
                model,
                schema: z.array(focusCostEntrySchema),
                system: systemPrompt,
                prompt: `Map these billing records to FOCUS format:\n\n${dataString}`
            })
        )
    );

    return object;
}
