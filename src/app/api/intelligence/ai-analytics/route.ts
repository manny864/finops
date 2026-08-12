import { NextRequest, NextResponse } from "next/server";
import Decimal from "decimal.js";
import { requireTenantAccess, requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import pool from "@/modules/storage/db";
import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";

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

type AggRow = {
    model_name: string;
    application: string;
    team: string;
    date: string;
    cost: Decimal.Value;
    inputTokens: number;
    outputTokens: number;
};

const toCostNumber = (cost: Decimal) => cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
const costPer1k = (cost: Decimal, tokens: number) =>
    tokens > 0
        ? cost.dividedBy(tokens).times(1000).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber()
        : 0;

function formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function toDateKey(value: string | Date): string {
    if (value instanceof Date) {
        return formatDateKey(value);
    }
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        return raw.substring(0, 10);
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return formatDateKey(parsed);
    }
    return raw.substring(0, 10);
}

function filterRowsByDays(rows: AggRow[], days: number): AggRow[] {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const cutoffKey = formatDateKey(cutoff);
    return rows.filter((row) => toDateKey(row.date) >= cutoffKey);
}

function buildTrendMtd(rows: AggRow[]) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startKey = formatDateKey(start);
    const endKey = formatDateKey(end);
    const map = new Map<string, { cost: Decimal; inputTokens: number; outputTokens: number }>();

    for (const row of rows) {
        const key = toDateKey(row.date);
        if (key < startKey || key > endKey) continue;
        const entry = map.get(key) || { cost: new Decimal(0), inputTokens: 0, outputTokens: 0 };
        entry.cost = entry.cost.plus(new Decimal(row.cost || 0));
        entry.inputTokens += Number(row.inputTokens || 0);
        entry.outputTokens += Number(row.outputTokens || 0);
        map.set(key, entry);
    }

    const series: Array<{
        date: string;
        cost: number;
        inputTokens: number;
        outputTokens: number;
        cumulativeCost: number;
        cumulativeInputTokens: number;
        cumulativeOutputTokens: number;
        cumulativeTokens: number;
    }> = [];

    let runningCost = new Decimal(0);
    let runningInput = 0;
    let runningOutput = 0;
    for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
        const key = formatDateKey(day);
        const daily = map.get(key) || { cost: new Decimal(0), inputTokens: 0, outputTokens: 0 };
        runningCost = runningCost.plus(daily.cost);
        runningInput += daily.inputTokens;
        runningOutput += daily.outputTokens;
        series.push({
            date: key,
            cost: toCostNumber(daily.cost),
            inputTokens: daily.inputTokens,
            outputTokens: daily.outputTokens,
            cumulativeCost: toCostNumber(runningCost),
            cumulativeInputTokens: runningInput,
            cumulativeOutputTokens: runningOutput,
            cumulativeTokens: runningInput + runningOutput,
        });
    }

    return series;
}

