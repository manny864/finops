import { NextRequest, NextResponse } from 'next/server';
import { getAssessment } from '@/modules/core/aiProvider';
import pool from '@/modules/storage/db';
import { RowDataPacket } from 'mysql2';
import { requireTenantAccess, AuthError } from '@/lib/requestAuth';

export async function POST(request: NextRequest) {
    try {
        const { tenantId, metricsData } = await request.json();

        if (!tenantId) {
            return NextResponse.json({ error: "Tenant ID is required" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

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
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Error generating AI report:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
