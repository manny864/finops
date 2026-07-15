import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import pool from '@/modules/storage/db';
import { RowDataPacket } from 'mysql2';
import { decryptSecret } from '@/lib/secretCrypto';

export async function getAIConfig(tenantId?: string) {
    let tenantProvider = null;
    let tenantApiKey = null;

    if (tenantId) {
        const [tenantRows] = await pool.query<RowDataPacket[]>('SELECT ai_provider, ai_api_key FROM Tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
        if (tenantRows.length > 0 && tenantRows[0].ai_provider && tenantRows[0].ai_provider !== 'system') {
            tenantProvider = tenantRows[0].ai_provider;
            // Descifra la key almacenada (IA-2). decryptSecret devuelve el valor
            // tal cual si es plaintext legacy (sin prefijo enc:v1:).
            tenantApiKey = decryptSecret(tenantRows[0].ai_api_key);
        }
    }

    const [rows] = await pool.query<RowDataPacket[]>('SELECT setting_key, setting_value FROM GlobalSettings WHERE setting_key IN ("ai_provider", "ai_api_key")');
    const config: Record<string, string> = {};
    for (const row of rows) {
        config[row.setting_key] = row.setting_value;
    }
    // La key global también puede estar cifrada (o plaintext legacy).
    const globalApiKey = config['ai_api_key'] ? decryptSecret(config['ai_api_key']) : '';

    return {
        provider: tenantProvider || config['ai_provider'] || process.env.AI_PROVIDER || 'google',
        apiKey: tenantApiKey || globalApiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY || ''
    };
}

export async function generateFinOpsReport(tenantId: string, metricsData: any, locale: string = 'es') {
    const config = await getAIConfig(tenantId);
    
    if (!config.apiKey) {
        throw new Error("AI API Key not configured. Please contact the Super Admin.");
    }

    let model;
    
    switch (config.provider) {
        case 'google':
            const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
            // Reporte ejecutivo: usa el alias `gemini-pro-latest` para acceder al
            // modelo Pro más reciente disponible (free tier cuando aplica).
            model = google('gemini-pro-latest');
            break;
        case 'anthropic':
            const anthropic = createAnthropic({ apiKey: config.apiKey });
            // claude-3-opus-20240229 fue retirado por Anthropic (2026-01-05) y
            // ahora da 404. claude-opus-4-8 es el reemplazo directo (tier Opus).
            model = anthropic('claude-opus-4-8');
            break;
        case 'azure_openai':
            const azure = createAzure({ apiKey: config.apiKey, resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME });
            // azure(...) sin .chat usa por defecto la Responses API, que requiere
            // una apiVersion reciente + deployment habilitado (muchos recursos no
            // lo tienen). .chat apunta al deployment de Chat Completions estándar
            // ('gpt-4o' acá es el nombre del deployment), el camino universal.
            model = azure.chat('gpt-4o');
            break;
        case 'deepseek':
            const deepseek = createOpenAI({ apiKey: config.apiKey, baseURL: 'https://api.deepseek.com/v1' });
            // deepseek(...) sin .chat usa por defecto la Responses API de OpenAI
            // (/responses), que DeepSeek no implementa — 404 Not Found. DeepSeek
            // solo soporta Chat Completions (/chat/completions), hay que pedirlo explícito.
            model = deepseek.chat('deepseek-chat');
            break;
        case 'openai':
        default:
            const openai = createOpenAI({ apiKey: config.apiKey });
            model = openai('gpt-4o');
            break;
    }

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
- Redacta el reporte completamente en ${locale === 'es' ? 'Español' : locale === 'pt-BR' ? 'Portugués (Brasil)' : 'Inglés'}.`;

    const { text } = await generateText({
        model,
        system: systemPrompt,
        prompt: `Here are the latest metrics for the tenant:\n\n${JSON.stringify(metricsData, null, 2)}`
    });

    return text;
}
