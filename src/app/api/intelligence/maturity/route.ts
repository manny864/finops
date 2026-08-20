import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  generateMockMaturityData,
  getLiveMaturityData,
} from "@/services/azureMaturity.service";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const tenantId = searchParams.get('tenantId');
    const forceMock = searchParams.get('mock') === 'true';

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    // 1. ORDEN CRÍTICO: isMockTenant DEBE evaluarse ANTES de requireTenantAccess
    if (forceMock || isMockTenant(tenantId)) {
      const data = generateMockMaturityData();
      return NextResponse.json(data);
    }

    // 2. Tenant Real: Validación obligatoria de RBAC
    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    // 3. Consulta en vivo sin fallbacks mock
    const payload = await getLiveMaturityData(tenantId);
    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Maturity API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, assessmentData } = body;

        if (!tenantId || !assessmentData) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId y assessmentData" }, { status: 400 });
        }

        const isMock = isMockTenant(tenantId);
        let identityEmail = "demo@cscloudsolutions.com.ar";

        if (!isMock) {
            const identity = await requireTenantAccess(request, tenantId);
            identityEmail = identity.email || 'system@maturity';
        }

        let totalScore = 0;
        let maxScore = 0;
        
        if (Array.isArray(assessmentData)) {
            assessmentData.forEach((item: any) => {
                totalScore += (item.score || 0);
                maxScore += 100;
            });
        }

        const finalScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
        
        let level = 'Crawl';
        if (finalScore >= 40 && finalScore <= 75) level = 'Walk';
        if (finalScore > 75) level = 'Run';

        try {
            await pool.query(
                `INSERT INTO MaturityAssessments (tenant_id, score, level, assessment_data) VALUES (?, ?, ?, ?)`,
                [tenantId, finalScore, level, JSON.stringify(assessmentData)]
            );

            await pool.query(
                `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, resource_type, status, details, user_email) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [tenantId, 'MaturityAssessmentCompleted', 'Tenant', 'Assessment', 'Success', JSON.stringify({ finalScore, level }), identityEmail]
            );
        } catch {
            // Continuar si la BD no está configurada en entorno local
        }

        return NextResponse.json({ 
            success: true, 
            score: finalScore,
            level
        });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Maturity Assessment API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
