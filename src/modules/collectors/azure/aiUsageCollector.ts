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
    date: string; // YYYY-MM-DD (UTC)
    subscriptionId: string;
    resourceName: string;
    resourceGroup: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    billedCost: number;
}

// Métricas de tokens por recurso Cognitive Services / Foundry. Se piden UNA
// POR UNA a propósito: Azure Monitor rechaza TODO el batch con 400
// (BadRequest) si cualquiera de los metricnames no existe para ese recurso
// concreto (p.ej. ProcessedInferenceTokens no existe en cuentas OpenAI
// clásicas). Pidiéndolas por separado, una métrica inexistente sólo falla su
// propia llamada y no tumba las demás.
const TOKEN_METRIC_NAMES = ["ProcessedPromptTokens", "GeneratedTokens", "ProcessedInferenceTokens"];

/**
 * Uso real de Azure OpenAI / Cognitive Services por día (ayer + hoy parcial),
 * por deployment (modelo). Fuente: Azure Monitor Metrics de cada cuenta
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
export async function getYesterdaysAIUsage(tenantId: string, signal?: AbortSignal): Promise<AIUsageRow[]> {
    if (signal?.aborted) throw signal.reason;
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return [];

    const argClient = new ResourceGraphClient(credential);
    // Busca cuentas que puedan emitir métricas de token:
    // 1. microsoft.cognitiveservices/accounts (Azure OpenAI, Azure AI Services)
    // 2. microsoft.ai/* (tipos Foundry-specific potenciales)
    // El filtro es permisivo porque el downstream (Azure Monitor Metrics) rechazará
    // cualquier recurso que no tenga las métricas requeridas de todas formas.
    const query = `
        Resources
        | where type =~ 'microsoft.cognitiveservices/accounts' or type =~ 'microsoft.ai.*'
        | project id, name, resourceGroup, subscriptionId, kind, type
    `;
    // This installed Resource Graph SDK has legacy ms-rest-js types whose
    // AbortSignalLike predates the DOM signal's `reason` property.
    const resp = await argClient.resources({ query, subscriptions: subs }, { abortSignal: signal as never });
    const accounts = (resp.data as any[]) || [];
    const resourceTypes = Array.from(new Set((accounts as any[]).map((a: any) => a.type))).join(', ');
    console.log(`[aiUsageCollector] tenant=${tenantId} subs=${subs.length} aiResources=${accounts.length} types=[${resourceTypes}]`);
    if (accounts.length === 0) return [];

    const now = new Date();
    const todayStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const yesterdayStartUtc = new Date(todayStartUtc.getTime() - 24 * 60 * 60 * 1000);
    // Incluye ayer completo + hoy parcial para evitar panel en cero cuando el
    // consumo empezó hoy y se fuerza sync manual antes del próximo corte diario.
    const timespan = `${yesterdayStartUtc.toISOString()}/${now.toISOString()}`;

    const rows: AIUsageRow[] = [];

    for (const account of accounts) {
        if (signal?.aborted) throw signal.reason;
        try {
            const client = new MonitorClient(credential, account.subscriptionId);

            // Pide cada métrica por separado (ver TOKEN_METRIC_NAMES) para que
            // una métrica inexistente no tumbe todo el batch con un 400.
            const fetchMetric = async (metricName: string, withFilter: boolean) => {
                try {
                    const opts: any = {
                        timespan,
                        interval: "P1D",
                        metricnames: metricName,
                        aggregation: "Total",
                        abortSignal: signal,
                    };
                    // Escenario estándar de Azure OpenAI: serie por deployment.
                    if (withFilter) opts.filter = "ModelDeploymentName eq '*'";
                    return await client.metrics.list(account.id, opts);
                } catch (error) {
                    if (signal?.aborted) throw error;
                    return null;
                }
            };

            // Se acumula por deployment + día (UTC) para persistir ayer y hoy parcial.
            const byDeploymentDay = new Map<string, { date: string; modelName: string; input: number; output: number; inference: number }>();

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
                        // Asegurar formato YYYY-MM-DD: si timeStamp es Date, usar toISOString(), si es string ya está
                        let pointDate = "";
                        const ts = point.timeStamp;
                        if (ts instanceof Date) {
                            pointDate = ts.toISOString().substring(0, 10);
                        } else if (typeof ts === "string") {
                            pointDate = ts.substring(0, 10);
                        } else {
                            pointDate = String(ts || "").substring(0, 10);
                        }
                        if (!pointDate || !pointDate.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
                        const key = `${deployment}::${pointDate}`;
                        const entry = byDeploymentDay.get(key) || {
                            date: pointDate,
                            modelName: deployment,
                            input: 0,
                            output: 0,
                            inference: 0,
                        };
                        if (metricName === "ProcessedPromptTokens") entry.input += total;
                        else if (metricName === "GeneratedTokens" || metricName === "GeneratedCompletionTokens") entry.output += total;
                        else if (metricName === "ProcessedInferenceTokens") entry.inference += total;
                        byDeploymentDay.set(key, entry);
                    }
                }
            };

            for (const metricName of TOKEN_METRIC_NAMES) {
                // Intento 1: segmentado por deployment (filtro ModelDeploymentName).
                let metrics = await fetchMetric(metricName, true);
                let hasSeries = (metrics?.value || []).some((m: any) => (m.timeseries || []).length > 0);
                // Intento 2: sin filtro (algunos recursos Foundry no exponen la
                // dimensión ModelDeploymentName en todas las series).
                if (!hasSeries) {
                    metrics = await fetchMetric(metricName, false);
                    hasSeries = (metrics?.value || []).some((m: any) => (m.timeseries || []).length > 0);
                }
                if (!metrics) continue;
                for (const metric of metrics.value || []) {
                    ingestMetric(metric.name?.value, metric);
                }
            }

            const rowsBefore = rows.length;
            for (const entry of byDeploymentDay.values()) {
                // Para modelos Foundry no-OpenAI puede venir solo
                // ProcessedInferenceTokens (sin split prompt/output).
                const inputTokens = entry.input > 0 || entry.output > 0 ? entry.input : entry.inference;
                const outputTokens = entry.output;
                if (inputTokens === 0 && outputTokens === 0) continue;
                rows.push({
                    date: entry.date,
                    subscriptionId: account.subscriptionId,
                    resourceName: account.name,
                    resourceGroup: account.resourceGroup,
                    modelName: entry.modelName,
                    inputTokens: Math.round(inputTokens),
                    outputTokens: Math.round(outputTokens),
                    billedCost: estimateCost(entry.modelName, inputTokens, outputTokens),
                });
            }
            console.log(
                `[aiUsageCollector] account=${account.name} kind=${account.kind || "?"} deploymentDays=${byDeploymentDay.size} rowsAdded=${rows.length - rowsBefore}`,
            );
        } catch (err: any) {
            console.warn(`[aiUsageCollector] Error fetching metrics for ${account.id}:`, err?.message);
        }
    }

    console.log(`[aiUsageCollector] tenant=${tenantId} totalRows=${rows.length}`);
    return rows;
}