function reconcileAiRowsWithMeterCost(aiRows: AggRow[], meterRows: AggRow[]): AggRow[] {
    if (!aiRows.length || !meterRows.length) return aiRows;

    const meterByDate = new Map<string, Decimal>();
    for (const row of meterRows) {
        const dateKey = toDateKey(row.date);
        const current = meterByDate.get(dateKey) || new Decimal(0);
        meterByDate.set(dateKey, current.plus(new Decimal(row.cost || 0)));
    }

    const aiByDate = new Map<string, { totalCost: Decimal; totalTokens: number }>();
    const aiRowCountByDate = new Map<string, number>();
    for (const row of aiRows) {
        const dateKey = toDateKey(row.date);
        const current = aiByDate.get(dateKey) || { totalCost: new Decimal(0), totalTokens: 0 };
        current.totalCost = current.totalCost.plus(new Decimal(row.cost || 0));
        current.totalTokens += Number(row.inputTokens || 0) + Number(row.outputTokens || 0);
        aiByDate.set(dateKey, current);
        aiRowCountByDate.set(dateKey, (aiRowCountByDate.get(dateKey) || 0) + 1);
    }

    const reconciledRows = aiRows.map((row) => {
        const dateKey = toDateKey(row.date);
        const meterTotal = meterByDate.get(dateKey);
        if (!meterTotal || meterTotal.lte(0)) return row;

        const aiDay = aiByDate.get(dateKey);
        if (!aiDay) return row;

        const rowCost = new Decimal(row.cost || 0);
        const rowTokens = Number(row.inputTokens || 0) + Number(row.outputTokens || 0);

        let share = new Decimal(0);
        if (aiDay.totalCost.gt(0)) {
            share = rowCost.dividedBy(aiDay.totalCost);
        } else if (aiDay.totalTokens > 0) {
            share = new Decimal(rowTokens).dividedBy(aiDay.totalTokens);
        } else {
            const rowCount = aiRowCountByDate.get(dateKey) || 0;
            if (rowCount > 0) {
                share = new Decimal(1).dividedBy(rowCount);
            } else {
                return row;
            }
        }

        if (share.lte(0)) {
            const rowCount = aiRowCountByDate.get(dateKey) || 0;
            if (rowCount > 0) {
                share = new Decimal(1).dividedBy(rowCount);
            } else {
                return row;
            }
        }

        const reconciledCost = meterTotal.times(share);
        return {
            ...row,
            cost: reconciledCost.toDecimalPlaces(8, Decimal.ROUND_HALF_UP),
        };
    });

    // Si Cost Management tiene costo para una fecha sin filas de tokens,
    // agregamos una fila sintética para no perder costo mensual total.
    for (const [dateKey, meterTotal] of meterByDate.entries()) {
        if (meterTotal.lte(0) || aiByDate.has(dateKey)) continue;
        reconciledRows.push({
            model_name: "unattributed-foundry-cost",
            application: "cost-management",
            team: "Sin asignar",
            date: dateKey,
            cost: meterTotal.toDecimalPlaces(8, Decimal.ROUND_HALF_UP),
            inputTokens: 0,
            outputTokens: 0,
        });
    }

    return reconciledRows;
}

