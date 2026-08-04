import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import pool from "@/modules/storage/db";

const MOCK_PAYLOAD = {
    success: true,
    mock: true,
    summary: {
        totalCost: 8420.50,
        totalInputTokens: 42500000,
        totalOutputTokens: 18300000,
        costPer1kTokens: 0.139,
        activeModels: 4,
        activeApplications: 7,
    },
    byModel: [
        { model: "gpt-4o", cost: 5200, inputTokens: 25000000, outputTokens: 12000000, costPer1k: 0.140 },
        { model: "gpt-4-turbo", cost: 2100, inputTokens: 10000000, outputTokens: 4500000, costPer1k: 0.145 },
        { model: "gpt-35-turbo", cost: 850, inputTokens: 6500000, outputTokens: 1500000, costPer1k: 0.106 },
        { model: "text-embedding-3-large", cost: 270.50, inputTokens: 1000000, outputTokens: 300000, costPer1k: 0.208 },
    ],
    byApplication: [
        { application: "customer-support-bot", cost: 3200, model: "gpt-4o" },
        { application: "doc-summarizer", cost: 1800, model: "gpt-4o" },
        { application: "sales-assistant", cost: 1100, model: "gpt-4-turbo" },
        { application: "embeddings-pipeline", cost: 850, model: "text-embedding-3-large" },
        { application: "internal-search", cost: 650, model: "gpt-35-turbo" },
        { application: "code-helper", cost: 520, model: "gpt-4-turbo" },
        { application: "qa-eval", cost: 300.50, model: "gpt-35-turbo" },
    ],
    byTeam: [
        { team: "cx", cost: 3200 },
        { team: "product", cost: 2520 },
        { team: "sales", cost: 1100 },
        { team: "data-eng", cost: 850 },
        { team: "engineering", cost: 750.50 },
    ],
    trend: [
        { date: "2026-06-01", cost: 265, inputTokens: 1350000, outputTokens: 580000 },
        { date: "2026-06-08", cost: 285, inputTokens: 1450000, outputTokens: 620000 },
        { date: "2026-06-15", cost: 305, inputTokens: 1530000, outputTokens: 670000 },
        { date: "2026-06-22", cost: 295, inputTokens: 1490000, outputTokens: 640000 },
        { date: "2026-06-27", cost: 310, inputTokens: 1560000, outputTokens: 680000 },
    ],
};

type AggRow = { model_name: string; application: string; team: string; date: string; cost: number; inputTokens: number; outputTokens: number };

function aggregate(rows: AggRow[], tokensAvailable: boolean) {
    const modelMap = new Map<string, { model: string; cost: number; inputTokens: number; outputTokens: number }>();
    const appMap = new Map<string, { application: string; cost: number; model: string }>();
    const teamMap = new Map<string, { team: string; cost: number }>();
    const trendMap = new Map<string, { date: string; cost: number; inputTokens: number; outputTokens: number }>();

    let totalCost = 0, totalInput = 0, totalOutput = 0;

    for (const r of rows) {
        const cost = Number(r.cost);
        const inp = Number(r.inputTokens) || 0;
        const out = Number(r.outputTokens) || 0;
        totalCost += cost;
        totalInput += inp;
        totalOutput += out;

        const mKey = r.model_name || "unknown";
        const mEntry = modelMap.get(mKey) || { model: mKey, cost: 0, inputTokens: 0, outputTokens: 0 };
        mEntry.cost += cost;
        mEntry.inputTokens += inp;
        mEntry.outputTokens += out;
        modelMap.set(mKey, mEntry);

        const aKey = r.application || "unknown";
        const aEntry = appMap.get(aKey) || { application: aKey, cost: 0, model: mKey };
        aEntry.cost += cost;
        appMap.set(aKey, aEntry);

        const tKey = r.team || "unknown";
        const tEntry = teamMap.get(tKey) || { team: tKey, cost: 0 };
        tEntry.cost += cost;
        teamMap.set(tKey, tEntry);

        const dKey = String(r.date).substring(0, 10);
        const dEntry = trendMap.get(dKey) || { date: dKey, cost: 0, inputTokens: 0, outputTokens: 0 };
        dEntry.cost += cost;
        dEntry.inputTokens += inp;
        dEntry.outputTokens += out;
        trendMap.set(dKey, dEntry);
    }

    const byModel = Array.from(modelMap.values()).map(m => ({
        ...m,
        costPer1k: m.inputTokens + m.outputTokens > 0 ? (m.cost / (m.inputTokens + m.outputTokens)) * 1000 : 0,
    })).sort((a, b) => b.cost - a.cost);

    const totalTokens = totalInput + totalOutput;

    return {
        success: true,
        mock: false,
        tokensAvailable,
        summary: {
            totalCost,
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            costPer1kTokens: totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0,
            activeModels: modelMap.size,
            activeApplications: appMap.size,
        },
        byModel,
        byApplication: Array.from(appMap.values()).sort((a, b) => b.cost - a.cost),
        byTeam: Array.from(teamMap.values()).sort((a, b) => b.cost - a.cost),
        trend: Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    };
}

