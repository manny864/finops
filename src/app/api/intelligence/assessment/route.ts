import { NextRequest, NextResponse } from 'next/server';
import { getAssessment } from '@/modules/core/aiProvider';
import { requireTenantAccess, AuthError } from '@/lib/requestAuth';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, metrics } = body;

        if (!tenantId || !metrics) {
            return NextResponse.json({ error: "Faltan parámetros (tenantId, metrics)" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        const markdownReport = await getAssessment(metrics);

        return NextResponse.json({ success: true, report: markdownReport });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Error in /api/intelligence/assessment:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
