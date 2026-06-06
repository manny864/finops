import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function getAIConfig() {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT setting_key, setting_value FROM GlobalSettings WHERE setting_key IN ("ai_provider", "ai_api_key")');
    const config: Record<string, string> = {};
    for (const row of rows) {
        config[row.setting_key] = row.setting_value;
    }
    return {
        provider: config['ai_provider'] || 'openai',
        apiKey: config['ai_api_key'] || ''
    };
}

export async function generateFinOpsReport(tenantId: string, metricsData: any) {
    const config = await getAIConfig();
    
    if (!config.apiKey) {
        throw new Error("AI API Key not configured. Please contact the Super Admin.");
    }

    let model;
    
    switch (config.provider) {
        case 'google':
            const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
            model = google('gemini-1.5-pro-latest');
            break;
        case 'anthropic':
            const anthropic = createAnthropic({ apiKey: config.apiKey });
            model = anthropic('claude-3-opus-20240229');
            break;
        case 'openai':
        default:
            const openai = createOpenAI({ apiKey: config.apiKey });
            model = openai('gpt-4o');
            break;
    }

    const systemPrompt = `You are an expert Azure FinOps Architect.
Analyze the provided JSON metrics and output a comprehensive Executive Summary in Markdown format.
Highlight key potential savings, unattached resources, anomalies, and overall cost trends.
Keep it professional, concise, and actionable. Do not use generic filler words. Provide concrete numbers where possible.`;

    const { text } = await generateText({
        model,
        system: systemPrompt,
        prompt: `Here are the latest metrics for the tenant:\n\n${JSON.stringify(metricsData, null, 2)}`
    });

    return text;
}