const EMPTY_RESPONSE = { success: true, mock: false, tokensAvailable: false, summary: null, byModel: [], byApplication: [], byTeam: [], trend: [] };

async function fetchAIAnalytics(tenantId: string, days: number) {
    // 1) Fuente primaria: AICostSnapshots — uso real por modelo (tokens) de
    //    Microsoft Foundry / Azure OpenAI sincronizado desde Azure Monitor
    //    Metrics (ver aiUsageCollector.ts). Puede estar vacía si el cron todavía
    //    no corrió para este tenant, o si no tiene cuentas AI compatibles.
    const [aiRows]: any = await pool.query(
        `SELECT
            COALESCE(NULLIF(model_name, ''), 'unknown') AS model_name,
            COALESCE(NULLIF(application, ''), NULLIF(resource_name, ''), 'unknown') AS application,
            COALESCE(NULLIF(team, ''), 'Sin asignar') AS team,
            date,
            SUM(COALESCE(NULLIF(billed_cost, 0), effective_cost, 0)) AS cost,
            SUM(input_tokens) AS inputTokens,
            SUM(output_tokens) AS outputTokens
         FROM AICostSnapshots
         WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY model_name, resource_name, application, team, date
         ORDER BY date ASC`,
        [tenantId, days]
    );

    if (aiRows && aiRows.length > 0) {
        return aggregate(aiRows, true);
    }

    // 2) Fallback: costo real de Foundry/OpenAI/AI Services desde CostSnapshots
    //    (ya sincronizado por el cron de costos vía Cost Management), sin
    //    desglose de tokens — ver comentario de tokensAvailable más abajo.
    const [costRows]: any = await pool.query(
        `SELECT
            COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name) AS model_name,
            resource_group AS application,
            COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.Team')), 'null'), 'Sin asignar') AS team,
            date,
            SUM(cost_usd) AS cost,
            0 AS inputTokens,
            0 AS outputTokens
         FROM CostSnapshots
         WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
           AND (
                LOWER(service_name) LIKE '%cognitive services%'
                OR LOWER(service_name) LIKE '%openai%'
                OR LOWER(service_name) LIKE '%azure ai%'
                OR LOWER(service_name) LIKE '%ai services%'
                OR LOWER(ServiceFamily) LIKE '%ai%'
                OR LOWER(MeterCategory) LIKE '%cognitive services%'
                OR LOWER(MeterCategory) LIKE '%openai%'
                OR LOWER(MeterCategory) LIKE '%azure ai%'
                OR LOWER(MeterCategory) LIKE '%ai services%'
                OR LOWER(MeterSubCategory) LIKE '%openai%'
                OR LOWER(MeterSubCategory) LIKE '%foundry%'
           )
         GROUP BY COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name), resource_group, COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.Team')), 'null'), 'Sin asignar'), date
         ORDER BY date ASC`,
        [tenantId, days]
    );

    if (!costRows || costRows.length === 0) {
        return EMPTY_RESPONSE;
    }

    return aggregate(costRows, false);
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const parsedDays = parseInt(searchParams.get("days") || "30", 10);
        const days = Number.isFinite(parsedDays) ? Math.min(365, Math.max(1, parsedDays)) : 30;

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro: tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);
        let isSuperAdmin = false;
        try {
            await requireSuperAdmin(request);
            isSuperAdmin = true;
        } catch {
            isSuperAdmin = false;
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(MOCK_PAYLOAD);
        }

        try {
            const [tenants]: any = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ?", [tenantId]);
            if (!tenants || tenants.length === 0) {
                return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
            }
            const tier = String(tenants[0].tier || "");
            if (tier.toLowerCase() !== "enterprise" && !isSuperAdmin) {
                return NextResponse.json({ error: "Feature bloqueada. Requiere plan Enterprise." }, { status: 403 });
            }

            const cacheKey = `ai-analytics:v2:${tenantId}:${days}`;
            const payload = await getWithStaleWhileRevalidate(
                cacheKey,
                () => fetchAIAnalytics(tenantId, days),
                3600,
                900,
                // No cachear una respuesta vacía por la hora completa: si el cron
                // corre unos minutos después de esta request, no queremos que el
                // usuario siga viendo "sin datos" por 55 min más.
                (data) => (data.summary === null ? 120 : 3600)
            );

            return NextResponse.json(payload);
        } catch (dbErr: any) {
            console.error("AI Analytics DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({
                success: false, mock: false,
                summary: { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, costPer1kTokens: 0, activeModels: 0, activeApplications: 0 },
                byModel: [], byApplication: [], byTeam: [], trend: [],
                error: `Sin datos disponibles: ${dbErr?.message || "error"}`,
            });
        }
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("AI Analytics API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
