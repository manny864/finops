import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        
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
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        const [rows] = await pool.query(
            "SELECT * FROM CostCenterBudgets WHERE tenant_id = ?",
            [tenantId]
        );

        return NextResponse.json({ budgets: rows });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, costCenterName, monthlyBudgetUsd } = body;

        if (!tenantId || !costCenterName || monthlyBudgetUsd === undefined) {
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
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        await pool.query(
            `INSERT INTO CostCenterBudgets (tenant_id, cost_center_name, monthly_budget_usd) 
             VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE monthly_budget_usd = ?`,
            [tenantId, costCenterName, monthlyBudgetUsd, monthlyBudgetUsd]
        );

        return NextResponse.json({ success: true, message: "Presupuesto guardado" });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
