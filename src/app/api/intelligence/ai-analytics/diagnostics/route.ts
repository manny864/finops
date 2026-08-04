// RBAC: requiere acceso al tenant (requireTenantAccess) — expone metadatos de
// infraestructura Azure (subs, cuentas Cognitive/Foundry, definiciones de
// métricas) que ya pertenecen al propio tenant. Rol Azure mínimo:
// Reader + Monitoring Reader (los que ya tiene el SP del tenant). No agrega
// permisos nuevos: es el mismo alcance que usa el colector aiUsageCollector.
//
// Objetivo: diagnosticar por qué "Microsoft Foundry AI Cost Analytics" queda
// en cero, mostrando exactamente qué descubre y qué métricas expone cada
// cuenta AI del tenant, sin necesidad de acceso a la DB de prod ni a los logs
// del cron.
import { NextRequest, NextResponse } from "next/server";
import { MonitorClient } from "@azure/arm-monitor";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { getYesterdaysAIUsage } from "@/modules/collectors/azure/aiUsageCollector";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

export const dynamic = "force-dynamic";

const TOKEN_METRIC_NAMES = ["ProcessedPromptTokens", "GeneratedTokens", "ProcessedInferenceTokens"];

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const pageParam = parseInt(searchParams.get("page") || "1", 10);
        const pageSizeParam = parseInt(searchParams.get("pageSize") || "15", 10);
        
        // Paginación: 15/30/45/60 items por página
        const pageSize = Math.min(60, Math.max(15, [15, 30, 45, 60].find((s) => s >= pageSizeParam) || 15));
        const page = Math.max(1, pageParam);
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro: tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ mock: true, message: "Tenant demo: los datos de AI Analytics son sintéticos." });
        }

        const diagnostics: any = {
            tenantId,
            timestampUtc: new Date().toISOString(),
            steps: {},
        };

        // 1) Estado de la tabla AICostSnapshots para el tenant.
        try {
            const [rows]: any = await pool.query(
                `SELECT COUNT(*) AS total, MAX(date) AS maxDate, MIN(date) AS minDate,
                        COUNT(DISTINCT model_name) AS models,
                        SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens
                 FROM AICostSnapshots WHERE tenant_id = ?`,
                [tenantId]
            );
            diagnostics.steps.aiCostSnapshotsTable = rows?.[0] || null;
        } catch (e: any) {
            diagnostics.steps.aiCostSnapshotsTable = { error: e?.message };
        }

        // 2) Credencial + suscripciones visibles (con truncado por tier).
        let credential;
        try {
            credential = await getAzureCredential(tenantId);
        } catch (e: any) {
            diagnostics.steps.credential = { error: e?.message };
            return NextResponse.json(diagnostics);
        }

        let subs: string[] = [];
        try {
            subs = await getSubscriptionsForTenant(tenantId, credential);
            diagnostics.steps.subscriptions = { count: subs.length, ids: subs };
        } catch (e: any) {
            diagnostics.steps.subscriptions = { error: e?.message };
            return NextResponse.json(diagnostics);
        }
        if (subs.length === 0) {
            diagnostics.steps.conclusion = "No hay suscripciones visibles para el SP del tenant (o el límite de tier las truncó a 0). Verifique roles Reader del Service Principal.";
            return NextResponse.json(diagnostics);
        }

        // 3) Descubrimiento de cuentas Cognitive Services / Foundry vía ARG.
        const accounts: any[] = [];
        try {
            const argClient = new ResourceGraphClient(credential);
            // Mismo KQL que en aiUsageCollector.ts — busca:
            // 1. microsoft.cognitiveservices/accounts (Azure OpenAI, Azure AI Services)
            // 2. microsoft.ai/* (tipos Foundry-specific potenciales)
            const query = `
                Resources
                | where type =~ 'microsoft.cognitiveservices/accounts' or type =~ 'microsoft.ai.*'
                | project id, name, resourceGroup, subscriptionId, kind, location, sku=tostring(sku.name), type
            `;
            const resp = await argClient.resources({ query, subscriptions: subs });
            accounts.push(...((resp.data as any[]) || []));
            const resourceTypes = Array.from(new Set((accounts as any[]).map((a: any) => a.type))).join(', ');
            
            // Paginación de cuentas para el reporte
            const accountsMapped = accounts.map((a: any) => ({ name: a.name, kind: a.kind, type: a.type, resourceGroup: a.resourceGroup, subscriptionId: a.subscriptionId, location: a.location, sku: a.sku }));
            const totalAccounts = accountsMapped.length;
            const startIdx = (page - 1) * pageSize;
            const endIdx = startIdx + pageSize;
            const accountsPage = accountsMapped.slice(startIdx, endIdx);
            
            diagnostics.steps.cognitiveAccounts = {
                count: totalAccounts,
                page,
                pageSize,
                resourceTypes,
                accounts: accountsPage,
            };
        } catch (e: any) {
            diagnostics.steps.cognitiveAccounts = { error: e?.message };
            return NextResponse.json(diagnostics);
        }
        if (accounts.length === 0) {
            diagnostics.steps.conclusion = "No se encontró ninguna cuenta AI (microsoft.cognitiveservices/accounts o microsoft.ai.*) en las suscripciones visibles. Si Foundry está en un tipo de recurso distinto o en una suscripción fuera del límite de tier, no se ingiere. Verifique el tipo del recurso Foundry.";
            return NextResponse.json(diagnostics);
        }

        // 4) Por cada cuenta: métricas disponibles + si devuelven series.
        const now = new Date();
        const todayStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const yesterdayStartUtc = new Date(todayStartUtc.getTime() - 24 * 60 * 60 * 1000);
        const timespan = `${yesterdayStartUtc.toISOString()}/${now.toISOString()}`;

        const perAccount: any[] = [];
        for (const account of accounts) {
            const detail: any = { name: account.name, kind: account.kind };
            try {
                const client = new MonitorClient(credential, account.subscriptionId);

                // Definiciones de métricas disponibles (para saber qué expone
                // realmente el recurso — clave para Foundry vs OpenAI clásico).
                try {
                    const defs: string[] = [];
                    for await (const d of client.metricDefinitions.list(account.id)) {
                        if (d.name?.value) defs.push(d.name.value);
                    }
                    detail.availableMetricDefinitions = defs;
                    detail.tokenMetricsPresent = TOKEN_METRIC_NAMES.filter((m) => defs.includes(m));
                } catch (e: any) {
                    detail.availableMetricDefinitions = { error: e?.message };
                }

                // Intenta cada métrica de token por separado y reporta series.
                const metricProbe: any = {};
                for (const metricName of TOKEN_METRIC_NAMES) {
                    try {
                        const m = await client.metrics.list(account.id, {
                            timespan,
                            interval: "P1D",
                            metricnames: metricName,
                            aggregation: "Total",
                            filter: "ModelDeploymentName eq '*'",
                        });
                        const seriesCount = (m.value || []).reduce((acc, mv) => acc + (mv.timeseries?.length || 0), 0);
                        const totalSum = (m.value || []).reduce(
                            (acc, mv) => acc + (mv.timeseries || []).reduce(
                                (a2, ts) => a2 + (ts.data || []).reduce((a3, p) => a3 + (p.total || 0), 0), 0), 0);
                        metricProbe[metricName] = { ok: true, withFilter: true, seriesCount, totalSum };
                    } catch {
                        // Reintento sin filtro (Foundry a veces no expone la dimensión).
                        try {
                            const m = await client.metrics.list(account.id, {
                                timespan,
                                interval: "P1D",
                                metricnames: metricName,
                                aggregation: "Total",
                            });
                            const seriesCount = (m.value || []).reduce((acc, mv) => acc + (mv.timeseries?.length || 0), 0);
                            const totalSum = (m.value || []).reduce(
                                (acc, mv) => acc + (mv.timeseries || []).reduce(
                                    (a2, ts) => a2 + (ts.data || []).reduce((a3, p) => a3 + (p.total || 0), 0), 0), 0);
                            metricProbe[metricName] = { ok: true, withFilter: false, seriesCount, totalSum };
                        } catch (e2: any) {
                            metricProbe[metricName] = { ok: false, error: e2?.message };
                        }
                    }
                }
                detail.metricProbe = metricProbe;
            } catch (e: any) {
                detail.error = e?.message;
            }
            perAccount.push(detail);
        }
        diagnostics.steps.metricsByAccount = perAccount;

        // 5) Qué filas produciría realmente el colector ahora mismo.
        try {
            const rows = await getYesterdaysAIUsage(tenantId);
            const startIdx = (page - 1) * pageSize;
            const endIdx = startIdx + pageSize;
            diagnostics.steps.collectorRows = {
                count: rows.length,
                page,
                pageSize,
                rows: rows.slice(startIdx, endIdx),
            };
        } catch (e: any) {
            diagnostics.steps.collectorRows = { error: e?.message };
        }

        // Conclusión heurística.
        const anyTokenMetric = perAccount.some((a) =>
            a.metricProbe && Object.values(a.metricProbe).some((p: any) => p.ok && p.totalSum > 0));
        const anyDefs = perAccount.some((a) => Array.isArray(a.tokenMetricsPresent) && a.tokenMetricsPresent.length > 0);
        if (diagnostics.steps.collectorRows?.count > 0) {
            diagnostics.steps.conclusion = "El colector produce filas. Ejecute el cron /api/cron/sync para persistirlas y se invalidará el cache. Si el panel sigue en cero, revise permisos del cron o el tier del tenant (requiere Enterprise o superadmin).";
        } else if (!anyDefs) {
            diagnostics.steps.conclusion = "Las cuentas AI NO exponen las métricas de token estándar (ProcessedPromptTokens/GeneratedTokens/ProcessedInferenceTokens). Los modelos Foundry en este recurso probablemente no emiten métricas a Azure Monitor; el costo real seguirá viniendo del fallback CostSnapshots (Cost Management, con 8-24h de latencia).";
        } else if (!anyTokenMetric) {
            diagnostics.steps.conclusion = "Las métricas existen pero devuelven 0 en la ventana ayer+hoy. Puede ser latencia de Azure Monitor (hasta ~15 min) o que el consumo cae fuera de la ventana. Reintente en unos minutos.";
        } else {
            diagnostics.steps.conclusion = "Hay métricas con datos pero el colector no generó filas: revisar mapeo de dimensiones (ModelDeploymentName/ModelName).";
        }

        return NextResponse.json(diagnostics);
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("AI Analytics diagnostics error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
