import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import jwt from "jsonwebtoken";
import { getBudgetConsumption } from "@/services/budgetService";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        let tenantId = url.searchParams.get("tenantId");
        const subscriptionId = url.searchParams.get("subscriptionId") || "All";
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        // QA Security Patch: IDOR Prevention
        if (!isAdmin) {
            tenantId = decoded.tid; // Forzar uso del tenant verificado
        } else if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        const [rows]: any = await pool.query(
            "SELECT * FROM Budgets WHERE tenant_id = ?",
            [tenantId]
        );

        // Fetch current consumption for each budget
        const budgetsWithUtilization = await Promise.all(rows.map(async (b: any) => {
            const currentSpend = await getBudgetConsumption(tenantId!, subscriptionId, b.cost_center_tag_value);
            const limit = parseFloat(b.monthly_limit_usd);
            
            // QA Patch: Zero-division prevention
            const utilization = limit > 0 ? (currentSpend / limit) * 100 : 0;
            
            return {
                id: b.id,
                costCenter: b.cost_center_tag_value,
                monthlyLimit: limit,
                alertThreshold: parseFloat(b.alert_threshold),
                currentSpend: currentSpend,
                utilization: utilization
            };
        }));

        return NextResponse.json({ budgets: budgetsWithUtilization });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        let { tenantId, costCenter, monthlyLimit, alertThreshold = 80.00 } = body;

        if (!tenantId || !costCenter || monthlyLimit === undefined) {
            return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        // QA Security Patch: IDOR Prevention
        if (!isAdmin) {
            tenantId = decoded.tid; // Forzar uso del tenant verificado
        } else if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        await pool.query(
            `INSERT INTO Budgets (tenant_id, cost_center_tag_value, monthly_limit_usd, alert_threshold) 
             VALUES (?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE monthly_limit_usd = ?, alert_threshold = ?`,
            [tenantId, costCenter, monthlyLimit, alertThreshold, monthlyLimit, alertThreshold]
        );

        return NextResponse.json({ success: true, message: "Presupuesto guardado" });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
