import { NextRequest, NextResponse } from 'next/server';
import { getLicenseOptimizationData } from '@/services/azureLicenseOptimization.service';
import { requireTenantAccess, AuthError } from '@/lib/requestAuth';
import { isMockTenant, getMockDataForRoute } from '@/lib/mockData';
import { getWithStaleWhileRevalidate } from '@/lib/cache';
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');

        if (!tenantId || tenantId === 'default') {
            return NextResponse.json({ error: 'Faltan credenciales del entorno' }, { status: 400 });
        }

        // CRITICAL: isMockTenant check BEFORE requireTenantAccess (directiva #1)
        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('licenses', tenantId));
        }

        await requireTenantAccess(request, tenantId);

        const data = await getWithStaleWhileRevalidate(
            `intelligence:licenses:v2:${tenantId}`,
            () => fetchLicenses(tenantId),
            1800,
            600,
            (d: any) => (d.graphError ? 120 : 1800)
        );
        return NextResponse.json({ success: true, data });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        console.error("License API error:", error);
        return NextResponse.json({ success: false, error: errorMessage(error) || 'Error del servidor' }, { status: 500 });
    }
}

async function fetchLicenses(tenantId: string) {
    let graphError: string | null = null;
    let needsConsent = false;

    try {
        const result = await getLicenseOptimizationData(tenantId);
        return {
            summary: result.summary,
            ahubResources: result.ahubResources,
            skuOptimizations: result.skuOptimizations,
            graphError: null,
            needsConsent: false,
        };
    } catch (error) {
        console.warn("License optimization query failed for tenant:", tenantId, errorMessage(error));
        const errMsg = errorMessage(error) || 'Permisos insuficientes en Microsoft Graph.';
        graphError = errMsg;
        if (errMsg.includes('403')) needsConsent = true;

        return {
            summary: {
                totalPaidLicenses: 0, totalAssigned: 0, totalUnassigned: 0,
                totalInactiveLicenses: 0, totalAhubSavingsUSD: 0, totalM365WastedUSD: 0,
                ahubResourceCount: 0, skuCount: 0,
            },
            ahubResources: [],
            skuOptimizations: [],
            graphError,
            needsConsent,
        };
    }
}

