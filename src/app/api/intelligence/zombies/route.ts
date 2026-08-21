import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { AzureZombieHuntingService } from "@/services/azureZombieHunting.service";
import type { FinancialLeaksApiResponse } from "@/types/financialLeaks.types";

export async function GET(request: NextRequest): Promise<NextResponse<FinancialLeaksApiResponse>> {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId") || "default";
        const subscriptionId = searchParams.get("subscriptionId");
        const tier = searchParams.get("tier") || "Enterprise";

        // 1. Check Mock / Demo First (Prioridad Absoluta)
        if (isMockTenant(tenantId) || searchParams.get("mock") === "true") {
            const mockData = AzureZombieHuntingService.getMockFinancialLeaks(tier);
            return NextResponse.json({
                success: true,
                data: mockData,
                mock: true,
                tenantId,
            });
        }

        // 2. Real Tenant Access Validation
        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        // 3. Query Live Azure Resource Graph
        const summary = await AzureZombieHuntingService.getFinancialLeaksSummary(
            tenantId,
            subscriptionId,
            tier
        );

        return NextResponse.json({
            success: true,
            data: summary,
            mock: false,
            tenantId,
        });
    } catch (error: any) {
        if (error instanceof AuthError) {
            return NextResponse.json(
                {
                    success: false,
                    data: {
                        totalMonthlyLeakUSD: 0,
                        totalAffectedResources: 0,
                        breakdownByCategory: [],
                        resources: [],
                    },
                    error: error.message,
                },
                { status: error.status }
            );
        }

        console.error("[GET /api/intelligence/zombies] Error:", error?.message || error);
        return NextResponse.json(
            {
                success: false,
                data: {
                    totalMonthlyLeakUSD: 0,
                    totalAffectedResources: 0,
                    breakdownByCategory: [],
                    resources: [],
                },
                error: error?.message || "Error al procesar la auditoría de fugas financieras y recursos zombis",
            },
            { status: 500 }
        );
    }
}