function toMonthStart(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function filterRowsByCurrentMonth(rows: AggRow[]): AggRow[] {
    const now = new Date();
    const startKey = formatDateKey(toMonthStart(now));
    const endKey = formatDateKey(now);
    return rows.filter((row) => {
        const key = toDateKey(row.date);
        return key >= startKey && key <= endKey;
    });
}

function withMonthSummary(payload: any, rowsForMonth: AggRow[]) {
    const monthCost = sumRowsCost(rowsForMonth);
    const monthInput = rowsForMonth.reduce((acc, row) => acc + (Number(row.inputTokens || 0)), 0);
    const monthOutput = rowsForMonth.reduce((acc, row) => acc + (Number(row.outputTokens || 0)), 0);
    const totalTokens = monthInput + monthOutput;
    return {
        ...payload,
        summary: {
            ...payload.summary,
            totalCost: toCostNumber(monthCost),
            totalInputTokens: monthInput,
            totalOutputTokens: monthOutput,
            costPer1kTokens: totalTokens > 0
                ? monthCost.dividedBy(totalTokens).times(1000).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber()
                : payload.summary?.costPer1kTokens || 0,
        },
    };
}

function sumRowsCost(rows: AggRow[]): Decimal {
    return rows.reduce((acc, row) => acc.plus(new Decimal(row.cost || 0)), new Decimal(0));
}

function normalizeModelLabel(modelName: string): string {
    const value = String(modelName || "").trim().toLowerCase();
    if (!value || value === "unknown") return "Modelo no identificado";
    if (value === "unattributed-foundry-cost") return "Azure Foundry (sin atribución de modelo)";
    return modelName;
}

function aggregate(rows: AggRow[], tokensAvailable: boolean) {
    const modelMap = new Map<string, { model: string; cost: Decimal; inputTokens: number; outputTokens: number }>();
    const appMap = new Map<string, { application: string; cost: Decimal; model: string }>();
    const teamMap = new Map<string, { team: string; cost: Decimal }>();
    const trendMap = new Map<string, { date: string; cost: Decimal; inputTokens: number; outputTokens: number }>();

    let totalCost = new Decimal(0), totalInput = 0, totalOutput = 0;

    for (const r of rows) {
        const cost = new Decimal(r.cost || 0);
        const inp = Number(r.inputTokens) || 0;
        const out = Number(r.outputTokens) || 0;
        totalCost = totalCost.plus(cost);
        totalInput += inp;
        totalOutput += out;

        const mKey = normalizeModelLabel(r.model_name || "unknown");
        const mEntry = modelMap.get(mKey) || { model: mKey, cost: new Decimal(0), inputTokens: 0, outputTokens: 0 };
        mEntry.cost = mEntry.cost.plus(cost);
        mEntry.inputTokens += inp;
        mEntry.outputTokens += out;
        modelMap.set(mKey, mEntry);

        const aKey = r.application || "unknown";
        const aEntry = appMap.get(aKey) || { application: aKey, cost: new Decimal(0), model: mKey };
        aEntry.cost = aEntry.cost.plus(cost);
        appMap.set(aKey, aEntry);

        const tKey = r.team || "unknown";
        const tEntry = teamMap.get(tKey) || { team: tKey, cost: new Decimal(0) };
        tEntry.cost = tEntry.cost.plus(cost);
        teamMap.set(tKey, tEntry);

        const dKey = toDateKey(r.date);
        const dEntry = trendMap.get(dKey) || { date: dKey, cost: new Decimal(0), inputTokens: 0, outputTokens: 0 };
        dEntry.cost = dEntry.cost.plus(cost);
        dEntry.inputTokens += inp;
        dEntry.outputTokens += out;
        trendMap.set(dKey, dEntry);
    }

    const byModel = Array.from(modelMap.values()).map(m => ({
        model: m.model,
        cost: toCostNumber(m.cost),
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        costPer1k: costPer1k(m.cost, m.inputTokens + m.outputTokens),
    })).sort((a, b) => b.cost - a.cost);

    const totalTokens = totalInput + totalOutput;

    return {
        success: true,
        mock: false,
        tokensAvailable,
        summary: {
            totalCost: toCostNumber(totalCost),
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            costPer1kTokens: costPer1k(totalCost, totalTokens),
            activeModels: modelMap.size,
            activeApplications: appMap.size,
        },
        byModel,
        byApplication: Array.from(appMap.values())
            .map((entry) => ({ ...entry, cost: toCostNumber(entry.cost) }))
            .sort((a, b) => b.cost - a.cost),
        byTeam: Array.from(teamMap.values())
            .map((entry) => ({ ...entry, cost: toCostNumber(entry.cost) }))
            .sort((a, b) => b.cost - a.cost),
        trend: Array.from(trendMap.values())
            .map((entry) => ({ ...entry, cost: toCostNumber(entry.cost) }))
            .sort((a, b) => a.date.localeCompare(b.date)),
    };
}

const EMPTY_RESPONSE = { success: true, mock: false, tokensAvailable: false, summary: null, byModel: [], byApplication: [], byTeam: [], trend: [] };
const AI_SERVICE_PATTERNS = ["openai", "foundry", "cognitive", "azure ai", "ai services", "machine learning", "azureml"] as const;

function isAiServiceLabel(value: string): boolean {
    const s = String(value || "").toLowerCase();
    return AI_SERVICE_PATTERNS.some((token) => s.includes(token));
}

async function getLiveAiMtdTotal(tenantId: string): Promise<Decimal | null> {
    try {
        const entries = await getCurrentMonthAmortizedCosts(tenantId, "All", "ActualCost");
        let total = new Decimal(0);
        for (const entry of entries || []) {
            if (!isAiServiceLabel(entry.ServiceName || "")) continue;
            total = total.plus(new Decimal(entry.EffectiveCost || entry.BilledCost || 0));
        }
        return total.gt(0) ? total : null;
    } catch (error) {
        console.warn("[ai-analytics] live MTD anchor unavailable:", (error as Error)?.message || error);
        return null;
    }
}

function scaleRowsToLiveMonthTotal(rows: AggRow[], liveMonthTotal: Decimal | null): AggRow[] {
    if (!liveMonthTotal || liveMonthTotal.lte(0)) return rows;
    const monthRows = filterRowsByCurrentMonth(rows);
    const monthCurrentTotal = sumRowsCost(monthRows);
    if (monthCurrentTotal.lte(0)) return rows;
    const factor = liveMonthTotal.dividedBy(monthCurrentTotal);
    return rows.map((row) => {
        const dateKey = toDateKey(row.date);
        const monthStart = formatDateKey(toMonthStart(new Date()));
        const today = formatDateKey(new Date());
        if (dateKey < monthStart || dateKey > today) return row;
        return {
            ...row,
            cost: new Decimal(row.cost || 0).times(factor).toDecimalPlaces(8, Decimal.ROUND_HALF_UP),
        };
    });
}

async function fetchAIAnalytics(tenantId: string, days: number) {
    const daysForQuery = Math.max(days, new Date().getDate());
    const liveAiMtdTotal = await getLiveAiMtdTotal(tenantId);
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
         GROUP BY COALESCE(NULLIF(model_name, ''), 'unknown'), COALESCE(NULLIF(application, ''), NULLIF(resource_name, ''), 'unknown'), COALESCE(NULLIF(team, ''), 'Sin asignar'), date
         ORDER BY date ASC`,
        [tenantId, daysForQuery]
    );

    // 2) Fallback principal: CostMeterSnapshots (filas a nivel meter).
    //    Desde 20260704 el sync separa estos costos de CostSnapshots para evitar
    //    colisiones por subcategoría. Si consultamos solo CostSnapshots, muchos
    //    tenants quedan en cero aunque tengan consumo AI real.
    const [meterRows]: any = await pool.query(
        `SELECT
            COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name) AS model_name,
            COALESCE(NULLIF(subscription_id, ''), 'unknown-subscription') AS application,
            'Sin asignar' AS team,
            date,
            SUM(cost_usd) AS cost,
            0 AS inputTokens,
            0 AS outputTokens
         FROM CostMeterSnapshots
         WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
           AND (
                LOWER(service_name) LIKE '%openai%'
                OR LOWER(MeterCategory) LIKE '%openai%'
                OR LOWER(MeterName) LIKE '%openai%'
                OR LOWER(MeterSubCategory) LIKE '%openai%'
                OR LOWER(service_name) LIKE '%foundry%'
                OR LOWER(MeterCategory) LIKE '%foundry%'
                OR LOWER(MeterName) LIKE '%foundry%'
                OR LOWER(MeterSubCategory) LIKE '%foundry%'
                OR LOWER(service_name) LIKE '%cognitive%'
                OR LOWER(MeterCategory) LIKE '%cognitive%'
                OR LOWER(MeterName) LIKE '%cognitive%'
                OR LOWER(MeterSubCategory) LIKE '%cognitive%'
                OR LOWER(service_name) LIKE '%azure ai%'
                OR LOWER(MeterCategory) LIKE '%azure ai%'
                OR LOWER(MeterName) LIKE '%azure ai%'
                OR LOWER(MeterSubCategory) LIKE '%azure ai%'
                OR LOWER(service_name) LIKE '%ai services%'
                OR LOWER(MeterCategory) LIKE '%ai services%'
                OR LOWER(MeterName) LIKE '%ai services%'
                OR LOWER(MeterSubCategory) LIKE '%ai services%'
                OR LOWER(service_name) LIKE '%machine learning%'
                OR LOWER(MeterCategory) LIKE '%machine learning%'
                OR LOWER(MeterName) LIKE '%machine learning%'
                OR LOWER(MeterSubCategory) LIKE '%machine learning%'
                OR LOWER(service_name) LIKE '%azureml%'
                OR LOWER(MeterCategory) LIKE '%azureml%'
                OR LOWER(MeterName) LIKE '%azureml%'
                OR LOWER(MeterSubCategory) LIKE '%azureml%'
           )
         GROUP BY COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name), COALESCE(NULLIF(subscription_id, ''), 'unknown-subscription'), date
         ORDER BY date ASC`,
        [tenantId, daysForQuery]
    );

    if (aiRows && aiRows.length > 0) {
        const hasMeterRows = Array.isArray(meterRows) && meterRows.length > 0;
        const effectiveAiRowsBase = hasMeterRows
            ? reconcileAiRowsWithMeterCost(aiRows as AggRow[], meterRows as AggRow[])
            : (aiRows as AggRow[]);
        const effectiveAiRows = scaleRowsToLiveMonthTotal(effectiveAiRowsBase, liveAiMtdTotal);
        const recentRows = filterRowsByDays(effectiveAiRows, days);
        return withMonthSummary({
            ...aggregate(recentRows, true),
            trendMtd: buildTrendMtd(effectiveAiRows),
            source: hasMeterRows
                ? (liveAiMtdTotal ? "ai-snapshots-reconciled-with-meter-live-anchored" : "ai-snapshots-reconciled-with-meter")
                : (liveAiMtdTotal ? "ai-snapshots-live-anchored" : "ai-snapshots"),
        }, filterRowsByCurrentMonth(effectiveAiRows));
    }

    if (meterRows && meterRows.length > 0) {
        const effectiveMeterRows = scaleRowsToLiveMonthTotal(meterRows as AggRow[], liveAiMtdTotal);
        const recentRows = filterRowsByDays(effectiveMeterRows, days);
        return {
            ...aggregate(recentRows, false),
            trendMtd: buildTrendMtd(effectiveMeterRows),
            source: liveAiMtdTotal ? "cost-meter-fallback-live-anchored" : "cost-meter-fallback",
        };
    }

    // 3) Fallback de compatibilidad: CostSnapshots legado.
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
                LOWER(service_name) LIKE '%openai%'
                OR LOWER(MeterCategory) LIKE '%openai%'
                OR LOWER(MeterName) LIKE '%openai%'
                OR LOWER(MeterSubCategory) LIKE '%openai%'
                OR LOWER(service_name) LIKE '%foundry%'
                OR LOWER(MeterCategory) LIKE '%foundry%'
                OR LOWER(MeterName) LIKE '%foundry%'
                OR LOWER(MeterSubCategory) LIKE '%foundry%'
                OR LOWER(service_name) LIKE '%cognitive%'
                OR LOWER(MeterCategory) LIKE '%cognitive%'
                OR LOWER(MeterName) LIKE '%cognitive%'
                OR LOWER(MeterSubCategory) LIKE '%cognitive%'
                OR LOWER(service_name) LIKE '%azure ai%'
                OR LOWER(MeterCategory) LIKE '%azure ai%'
                OR LOWER(MeterName) LIKE '%azure ai%'
                OR LOWER(MeterSubCategory) LIKE '%azure ai%'
                OR LOWER(service_name) LIKE '%ai services%'
                OR LOWER(MeterCategory) LIKE '%ai services%'
                OR LOWER(MeterName) LIKE '%ai services%'
                OR LOWER(MeterSubCategory) LIKE '%ai services%'
                OR LOWER(service_name) LIKE '%machine learning%'
                OR LOWER(MeterCategory) LIKE '%machine learning%'
                OR LOWER(MeterName) LIKE '%machine learning%'
                OR LOWER(MeterSubCategory) LIKE '%machine learning%'
                OR LOWER(service_name) LIKE '%azureml%'
                OR LOWER(MeterCategory) LIKE '%azureml%'
                OR LOWER(MeterName) LIKE '%azureml%'
                OR LOWER(MeterSubCategory) LIKE '%azureml%'
           )
         GROUP BY COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name), resource_group, COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.Team')), 'null'), 'Sin asignar'), date
         ORDER BY date ASC`,
        [tenantId, daysForQuery]
    );

    if (!costRows || costRows.length === 0) {
        return EMPTY_RESPONSE;
    }

    const effectiveCostRows = scaleRowsToLiveMonthTotal(costRows as AggRow[], liveAiMtdTotal);
    const recentRows = filterRowsByDays(effectiveCostRows, days);
    return {
        ...aggregate(recentRows, false),
        trendMtd: buildTrendMtd(effectiveCostRows),
        source: liveAiMtdTotal ? "cost-snapshots-fallback-live-anchored" : "cost-snapshots-fallback",
    };
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

            const cacheKey = `ai-analytics:v7:${tenantId}:${days}`;
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
