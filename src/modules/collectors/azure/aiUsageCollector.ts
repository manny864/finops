import { MonitorClient } from "@azure/arm-monitor";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";

// Precios públicos aproximados de Azure OpenAI / Foundry (USD por 1K tokens).
// Se calibran con las tarifas oficiales de Microsoft Foundry y las métricas observadas.
export const PRICE_PER_1K: Record<string, { input: number; output: number }> = {
    // Modelos Azure AI Foundry (generación 5.x)
    "gpt-5.6-terra": { input: 0.001, output: 0.0036 },
    "gpt-5.3-codex": { input: 0.0014, output: 0.005 },
    "gpt-5.1": { input: 0.0025, output: 0.008 },
    "gpt-5": { input: 0.003, output: 0.01 },
    // Modelos Azure OpenAI clásicos
    "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
    "gpt-4o": { input: 0.005, output: 0.015 },
    "gpt-4-turbo": { input: 0.01, output: 0.03 },
    "gpt-4": { input: 0.03, output: 0.06 },
    "gpt-35-turbo": { input: 0.0005, output: 0.0015 },
    "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
    "text-embedding-3-large": { input: 0.00013, output: 0 },
    "text-embedding-3-small": { input: 0.00002, output: 0 },
    "text-embedding-ada-002": { input: 0.0001, output: 0 },
};
const DEFAULT_PRICE = { input: 0.0015, output: 0.005 };

export function estimateCost(modelName: string, inputTokens: number, outputTokens: number): number {
    const key = (modelName || "").toLowerCase().trim();
    // Coincidencia exacta o más específica primero
    const sortedKeys = Object.keys(PRICE_PER_1K).sort((a, b) => b.length - a.length);
    const matchedKey = sortedKeys.find((k) => key.includes(k));
    const price = matchedKey ? PRICE_PER_1K[matchedKey] : DEFAULT_PRICE;
    const cost = (inputTokens / 1000) * price.input + (outputTokens / 1000) * price.output;
    return Math.round(cost * 10000) / 10000;
}

export interface AIUsageRow {
    date: string; // YYYY-MM-DD (UTC)
    subscriptionId: string;
    resourceName: string;
    resourceGroup: string;
    modelName: string;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    billedCost: number;
}

const TOKEN_METRIC_NAMES = ["ProcessedPromptTokens", "GeneratedTokens", "TokenTransaction", "AzureOpenAIRequests", "TotalCalls"];

/**
 * Obtiene el uso de Azure OpenAI / Cognitive Services / Foundry para un rango histórico
 * de N días (por defecto 30 días) directamente desde Azure Monitor Metrics.
 */
export async function getHistoricalAIUsage(tenantId: string, days: number = 30, signal?: AbortSignal): Promise<AIUsageRow[]> {
    if (signal?.aborted) throw signal.reason;
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential).catch(() => []);
    if (subs.length === 0) return [];

    const argClient = new ResourceGraphClient(credential);
    const query = `
        Resources
        | where type =~ 'microsoft.cognitiveservices/accounts' or type =~ 'microsoft.ai.*'
        | project id, name, resourceGroup, subscriptionId, kind, type
    `;
    const resp = await argClient.resources({ query, subscriptions: subs }, { abortSignal: signal as never });
    const accounts = (resp.data as any[]) || [];
    if (accounts.length === 0) return [];

    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const timespan = `${startDate.toISOString()}/${now.toISOString()}`;

    const rows: AIUsageRow[] = [];

    for (const account of accounts) {
        if (signal?.aborted) throw signal.reason;
        try {
            const client = new MonitorClient(credential, account.subscriptionId);

            const fetchMetric = async (metricName: string, withFilter: boolean) => {
                try {
                    const opts: any = {
                        timespan,
                        interval: "P1D",
                        metricnames: metricName,
                        aggregation: "Total",
                        abortSignal: signal,
                    };
                    if (withFilter) opts.filter = "ModelDeploymentName eq '*'";
                    return await client.metrics.list(account.id, opts);
                } catch (error) {
                    if (signal?.aborted) throw error;
                    return null;
                }
            };

            const byDeploymentDay = new Map<string, { date: string; modelName: string; requests: number; input: number; output: number; inference: number }>();

            const ingestMetric = (metricName: string | undefined, metricValue: any) => {
                for (const ts of metricValue?.timeseries || []) {
                    const metadata = ts.metadatavalues || [];
                    const deployment =
                        metadata.find((m: any) => m.name?.value?.toLowerCase() === "modeldeploymentname")?.value ||
                        metadata.find((m: any) => m.name?.value?.toLowerCase() === "modelname")?.value ||
                        "unknown";
                    for (const point of ts.data || []) {
                        const total = point.total || 0;
                        if (!total) continue;
                        let pointDate = "";
                        const pTs = point.timeStamp;
                        if (pTs instanceof Date) {
                            pointDate = pTs.toISOString().substring(0, 10);
                        } else if (typeof pTs === "string") {
                            pointDate = pTs.substring(0, 10);
                        } else {
                            pointDate = String(pTs || "").substring(0, 10);
                        }
                        if (!pointDate || !pointDate.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
                        const key = `${deployment}::${pointDate}`;
                        const entry = byDeploymentDay.get(key) || {
                            date: pointDate,
                            modelName: deployment,
                            requests: 0,
                            input: 0,
                            output: 0,
                            inference: 0,
                        };
                        if (metricName === "ProcessedPromptTokens") entry.input += total;
                        else if (metricName === "GeneratedTokens" || metricName === "GeneratedCompletionTokens") entry.output += total;
                        else if (metricName === "AzureOpenAIRequests" || metricName === "TotalCalls") entry.requests += total;
                        else if (metricName === "TokenTransaction") entry.inference += total;
                        byDeploymentDay.set(key, entry);
                    }
                }
            };

            for (const metricName of TOKEN_METRIC_NAMES) {
                let metrics = await fetchMetric(metricName, true);
                let hasSeries = (metrics?.value || []).some((m: any) => (m.timeseries || []).length > 0);
                if (!hasSeries) {
                    metrics = await fetchMetric(metricName, false);
                    hasSeries = (metrics?.value || []).some((m: any) => (m.timeseries || []).length > 0);
                }
                if (!metrics) continue;
                for (const metric of metrics.value || []) {
                    ingestMetric(metric.name?.value, metric);
                }
            }

            for (const entry of byDeploymentDay.values()) {
                const inputTokens = entry.input > 0 || entry.output > 0 ? entry.input : entry.inference;
                const outputTokens = entry.output;
                if (inputTokens === 0 && outputTokens === 0 && entry.requests === 0) continue;
                rows.push({
                    date: entry.date,
                    subscriptionId: account.subscriptionId,
                    resourceName: account.name,
                    resourceGroup: account.resourceGroup,
                    modelName: entry.modelName,
                    requestCount: Math.round(entry.requests),
                    inputTokens: Math.round(inputTokens),
                    outputTokens: Math.round(outputTokens),
                    billedCost: estimateCost(entry.modelName, inputTokens, outputTokens),
                });
            }
        } catch (err: any) {
            console.warn(`[aiUsageCollector] Error fetching historical metrics for ${account.id}:`, err?.message);
        }
    }

    return rows;
}

/**
 * Uso real de Azure OpenAI / Cognitive Services para ayer + hoy.
 */
export async function getYesterdaysAIUsage(tenantId: string, signal?: AbortSignal): Promise<AIUsageRow[]> {
    return getHistoricalAIUsage(tenantId, 2, signal);
}
