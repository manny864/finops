import pool from '@/modules/storage/db';
import crypto from 'crypto';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { RowDataPacket } from 'mysql2';
import { getAIConfig } from '@/services/aiService';

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
        const config = await getAIConfig(tenantId);
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
                return azure('gpt-4o');
            }
            case 'anthropic': {
                const { createAnthropic } = await import('@ai-sdk/anthropic');
                const anthropic = createAnthropic({ apiKey: config.apiKey });
                return anthropic('claude-3-opus-20240229');
            }
            case 'deepseek': {
                const { createOpenAI } = await import('@ai-sdk/openai');
                const deepseek = createOpenAI({ apiKey: config.apiKey, baseURL: 'https://api.deepseek.com/v1' });
                return deepseek('deepseek-chat');
            }
            case 'google':
            default: {
                // Route to Gemini 2.5 Flash as default
                const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
                return google('gemini-2.5-flash');
            }
        }
    }
}

export async function getAssessment(metricsData: any): Promise<string> {
    const dataString = JSON.stringify(metricsData);
    const hashPrompt = crypto.createHash('sha256').update(dataString).digest('hex');

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

    // Call Gemini
    const model = await AIProviderFactory.getGeminiModel();
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
