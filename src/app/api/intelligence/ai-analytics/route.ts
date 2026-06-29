import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant } from "@/lib/mockData";
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

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const days = parseInt(searchParams.get("days") || "30", 10);

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro: tenantId" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
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

            const [rows]: any = await pool.query(
                `SELECT
                    model_name,
                    application,
                    team,
                    date,
                    SUM(billed_cost) AS cost,
                    SUM(input_tokens) AS inputTokens,
                    SUM(output_tokens) AS outputTokens
                 FROM AICostSnapshots
                 WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY model_name, application, team, date
                 ORDER BY date ASC`,
                [tenantId, days]
            );

            if (!rows || rows.length === 0) {
                return NextResponse.json({ success: true, mock: false, summary: null, byModel: [], byApplication: [], byTeam: [], trend: [] });
            }

            // Aggregate byModel
            const modelMap = new Map<string, { model: string; cost: number; inputTokens: number; outputTokens: number }>();
            const appMap = new Map<string, { application: string; cost: number; model: string }>();
            const teamMap = new Map<string, { team: string; cost: number }>();
            const trendMap = new Map<string, { date: string; cost: number; inputTokens: number; outputTokens: number }>();

            let totalCost = 0, totalInput = 0, totalOutput = 0;

            for (const r of rows) {
                const cost = Number(r.cost);
                const inp = Number(r.inputTokens);
                const out = Number(r.outputTokens);
                totalCost += cost;
                totalInput += inp;
                totalOutput += out;

                // byModel
                const mKey = r.model_name || "unknown";
                const mEntry = modelMap.get(mKey) || { model: mKey, cost: 0, inputTokens: 0, outputTokens: 0 };
                mEntry.cost += cost;
                mEntry.inputTokens += inp;
                mEntry.outputTokens += out;
                modelMap.set(mKey, mEntry);

                // byApplication
                const aKey = r.application || "unknown";
                const aEntry = appMap.get(aKey) || { application: aKey, cost: 0, model: mKey };
                aEntry.cost += cost;
                appMap.set(aKey, aEntry);

                // byTeam
                const tKey = r.team || "unknown";
                const tEntry = teamMap.get(tKey) || { team: tKey, cost: 0 };
                tEntry.cost += cost;
                teamMap.set(tKey, tEntry);

                // trend
                const dKey = String(r.date).substring(0, 10);
                const dEntry = trendMap.get(dKey) || { date: dKey, cost: 0, inputTokens: 0, outputTokens: 0 };
                dEntry.cost += cost;
                dEntry.inputTokens += inp;
                dEntry.outputTokens += out;
                trendMap.set(dKey, dEntry);
            }

            const byModel = Array.from(modelMap.values()).map(m => ({
                ...m,
                costPer1k: m.inputTokens + m.outputTokens > 0
                    ? (m.cost / (m.inputTokens + m.outputTokens)) * 1000
                    : 0,
            })).sort((a, b) => b.cost - a.cost);

            const totalTokens = totalInput + totalOutput;

            return NextResponse.json({
                success: true,
                mock: false,
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
            });
        } catch (dbErr) {
            console.error("AI Analytics DB error — returning mock:", dbErr);
            return NextResponse.json(MOCK_PAYLOAD);
        }
    } catch (error: any) {
        console.error("AI Analytics API Error:", error);
        return NextResponse.json({ error: "Error al obtener AI Analytics.", details: error.message }, { status: 500 });
    }
}
