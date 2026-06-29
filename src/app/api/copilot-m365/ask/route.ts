// Real-data implementation: para tenants reales consulta CostSnapshots de los
// últimos 30 días y genera respuesta con datos efectivos. Para tenants DEMO/mock
// devuelve respuesta sintética claramente marcada.

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

function authCheck(request: NextRequest, tenantId: string) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return { error: "Falta token Bearer de autenticación.", status: 401 };
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as Record<string, any> | null;
    if (!decoded || !decoded.tid) {
        return { error: "Estructura de token inválida.", status: 401 };
    }
    const email: string =
        decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
    const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");
    if (decoded.tid !== tenantId && !isAdmin) {
        return { error: "Acceso denegado. El token no coincide con el tenant.", status: 403 };
    }
    return { decoded, email };
}

function fmtUSD(n: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
}

async function buildRealAnswer(tenantId: string, question: string) {
    // Totales últimos 30 días
    const [totalsRows]: any = await pool.query(
        `SELECT ROUND(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 2) AS total,
                COUNT(DISTINCT date) AS days
           FROM CostSnapshots
          WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
        [tenantId]
    );
    const totalCost = Number(totalsRows?.[0]?.total || 0);
    const daysCovered = Number(totalsRows?.[0]?.days || 0);

    // Top 5 servicios
    const [topRows]: any = await pool.query(
        `SELECT service_name AS service,
                ROUND(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 2) AS cost
           FROM CostSnapshots
          WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          GROUP BY service_name
          ORDER BY cost DESC
          LIMIT 5`,
        [tenantId]
    );
    const top: Array<{ service: string; cost: number }> = (topRows || []).map((r: any) => ({
        service: String(r.service || 'unknown'),
        cost: Number(r.cost || 0),
    }));

    // Anomalías del mes (si la tabla existe)
    let anomalyCount = 0;
    try {
        const [anomRows]: any = await pool.query(
            `SELECT COUNT(*) AS c FROM Anomalies WHERE tenant_id = ? AND detected_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
            [tenantId]
        );
        anomalyCount = Number(anomRows?.[0]?.c || 0);
    } catch { /* tabla puede no existir */ }

    // Construcción de respuesta narrativa
    if (totalCost === 0 && top.length === 0) {
        return {
            answer: `No se encontraron datos de costos en los últimos 30 días para este tenant. Verifique que la sincronización de billing esté activa y que el Service Principal tenga acceso a Cost Management.`,
            adaptiveCard: null,
            grounding: { totalCost: 0, daysCovered: 0, topServices: [], anomalies: 0 }
        };
    }

    const topText = top.length > 0
        ? top.map((s, i) => `${i + 1}. ${s.service} (${fmtUSD(s.cost)})`).join(' · ')
        : 'n/d';

    const answer =
        `En los últimos ${daysCovered} días el costo total fue de ${fmtUSD(totalCost)}. ` +
        `Top servicios: ${topText}. ` +
        (anomalyCount > 0 ? `Se detectaron ${anomalyCount} anomalías de costo en el período.` : `Sin anomalías de costo detectadas en el período.`);

    const adaptiveCard = {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
            { type: "TextBlock", text: `FinOps Summary (${daysCovered}d)`, weight: "Bolder", size: "Large" },
            { type: "TextBlock", text: `Total Cost: ${fmtUSD(totalCost)}`, spacing: "Medium" },
            {
                type: "FactSet",
                facts: top.map(s => ({ title: s.service, value: fmtUSD(s.cost) })),
            },
            ...(anomalyCount > 0
                ? [{ type: "TextBlock", text: `⚠️ ${anomalyCount} cost anomalies detected`, color: "Warning" }]
                : []),
        ],
    };

    return {
        answer,
        adaptiveCard,
        grounding: { totalCost, daysCovered, topServices: top, anomalies: anomalyCount }
    };
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, question } = body ?? {};

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (!question || typeof question !== "string" || !question.trim()) {
            return NextResponse.json({ error: "Falta la pregunta (question)" }, { status: 400 });
        }

        const auth = authCheck(request, tenantId);
        if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

        // Tenants DEMO: respuesta sintética claramente marcada
        if (isMockTenant(tenantId)) {
            const mockAnswer =
                "[DEMO] En los últimos 30 días el costo simulado fue de $42,520 USD. " +
                "Top 3 servicios (simulados): Virtual Machines ($18,200), Storage ($8,300), SQL Database ($5,100). " +
                "Detectamos 2 anomalías de costo y 1 alerta de presupuesto activa. " +
                "NOTA: estos valores son ejemplos del entorno DEMO; en un tenant real provienen de Cost Management.";

            const adaptiveCard = {
                type: "AdaptiveCard",
                version: "1.5",
                body: [
                    { type: "TextBlock", text: "FinOps Summary (30d) — DEMO", weight: "Bolder", size: "Large" },
                    { type: "TextBlock", text: "Total Cost (simulado): $42,520 USD", spacing: "Medium" },
                    {
                        type: "FactSet",
                        facts: [
                            { title: "Virtual Machines", value: "$18,200" },
                            { title: "Storage", value: "$8,300" },
                            { title: "SQL Database", value: "$5,100" },
                        ],
                    },
                    { type: "TextBlock", text: "⚠️ 2 cost anomalies detected (demo)", color: "Warning" },
                ],
            };

            return NextResponse.json({
                success: true,
                mock: true,
                question,
                answer: mockAnswer,
                adaptiveCard,
            });
        }

        // Tenant real: datos efectivos desde CostSnapshots
        const { answer, adaptiveCard, grounding } = await buildRealAnswer(tenantId, question);
        return NextResponse.json({
            success: true,
            mock: false,
            question,
            answer,
            adaptiveCard,
            grounding,
        });
    } catch (error: any) {
        console.error("M365 Copilot Ask error:", error);
        return NextResponse.json({ error: "Error al procesar la pregunta", details: error.message }, { status: 500 });
    }
}
