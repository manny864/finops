import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import db from "@/modules/storage/db";
import jwt from "jsonwebtoken";

// GET Historical data dynamically from Azure Advisor Score History
export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token de autenticación" }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido" }, { status: 401 });
        }

        const tenantId = decoded.tid;
        const locale = request.headers.get('accept-language') || 'es';

        // 1. Obtener Credenciales y Token de Azure
        const credential = await getAzureCredential(tenantId);
        const tokenResponse = await credential.getToken("https://management.azure.com/.default");

        // 2. Obtener Suscripciones del Tenant
        const fetchRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
            headers: { "Authorization": `Bearer ${tokenResponse.token}`, "Accept-Language": locale }
        });
        
        let subs: any[] = [];
        if (fetchRes.ok) {
            const data = await fetchRes.json();
            for (const sub of data.value) {
                if (sub.subscriptionId && sub.state === 'Enabled') {
                    subs.push({ id: sub.subscriptionId, name: sub.displayName });
                }
            }
        }

        // 3. Consultar Historial de Score de Costo de cada Suscripción
        const historyMap: Record<string, { date: string, totalScore: number, count: number, totalImpacted: number, totalPotentialIncrease: number }> = {};

        for (const sub of subs) {
            try {
                const scoreRes = await fetch(`https://management.azure.com/subscriptions/${sub.id}/providers/Microsoft.Advisor/advisorScore?api-version=2023-01-01`, {
                    headers: { "Authorization": `Bearer ${tokenResponse.token}`, "Accept-Language": locale }
                });
                if (scoreRes.ok) {
                    const scoreData = await scoreRes.json();
                    const costScore = (scoreData.value || []).find((item: any) => item.name === "Cost");
                    if (costScore && costScore.properties?.timeSeries) {
                        // Buscamos la agregación Weekly o Daily que contenga datos
                        const timeSeries = costScore.properties.timeSeries.find((ts: any) => ts.scoreHistory && ts.scoreHistory.length > 0);
                        if (timeSeries) {
                            for (const point of timeSeries.scoreHistory) {
                                const dateStr = point.date.split("T")[0];
                                if (!historyMap[dateStr]) {
                                    historyMap[dateStr] = { date: dateStr, totalScore: 0, count: 0, totalImpacted: 0, totalPotentialIncrease: 0 };
                                }
                                historyMap[dateStr].totalScore += point.score;
                                historyMap[dateStr].count += 1;
                                historyMap[dateStr].totalImpacted += point.impactedResourceCount || 0;
                                historyMap[dateStr].totalPotentialIncrease += point.potentialScoreIncrease || 0;
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn(`Error reading historical scores for sub ${sub.id}:`, err);
            }
        }

        // 4. Consolidar y ordenar cronológicamente
        const aggregatedData = Object.values(historyMap)
            .map(item => ({
                scan_date: item.date,
                score: parseFloat((item.totalScore / item.count).toFixed(1)),
                impacted_resources: item.totalImpacted,
                potential_score_increase: parseFloat(item.totalPotentialIncrease.toFixed(1))
            }))
            .sort((a, b) => a.scan_date.localeCompare(b.scan_date));

        return NextResponse.json({ data: aggregatedData });

    } catch (error: any) {
        console.error("History API Error:", error);
        return NextResponse.json({ error: "Fallo al obtener el historial", details: error.message }, { status: 500 });
    }
}

// POST new record (Triggered by automated scanner)
export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token de autenticación" }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido" }, { status: 401 });
        }

        const tenantId = decoded.tid;
        const body = await request.json();
        
        if (body.total_wasted_usd === undefined || body.potential_savings_usd === undefined) {
            return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
        }

        const today = new Date().toISOString().split('T')[0];

        // Insert or update for the day
        await db.query(
            `INSERT INTO SavingsHistory (tenant_id, scan_date, total_wasted_usd, potential_savings_usd) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE total_wasted_usd = VALUES(total_wasted_usd), potential_savings_usd = VALUES(potential_savings_usd)`,
            [tenantId, today, body.total_wasted_usd, body.potential_savings_usd]
        );

        return NextResponse.json({ success: true, message: "Registro guardado exitosamente." });

    } catch (error: any) {
        console.error("History POST API Error:", error);
        return NextResponse.json({ error: "Fallo al guardar el registro histórico", details: error.message }, { status: 500 });
    }
}
