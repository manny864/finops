import { NextRequest, NextResponse } from 'next/server';
import { getAssessment } from '@/modules/core/aiProvider';
import pool from '@/modules/storage/db';
import { RowDataPacket } from 'mysql2';
import jwt from 'jsonwebtoken';

export async function POST(request: NextRequest) {
    try {
        // Auth validation
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const { tenantId, metricsData } = await request.json();

        if (!tenantId) {
            return NextResponse.json({ error: "Tenant ID is required" }, { status: 400 });
        }

        // SuperAdmin check for cross-tenant access
        const email = decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") ;

        if (decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

        // Validate tenant exists
        const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM Tenants WHERE tenant_id = ?', [tenantId]);
        if (rows.length === 0) {
            return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
        }

        // Consultaremos recomendaciones de ahorro
        const [recommendations] = await pool.query<RowDataPacket[]>(
            'SELECT recommendation_type, potential_savings, snapshot_date FROM RecommendationsCache WHERE tenant_id = ? ORDER BY snapshot_date DESC LIMIT 50', 
            [tenantId]
        );

        // Consultaremos el presupuesto de este mes
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        const [budgets] = await pool.query<RowDataPacket[]>(
            'SELECT budget_usd, alert_threshold FROM TenantMonthlyBudgets WHERE tenant_id = ? AND budget_month = ? AND budget_year = ?', 
            [tenantId, currentMonth, currentYear]
        );

        const enrichedMetrics = {
            ...metricsData,
            activeRecommendations: recommendations,
            currentBudget: budgets.length > 0 ? budgets[0] : null
        };

        const report = await getAssessment(enrichedMetrics);

        return NextResponse.json({ report });
    } catch (error: any) {
        console.error("Error generating AI report:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
