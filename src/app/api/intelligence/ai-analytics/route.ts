import { NextRequest, NextResponse } from "next/server";
import Decimal from "decimal.js";
import { requireTenantAccess, requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import pool, { insertAICostSnapshotRow } from "@/modules/storage/db";
import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";
import { getHistoricalAIUsage } from "@/modules/collectors/azure/aiUsageCollector";
import { errorMessage } from '@/lib/apiErrors';

const MOCK_PAYLOAD = {
    success: true,
    mock: true,
    summary: {
        totalCost: 8420.50,
        totalRequests: 1680,
        totalInputTokens: 42500000,
        totalOutputTokens: 18300000,
        avgTokensPerRequest: 36130,
        avgInputPerRequest: 25298,
        avgOutputPerRequest: 10892,
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
    requestCount: number;
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

    const normalizeModelKey = (value: string): string => {
        const s = String(value || "").toLowerCase().trim();
        if (!s) return "";

        // 1. Explicitly ignore non-LLM meters (Search, DocIntel, Speech, Translator, etc.)
        if (
            s.includes("standard-s1") ||
            s.includes("standard-s2") ||
            s.includes("standard-s3") ||
            s.includes("search") ||
            s.includes("doc-intel") ||
            s.includes("document-intel") ||
            s.includes("form-rec") ||
            s.includes("translator") ||
            s.includes("speech") ||
            s.includes("textanalytics") ||
            s.includes("text-analytics") ||
            s.includes("content-safety") ||
            s.includes("contentsafety") ||
            s.includes("unknown") ||
            s === "standard" ||
            s === "cognitive services" ||
            s === "azure ai services" ||
            s === "azure openai"
        ) {
            return "";
        }

        // 2. Map DeepSeek V4 Pro meters (v4-pro-glbl, v4-pro-cached-glbl, v4-pro-cached-dz, v4-pro-dz, v4-pro-outp-glbl, v4-pro-outp-dz)
        if (
            s.includes("v4-pro") ||
            s.includes("v4_pro") ||
            s.includes("deepseek-v4-pro") ||
            s.includes("deepseekv4pro") ||
            s.includes("deepseek-pro")
        ) {
            return "DeepSeek-V4-Pro";
        }

        // 3. Map DeepSeek V4 Flash meters (v4-flash-glbl, v4-flash-cached-glbl, v4-flash-outp-glbl, etc.)
        if (
            s.includes("v4-flash") ||
            s.includes("v4_flash") ||
            s.includes("deepseek-v4-flash") ||
            s.includes("deepseekv4flash") ||
            s.includes("deepseek-flash")
        ) {
            return "DeepSeek-V4-Flash";
        }

        // 4. Map GPT 5.x models
        if (s.includes("5.6-sol") || s.includes("56-sol") || s.includes("5.6_sol")) {
            return "gpt-5.6-sol";
        }
        if (s.includes("5.6-terra") || s.includes("56-terra") || s.includes("5.6_terra")) {
            return "gpt-5.6-terra";
        }
        if (s.includes("5.3-codex") || s.includes("53-codex") || s.includes("5.3_codex")) {
            return "gpt-5.3-codex";
        }
        if (s.includes("5.1") || s.includes("gpt-51")) {
            return "gpt-5.1";
        }

        // Clean meter names that have extra service prefixes or descriptors
        const cleaned = s
          .replace(/^(azure[- ]openai|cognitive[- ]services|azure[- ]ai[- ]services|azure[- ]ai|foundry)\s*[-:]\s*/i, "")
          .replace(/\s+(inp|out|opt|op|tokens?|1m|1k|gl|ad|std|cd)\b/gi, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-");

        let m = cleaned.match(/^(?:gpt-)?(\d+(?:\.\d+)?(?:[a-z0-9]+)?(?:-[a-z0-9]+)?)/i);
        if (m) {
          const version = m[1].toLowerCase();
          return `gpt-${version}`;
        }

        m = cleaned.match(/^([a-z]+-(?:[a-z]+-)*\d+(?:-[a-z0-9]+)?)/i);
        if (m) {
          return m[1].toLowerCase();
        }

        m = cleaned.match(/^([a-z0-9]+)-(\d+(?:\.\d+)?(?:[a-z0-9]+)?)/i);
        if (m) {
          return `${m[1]}-${m[2]}`.toLowerCase();
        }

        return cleaned.toLowerCase();
    };

    const meterByDate = new Map<string, Decimal>();
    const meterByDateModel = new Map<string, Decimal>();
    const meterMetaByKey = new Map<string, { application: string; team: string }>();
    const attributableByDate = new Map<string, Decimal>();
    for (const row of meterRows) {
        const dateKey = toDateKey(row.date);
        const modelKey = normalizeModelKey(String(row.model_name || ""));
        const cost = new Decimal(row.cost || 0);
        meterByDate.set(dateKey, (meterByDate.get(dateKey) || new Decimal(0)).plus(cost));
        if (modelKey) {
            const key = `${dateKey}::${modelKey}`;
            meterByDateModel.set(key, (meterByDateModel.get(key) || new Decimal(0)).plus(cost));
            attributableByDate.set(dateKey, (attributableByDate.get(dateKey) || new Decimal(0)).plus(cost));
            if (!meterMetaByKey.has(key)) {
                meterMetaByKey.set(key, {
                    application: String(row.application || "unknown-subscription"),
                    team: String(row.team || "Sin asignar"),
                });
            }
        }
    }

    const rows = aiRows.map((r) => ({ ...r, cost: new Decimal(0) }));
    const rowsByDate = new Map<string, number[]>();
    for (let i = 0; i < rows.length; i++) {
        const dateKey = toDateKey(rows[i].date);
        const arr = rowsByDate.get(dateKey) || [];
        arr.push(i);
        rowsByDate.set(dateKey, arr);
    }

    // Meter model keys (date::modelKey) that were matched to an existing AI usage row.
    const matchedMeterKeys = new Set<string>();

    // 1) Assign meter cost to AI rows that share the same model/day.
    for (const [dateKey, idxs] of rowsByDate.entries()) {
        const modelBuckets = new Map<string, number[]>();
        for (const idx of idxs) {
            const key = normalizeModelKey(String(aiRows[idx].model_name || ""));
            const arr = modelBuckets.get(key) || [];
            arr.push(idx);
            modelBuckets.set(key, arr);
        }

        for (const [modelKey, modelIdxs] of modelBuckets.entries()) {
            const meterKey = `${dateKey}::${modelKey}`;
            const modelMeter = meterByDateModel.get(meterKey);
            if (!modelMeter || modelMeter.lte(0)) continue;

            // distribute by token share inside same model/day
            const totalTokens = modelIdxs.reduce(
                (sum, idx) => sum + Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0),
                0
            );
            const count = modelIdxs.length || 1;
            for (const idx of modelIdxs) {
                const rowTokens = Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0);
                const share = totalTokens > 0 ? new Decimal(rowTokens).dividedBy(totalTokens) : new Decimal(1).dividedBy(count);
                rows[idx].cost = modelMeter.times(share).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
            }
            matchedMeterKeys.add(meterKey);
        }
    }

    // 2) Surface meter-only models (billing meters with no matching AI usage row)
    //    as their own rows, instead of smearing their cost across the visible models.
    //    This is the fix for distinct Foundry models (e.g. gpt-5.3-codex) that exist
    //    in CostMeterSnapshots but not in AICostSnapshots.
    const syntheticRows: AggRow[] = [];
    for (const [meterKey, cost] of meterByDateModel.entries()) {
        if (matchedMeterKeys.has(meterKey) || cost.lte(0)) continue;
        const sepIdx = meterKey.indexOf("::");
        const dateKey = meterKey.substring(0, sepIdx);
        const modelKey = meterKey.substring(sepIdx + 2);
        const meta = meterMetaByKey.get(meterKey);
        syntheticRows.push({
            model_name: modelKey,
            application: meta?.application || "unknown-subscription",
            team: meta?.team || "Sin asignar",
            date: dateKey,
            cost,
            requestCount: 0,
            inputTokens: 0,
            outputTokens: 0,
        });
    }

    // 3) Any meter cost that could not be attributed to a model key (empty key) is
    //    spread across that day's AI rows by token share, else deferred to orphans.
    let orphanDateCost = new Decimal(0);
    for (const [dateKey, meterTotal] of meterByDate.entries()) {
        const attributable = attributableByDate.get(dateKey) || new Decimal(0);
        const remaining = meterTotal.minus(attributable);
        if (remaining.lte(0)) continue;
        const idxs = rowsByDate.get(dateKey);
        if (idxs && idxs.length > 0) {
            const totalTokens = idxs.reduce(
                (sum, idx) => sum + Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0),
                0
            );
            for (const idx of idxs) {
                const rowTokens = Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0);
                const share = totalTokens > 0 ? new Decimal(rowTokens).dividedBy(totalTokens) : new Decimal(1).dividedBy(idxs.length);
                rows[idx].cost = (rows[idx].cost as Decimal).plus(remaining.times(share)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
            }
        } else {
            orphanDateCost = orphanDateCost.plus(remaining);
        }
    }

    if (orphanDateCost.gt(0) && rows.length > 0) {
        const tokenBase = rows.reduce((sum, r) => sum + Number(r.inputTokens || 0) + Number(r.outputTokens || 0), 0);
        for (const row of rows) {
            const rowTokens = Number(row.inputTokens || 0) + Number(row.outputTokens || 0);
            const share = tokenBase > 0 ? new Decimal(rowTokens).dividedBy(tokenBase) : new Decimal(1).dividedBy(rows.length);
            row.cost = (row.cost as Decimal).plus(orphanDateCost.times(share)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
        }
    }

    return [...rows, ...syntheticRows].map((r) => ({ ...r, cost: r.cost }));
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
    const monthRequests = rowsForMonth.reduce((acc, row) => acc + (Number(row.requestCount || 0)), 0);
    const monthInput = rowsForMonth.reduce((acc, row) => acc + (Number(row.inputTokens || 0)), 0);
    const monthOutput = rowsForMonth.reduce((acc, row) => acc + (Number(row.outputTokens || 0)), 0);
    const totalTokens = monthInput + monthOutput;
    return {
        ...payload,
        summary: {
            ...payload.summary,
            totalCost: toCostNumber(monthCost),
            totalRequests: monthRequests,
            totalInputTokens: monthInput,
            totalOutputTokens: monthOutput,
            avgTokensPerRequest: monthRequests > 0 ? Math.round(totalTokens / monthRequests) : 0,
            avgInputPerRequest: monthRequests > 0 ? Math.round(monthInput / monthRequests) : 0,
            avgOutputPerRequest: monthRequests > 0 ? Math.round(monthOutput / monthRequests) : 0,
            costPer1kTokens: totalTokens > 0
                ? monthCost.dividedBy(totalTokens).times(1000).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber()
                : payload.summary?.costPer1kTokens || 0,
        },
    };
}

function sumRowsCost(rows: AggRow[]): Decimal {
    return rows.reduce((acc, row) => acc.plus(new Decimal(row.cost || 0)), new Decimal(0));
}

function aggregate(rows: AggRow[], tokensAvailable: boolean) {
    const modelMap = new Map<string, { model: string; cost: Decimal; requestCount: number; inputTokens: number; outputTokens: number }>();
    const appMap = new Map<string, { application: string; cost: Decimal; model: string }>();
    const teamMap = new Map<string, { team: string; cost: Decimal }>();
    const trendMap = new Map<string, { date: string; cost: Decimal; inputTokens: number; outputTokens: number }>();

    let totalCost = new Decimal(0), totalRequests = 0, totalInput = 0, totalOutput = 0;

    for (const r of rows) {
        const cost = new Decimal(r.cost || 0);
        const req = Number(r.requestCount || 0);
        const inp = Number(r.inputTokens) || 0;
        const out = Number(r.outputTokens) || 0;
        totalCost = totalCost.plus(cost);
        totalRequests += req;
        totalInput += inp;
        totalOutput += out;

        const mKey = r.model_name || "unknown";
        const mEntry = modelMap.get(mKey) || { model: mKey, cost: new Decimal(0), requestCount: 0, inputTokens: 0, outputTokens: 0 };
        mEntry.cost = mEntry.cost.plus(cost);
        mEntry.requestCount += req;
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
        requestCount: m.requestCount,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        avgTokensPerRequest: m.requestCount > 0 ? Math.round((m.inputTokens + m.outputTokens) / m.requestCount) : 0,
        costPer1k: costPer1k(m.cost, m.inputTokens + m.outputTokens),
    })).sort((a, b) => b.cost - a.cost);

    const totalTokens = totalInput + totalOutput;

    return {
        success: true,
        mock: false,
        tokensAvailable,
        summary: {
            totalCost: toCostNumber(totalCost),
            totalRequests,
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            avgTokensPerRequest: totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0,
            avgInputPerRequest: totalRequests > 0 ? Math.round(totalInput / totalRequests) : 0,
            avgOutputPerRequest: totalRequests > 0 ? Math.round(totalOutput / totalRequests) : 0,
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

async function fetchAIAnalytics(tenantId: string, daysParam: string | number) {
    const isMtd = String(daysParam).toLowerCase() === "mtd" || String(daysParam).toLowerCase() === "month";
    const currentMonthDay = new Date().getDate();
    const daysNumber = isMtd ? currentMonthDay : (parseInt(String(daysParam), 10) || 30);
    const daysForQuery = Math.max(daysNumber, 30);
    const liveAiMtdTotal = await getLiveAiMtdTotal(tenantId);

    // 1) Fuente primaria: AICostSnapshots — uso real por modelo (tokens) de
    //    Microsoft Foundry / Azure OpenAI sincronizado desde Azure Monitor Metrics.
    let aiRows: AggRow[] = [];
    const queryAiSnapshots = async () => {
        try {
            const [rows]: any = await pool.query(
                `SELECT
                    COALESCE(NULLIF(model_name, ''), 'unknown') AS model_name,
                    COALESCE(NULLIF(application, ''), NULLIF(resource_name, ''), 'unknown') AS application,
                    COALESCE(NULLIF(team, ''), 'Sin asignar') AS team,
                    date,
                    SUM(COALESCE(NULLIF(billed_cost, 0), effective_cost, 0)) AS cost,
                    SUM(COALESCE(request_count, 0)) AS requestCount,
                    SUM(input_tokens) AS inputTokens,
                    SUM(output_tokens) AS outputTokens
                 FROM AICostSnapshots
                 WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY COALESCE(NULLIF(model_name, ''), 'unknown'), COALESCE(NULLIF(application, ''), NULLIF(resource_name, ''), 'unknown'), COALESCE(NULLIF(team, ''), 'Sin asignar'), date
                 ORDER BY date ASC`,
                [tenantId, daysForQuery]
            );
            return rows as AggRow[];
        } catch (err) {
            const msg = String(errorMessage(err) || "");
            if (!msg.toLowerCase().includes("unknown column 'request_count'")) throw err;
            const [rows]: any = await pool.query(
                `SELECT
                    COALESCE(NULLIF(model_name, ''), 'unknown') AS model_name,
                    COALESCE(NULLIF(application, ''), NULLIF(resource_name, ''), 'unknown') AS application,
                    COALESCE(NULLIF(team, ''), 'Sin asignar') AS team,
                    date,
                    SUM(COALESCE(NULLIF(billed_cost, 0), effective_cost, 0)) AS cost,
                    0 AS requestCount,
                    SUM(input_tokens) AS inputTokens,
                    SUM(output_tokens) AS outputTokens
                 FROM AICostSnapshots
                 WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY COALESCE(NULLIF(model_name, ''), 'unknown'), COALESCE(NULLIF(application, ''), NULLIF(resource_name, ''), 'unknown'), COALESCE(NULLIF(team, ''), 'Sin asignar'), date
                 ORDER BY date ASC`,
                [tenantId, daysForQuery]
            );
            return rows as AggRow[];
        }
    };

    aiRows = await queryAiSnapshots();

    // Si la tabla no tiene datos o tiene muy pocas muestras para el período solicitado,
    // consultar Azure Monitor Metrics en vivo para obtener los datos históricos de hasta 30 días.
    if (!aiRows || aiRows.length === 0 || (daysNumber >= 7 && aiRows.length < 3)) {
        try {
            const historicalRows = await getHistoricalAIUsage(tenantId, Math.max(daysForQuery, 30));
            if (historicalRows && historicalRows.length > 0) {
                for (const row of historicalRows) {
                    await insertAICostSnapshotRow(tenantId, row.date, row);
                }
                aiRows = await queryAiSnapshots();
            }
        } catch (histErr) {
            console.warn(`[ai-analytics] Live historical AI usage sync warning for tenant=${tenantId}:`, errorMessage(histErr));
        }
    }

    // 2) Fallback / reconciliación con CostMeterSnapshots (filas a nivel meter)
    const [meterRows]: any = await pool.query(
        `SELECT
            COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name) AS model_name,
            COALESCE(NULLIF(subscription_id, ''), 'unknown-subscription') AS application,
            'Sin asignar' AS team,
            date,
            SUM(cost_usd) AS cost,
            0 AS requestCount,
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
         GROUP BY COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name), 
                  COALESCE(NULLIF(subscription_id, ''), 'unknown-subscription'),
                  MeterSubCategory, MeterName, service_name, date
         ORDER BY date ASC`,
        [tenantId, daysForQuery]
    );

    if (aiRows && aiRows.length > 0) {
        const hasMeterRows = Array.isArray(meterRows) && meterRows.length > 0;
        const effectiveAiRows = hasMeterRows
            ? reconcileAiRowsWithMeterCost(aiRows as AggRow[], meterRows as AggRow[])
            : (aiRows as AggRow[]);
        
        const periodRows = isMtd
            ? filterRowsByCurrentMonth(effectiveAiRows)
            : filterRowsByDays(effectiveAiRows, daysNumber);

        const periodAgg = aggregate(periodRows, true);
        const mtdRows = filterRowsByCurrentMonth(effectiveAiRows);
        const mtdAgg = aggregate(mtdRows, true);

        return {
            ...periodAgg,
            mtdSummary: mtdAgg.summary,
            trendMtd: buildTrendMtd(effectiveAiRows),
            source: hasMeterRows
                ? "ai-snapshots-reconciled-with-meter"
                : "ai-snapshots",
        };
    }

    if (meterRows && meterRows.length > 0) {
        const effectiveMeterRows = scaleRowsToLiveMonthTotal(meterRows as AggRow[], liveAiMtdTotal);
        const periodRows = isMtd
            ? filterRowsByCurrentMonth(effectiveMeterRows)
            : filterRowsByDays(effectiveMeterRows, daysNumber);

        const periodAgg = aggregate(periodRows, false);
        const mtdRows = filterRowsByCurrentMonth(effectiveMeterRows);
        const mtdAgg = aggregate(mtdRows, false);

        return {
            ...periodAgg,
            mtdSummary: mtdAgg.summary,
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
            0 AS requestCount,
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
    const periodRows = isMtd
        ? filterRowsByCurrentMonth(effectiveCostRows)
        : filterRowsByDays(effectiveCostRows, daysNumber);

    const periodAgg = aggregate(periodRows, false);
    const mtdRows = filterRowsByCurrentMonth(effectiveCostRows);
    const mtdAgg = aggregate(mtdRows, false);

    return {
        ...periodAgg,
        mtdSummary: mtdAgg.summary,
        trendMtd: buildTrendMtd(effectiveCostRows),
        source: liveAiMtdTotal ? "cost-snapshots-fallback-live-anchored" : "cost-snapshots-fallback",
    };
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const daysParam = searchParams.get("days") || "30";

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

            const bust = searchParams.get("bust") === "1" || searchParams.get("force") === "1";
            const cacheKey = `ai-analytics:v12:${tenantId}:${daysParam}`;

            if (bust) {
                const freshPayload = await fetchAIAnalytics(tenantId, daysParam);
                return NextResponse.json(freshPayload);
            }

            const payload = await getWithStaleWhileRevalidate(
                cacheKey,
                () => fetchAIAnalytics(tenantId, daysParam),
                1800,
                300,
                (data) => (data.summary === null ? 60 : 1800)
            );

            return NextResponse.json(payload);
        } catch (dbErr) {
            console.error("AI Analytics DB error for real tenant:", tenantId, errorMessage(dbErr));
            return NextResponse.json({
                success: false, mock: false,
                summary: { totalCost: 0, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, avgTokensPerRequest: 0, avgInputPerRequest: 0, avgOutputPerRequest: 0, costPer1kTokens: 0, activeModels: 0, activeApplications: 0 },
                byModel: [], byApplication: [], byTeam: [], trend: [],
                error: `Sin datos disponibles: ${errorMessage(dbErr) || "error"}`,
            });
        }
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("AI Analytics API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
