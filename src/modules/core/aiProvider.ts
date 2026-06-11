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
    static async getGeminiModel() {
        const config = await getAIConfig();
        if (!config.apiKey) {
            throw new Error("AI API Key not configured.");
        }
        
        // Route to Gemini 2.5 Flash as requested
        const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
        return google('gemini-2.5-flash');
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
    const systemPrompt = `You are an expert Azure FinOps Architect.
Analyze the provided JSON metrics and output a comprehensive Executive Summary in Markdown format.
Highlight key potential savings, unattached resources, anomalies, and overall cost trends.
Keep it professional, concise, and actionable. Provide concrete numbers where possible.`;

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
