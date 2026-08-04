import { MonitorClient } from "@azure/arm-monitor";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";

// Precios públicos aproximados de Azure OpenAI (USD por 1K tokens). Cost
// Management no reporta costo por modelo/deployment (solo por servicio), así
// que esto es una ESTIMACIÓN para poder mostrar $ junto a los tokens reales
// en AI Cost Analytics — no es el billing exacto. Actualizar si cambia el
// pricing público de Microsoft.
const PRICE_PER_1K: Record<string, { input: number; output: number }> = {
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
const DEFAULT_PRICE = { input: 0.01, output: 0.03 };

function estimateCost(modelName: string, inputTokens: number, outputTokens: number): number {
    const key = (modelName || "").toLowerCase();
    const match = Object.entries(PRICE_PER_1K).find(([k]) => key.includes(k));
    const price = match ? match[1] : DEFAULT_PRICE;
    return (inputTokens / 1000) * price.input + (outputTokens / 1000) * price.output;
}

export interface AIUsageRow {
    subscriptionId: string;
    resourceName: string;
    resourceGroup: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    billedCost: number;
}

/**
 * Uso real de Azure OpenAI / Cognitive Services del día anterior, por
 * deployment (modelo). Fuente: Azure Monitor Metrics de cada cuenta
 * `Microsoft.CognitiveServices/accounts` (métricas ProcessedPromptTokens /
 * GeneratedTokens, segmentadas por la dimensión ModelDeploymentName). Usa el
 * rol "Monitoring Reader" que el Service Principal ya tiene asignado (mismo
 * rol que usa Rightsizing para métricas de VM).
 *
 * El costo ($) que devuelve es una ESTIMACIÓN por pricing público (ver
 * PRICE_PER_1K arriba) — no reemplaza el costo real ya sincronizado en
 * CostSnapshots vía Cost Management, que sigue siendo la fuente de verdad
 * para el KPI "Total Cost" cuando esta colección no tiene datos.
 */
export async function getYesterdaysAIUsage(tenantId: string): Promise<AIUsageRow[]> {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return [];

    const argClient = new ResourceGraphClient(credential);
    const query = `
        Resources
        | where type =~ 'microsoft.cognitiveservices/accounts'
        | project id, name, resourceGroup, subscriptionId
    `;
    const resp = await argClient.resources({ query, subscriptions: subs });
    const accounts = (resp.data as any[]) || [];
    if (accounts.length === 0) return [];

    const now = new Date();
    const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayStart = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000);
    const timespan = `${dayStart.toISOString()}/${dayEnd.toISOString()}`;

    const rows: AIUsageRow[] = [];

    for (const account of accounts) {
        try {
            const client = new MonitorClient(credential, account.subscriptionId);
            const metricnames = "ProcessedPromptTokens,GeneratedTokens,ProcessedInferenceTokens";
            let metrics = await client.metrics.list(account.id, {
                timespan,
                interval: "P1D",
                metricnames,
                aggregation: "Total",
                // Escenario estándar de Azure OpenAI: serie separada por deployment.
                filter: "ModelDeploymentName eq '*'",
            });

            // En algunos recursos de Microsoft Foundry no siempre se expone
            // ModelDeploymentName en todas las series. Si no vuelve ninguna serie,
            // reintentamos sin filtro y usamos ModelName cuando exista.
            const hasSeries = (metrics.value || []).some((m) => (m.timeseries || []).length > 0);
            if (!hasSeries) {
                metrics = await client.metrics.list(account.id, {
                    timespan,
                    interval: "P1D",
                    metricnames,
                    aggregation: "Total",
                });
            }

            // Cada metric (Prompt/Generated) trae una timeserie por deployment
            // (dimensión ModelDeploymentName) — se acumulan juntas por nombre.
            const byDeployment = new Map<string, { input: number; output: number; inference: number }>();
            for (const metric of metrics.value || []) {
                const metricName = metric.name?.value;
                for (const ts of metric.timeseries || []) {
                    const metadata = ts.metadatavalues || [];
                    const deployment =
                        metadata.find((m: any) => m.name?.value?.toLowerCase() === "modeldeploymentname")?.value ||
                        metadata.find((m: any) => m.name?.value?.toLowerCase() === "modelname")?.value ||
                        "unknown";
                    const entry = byDeployment.get(deployment) || { input: 0, output: 0, inference: 0 };
                    for (const point of ts.data || []) {
                        const total = point.total || 0;
                        if (metricName === "ProcessedPromptTokens") entry.input += total;
                        else if (metricName === "GeneratedTokens" || metricName === "GeneratedCompletionTokens") entry.output += total;
                        else if (metricName === "ProcessedInferenceTokens") entry.inference += total;
                    }
                    byDeployment.set(deployment, entry);
                }
            }

            for (const [modelName, tokens] of byDeployment.entries()) {
                // Para modelos Foundry no-OpenAI puede venir solo
                // ProcessedInferenceTokens (sin split prompt/output).
                const inputTokens = tokens.input > 0 || tokens.output > 0 ? tokens.input : tokens.inference;
                const outputTokens = tokens.output;
                if (inputTokens === 0 && outputTokens === 0) continue;
                rows.push({
                    subscriptionId: account.subscriptionId,
                    resourceName: account.name,
                    resourceGroup: account.resourceGroup,
                    modelName,
                    inputTokens: Math.round(inputTokens),
                    outputTokens: Math.round(outputTokens),
                    billedCost: estimateCost(modelName, inputTokens, outputTokens),
                });
            }
        } catch (err: any) {
            console.warn(`[aiUsageCollector] Error fetching metrics for ${account.id}:`, err?.message);
        }
    }

    return rows;
}
