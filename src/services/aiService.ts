import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import pool, { insertPlatformAiUsage } from '@/modules/storage/db';
import { RowDataPacket } from 'mysql2';
import { tryDecryptSecret } from '@/lib/secretCrypto';

/**
 * Interruptor maestro de plataforma (Configuración de IA Global →
 * "Habilitar funciones de IA"). Si está apagado, ningún tenant puede usar
 * IA sin importar su propio toggle — pensado para apagar la IA de todo el
 * SaaS de una sola vez (incidente con el proveedor, costos fuera de control, etc).
 */
export async function isAiGloballyEnabled(): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_value FROM GlobalSettings WHERE setting_key = 'ai_enabled' LIMIT 1`
    );
    return rows[0]?.setting_value !== 'false';
}

function getEnvKeyForProvider(provider: string): string {
    const p = (provider || '').toLowerCase();
    if (p === 'google' || p === 'gemini') {
        return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
    }
    if (p === 'openai' || p === 'chatgpt') {
        return process.env.OPENAI_API_KEY || '';
    }
    if (p === 'azure_openai' || p === 'azure_ai') {
        return process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_AI_API_KEY || '';
    }
    if (p === 'anthropic' || p === 'claude') {
        return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
    }
    if (p === 'deepseek') {
        return process.env.DEEPSEEK_API_KEY || '';
    }
    if (p === 'mistral') {
        return process.env.MISTRAL_API_KEY || '';
    }
    if (p === 'cohere') {
        return process.env.COHERE_API_KEY || '';
    }
    if (p === 'kimi' || p === 'moonshot') {
        return process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || '';
    }
    return '';
}

function getAnyEnvKey(): { provider: string; key: string } | null {
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
        return { provider: 'google', key: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' };
    }
    if (process.env.OPENAI_API_KEY) {
        return { provider: 'openai', key: process.env.OPENAI_API_KEY };
    }
    if (process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_AI_API_KEY) {
        return { provider: 'azure_openai', key: process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_AI_API_KEY || '' };
    }
    if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) {
        return { provider: 'anthropic', key: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '' };
    }
    if (process.env.DEEPSEEK_API_KEY) {
        return { provider: 'deepseek', key: process.env.DEEPSEEK_API_KEY };
    }
    if (process.env.MISTRAL_API_KEY) {
        return { provider: 'mistral', key: process.env.MISTRAL_API_KEY };
    }
    if (process.env.AI_API_KEY) {
        return { provider: 'google', key: process.env.AI_API_KEY };
    }
    return null;
}

export async function getAIConfig(tenantId?: string, forceEnterpriseTier?: boolean) {
    let tenantProvider: string | null = null;
    let tenantApiKey: string | null = null;
    let tenantAzureEndpoint = '';
    let tenantAzureDeployment = '';
    let tenantTier = 'Professional';

    if (tenantId) {
        try {
            const [tenantRows] = await pool.query<RowDataPacket[]>(
                'SELECT tier, ai_provider, ai_api_key, ai_endpoint, ai_deployment FROM Tenants WHERE tenant_id = ? LIMIT 1',
                [tenantId]
            );
            if (tenantRows.length > 0) {
                tenantTier = tenantRows[0].tier || 'Professional';
                if (tenantRows[0].ai_provider && tenantRows[0].ai_provider !== 'system') {
                    tenantProvider = tenantRows[0].ai_provider;
                    tenantApiKey = tryDecryptSecret(tenantRows[0].ai_api_key, `tenant ${tenantId} ai_api_key`);
                    if (!tenantApiKey) tenantProvider = null;
                    tenantAzureEndpoint = (tenantRows[0].ai_endpoint as string) || '';
                    tenantAzureDeployment = (tenantRows[0].ai_deployment as string) || '';
                }
            }
        } catch (dbErr) {
            console.warn(`[aiService] No se pudo leer config de tenant ${tenantId}:`, dbErr);
        }
    }

    const isEnterprise = tenantTier === 'Enterprise' || forceEnterpriseTier;

    let config: Record<string, string> = {};
    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT setting_key, setting_value FROM GlobalSettings WHERE setting_key IN ("ai_provider", "ai_api_key", "ai_endpoint", "ai_deployment", "enterprise_ai_provider", "enterprise_ai_api_key", "enterprise_ai_endpoint", "enterprise_ai_resource_name", "enterprise_ai_deployment")'
        );
        for (const row of rows) {
            config[row.setting_key] = row.setting_value;
        }
    } catch (dbErr) {
        console.warn('[aiService] No se pudieron leer GlobalSettings de IA:', dbErr);
    }

    const globalApiKey = tryDecryptSecret(config['ai_api_key'], 'global ai_api_key') || '';
    const enterpriseApiKey = tryDecryptSecret(config['enterprise_ai_api_key'], 'enterprise ai_api_key') || '';

    // Si el tenant tiene BYOK configurado con clave válida:
    if (tenantProvider && tenantApiKey) {
        return {
            provider: tenantProvider,
            apiKey: tenantApiKey,
            azureOpenAIEndpoint: tenantAzureEndpoint || config['ai_endpoint'] || process.env.AZURE_OPENAI_ENDPOINT || '',
            azureOpenAIResourceName: process.env.AZURE_OPENAI_RESOURCE_NAME || '',
            azureOpenAIDeployment: tenantAzureDeployment || config['ai_deployment'] || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
            source: 'byok' as const,
        };
    }

    // Resolución Global / Enterprise:
    let effectiveProvider: string;
    let effectiveApiKey: string = '';
    let effectiveEndpoint: string = '';
    let effectiveResourceName: string = '';
    let effectiveDeployment: string = '';

    if (isEnterprise && enterpriseApiKey) {
        effectiveProvider = config['enterprise_ai_provider'] || 'azure_openai';
        effectiveApiKey = enterpriseApiKey;
        effectiveEndpoint = config['enterprise_ai_endpoint'] || process.env.AZURE_OPENAI_ENDPOINT || '';
        effectiveResourceName = config['enterprise_ai_resource_name'] || process.env.AZURE_OPENAI_RESOURCE_NAME || '';
        effectiveDeployment = config['enterprise_ai_deployment'] || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
    } else if (globalApiKey) {
        effectiveProvider = config['ai_provider'] || 'google';
        effectiveApiKey = globalApiKey;
        effectiveEndpoint = config['ai_endpoint'] || process.env.AZURE_OPENAI_ENDPOINT || '';
        effectiveResourceName = process.env.AZURE_OPENAI_RESOURCE_NAME || '';
        effectiveDeployment = config['ai_deployment'] || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
    } else {
        // Fallback a variables de entorno (.env / App Settings)
        const chosenProvider = isEnterprise
            ? (config['enterprise_ai_provider'] || config['ai_provider'])
            : config['ai_provider'];
        
        const envKey = chosenProvider ? getEnvKeyForProvider(chosenProvider) : '';
        if (chosenProvider && envKey) {
            effectiveProvider = chosenProvider;
            effectiveApiKey = envKey;
        } else {
            // Si el proveedor elegido no tiene env key, buscar cualquier env key disponible en el sistema
            const anyEnv = getAnyEnvKey();
            if (anyEnv) {
                effectiveProvider = anyEnv.provider;
                effectiveApiKey = anyEnv.key;
            } else {
                effectiveProvider = chosenProvider || (isEnterprise ? 'azure_openai' : 'google');
                effectiveApiKey = '';
            }
        }
        effectiveEndpoint = (isEnterprise ? config['enterprise_ai_endpoint'] : config['ai_endpoint']) || process.env.AZURE_OPENAI_ENDPOINT || '';
        effectiveResourceName = (isEnterprise ? config['enterprise_ai_resource_name'] : '') || process.env.AZURE_OPENAI_RESOURCE_NAME || '';
        effectiveDeployment = (isEnterprise ? config['enterprise_ai_deployment'] : config['ai_deployment']) || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
    }

    return {
        provider: effectiveProvider,
        apiKey: effectiveApiKey,
        azureOpenAIEndpoint: effectiveEndpoint,
        azureOpenAIResourceName: effectiveResourceName,
        azureOpenAIDeployment: effectiveDeployment,
        source: 'platform' as const,
    };
}

export async function generateFinOpsReport(tenantId: string, metricsData: any, locale: string = 'es') {
    const config = await getAIConfig(tenantId);
    
    if (!config.apiKey) {
        throw new Error("AI API Key not configured. Please contact the Super Admin.");
    }

    let model;
    let modelName;

    switch (config.provider) {
        case 'google':
            const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
            // Reporte ejecutivo: usa el alias `gemini-pro-latest` para acceder al
            // modelo Pro más reciente disponible (free tier cuando aplica).
            modelName = 'gemini-pro-latest';
            model = google(modelName);
            break;
        case 'anthropic': {
            if (config.azureOpenAIEndpoint) {
                const { resolveAzureAiModel } = await import('@/modules/core/aiProvider');
                const resolved = resolveAzureAiModel(config);
                model = resolved.model;
                modelName = resolved.modelName;
                break;
            }
            const anthropic = createAnthropic({ apiKey: config.apiKey });
            modelName = config.azureOpenAIDeployment && config.azureOpenAIDeployment.toLowerCase().includes('claude')
                ? config.azureOpenAIDeployment
                : 'claude-sonnet-5';
            model = anthropic(modelName);
            break;
        }
        case 'azure_openai': {
            const { resolveAzureAiModel } = await import('@/modules/core/aiProvider');
            const resolved = resolveAzureAiModel(config);
            model = resolved.model;
            modelName = resolved.modelName;
            break;
        }
        case 'deepseek':
            const deepseek = createOpenAI({ apiKey: config.apiKey, baseURL: 'https://api.deepseek.com/v1' });
            // deepseek(...) sin .chat usa por defecto la Responses API de OpenAI
            // (/responses), que DeepSeek no implementa — 404 Not Found. DeepSeek
            // solo soporta Chat Completions (/chat/completions), hay que pedirlo explícito.
            modelName = 'deepseek-chat';
            model = deepseek.chat(modelName);
            break;
        case 'chatgpt':
            const chatgpt = createOpenAI({ apiKey: config.apiKey });
            modelName = 'gpt-4o';
            model = chatgpt(modelName);
            break;
        case 'kimi':
            const kimi = createOpenAI({ apiKey: config.apiKey, baseURL: 'https://api.moonshot.cn/v1' });
            modelName = 'moonshot-v1-8k';
            model = kimi.chat(modelName);
            break;
        case 'mistral':
            const { createMistral } = await import('@ai-sdk/mistral');
            const mistral = createMistral({ apiKey: config.apiKey });
            modelName = 'mistral-small-latest';
            model = mistral(modelName);
            break;
        case 'cohere':
            const { createCohere } = await import('@ai-sdk/cohere');
            const cohere = createCohere({ apiKey: config.apiKey });
            modelName = 'command-r-plus';
            model = cohere(modelName);
            break;
        case 'openai':
        default:
            const openai = createOpenAI({ apiKey: config.apiKey });
            modelName = 'gpt-4o';
            model = openai(modelName);
            break;
    }

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
- Redacta completamente en ${locale === 'es' ? 'Español' : locale === 'pt-BR' ? 'Portugués (Brasil)' : 'Inglés'} con tono ejecutivo, claro y accionable.`;

    // DLP (IA-5): metricsData sale hacia un proveedor externo. Este camino no
    // respetaba "Qué datos se comparten" — sólo lo hacía getAssessment.
    const { redactForTenant } = await import('@/modules/core/aiProvider');
    const redactedMetrics = await redactForTenant(tenantId, metricsData);

    const { text, usage } = await generateText({
        model: model as any,
        system: systemPrompt,
        prompt: `Here are the latest metrics for the tenant:\n\n${JSON.stringify(redactedMetrics, null, 2)}`
    });

    insertPlatformAiUsage({
        tenantId,
        source: config.source,
        provider: config.provider,
        modelName,
        feature: 'finops-report',
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
    });

    return text;
}
