import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

const MOCK_PAYLOAD = {
    success: true,
    mock: true,
    items: [
        {
            resourceId: "/subscriptions/sub-1/resourceGroups/rg-network/providers/Microsoft.Network/applicationGateways/agw-prod",
            resourceName: "agw-prod",
            resourceType: "applicationGateway",
            resourceGroup: "rg-network",
            subscriptionId: "sub-1",
            monthlyCost: 420.00,
            reason: "No backend addresses configured",
            daysIdle: 45,
        },
        {
            resourceId: "/subscriptions/sub-2/resourceGroups/rg-shared/providers/Microsoft.Network/loadBalancers/lb-internal",
            resourceName: "lb-internal",
            resourceType: "loadBalancer",
            resourceGroup: "rg-shared",
            subscriptionId: "sub-2",
            monthlyCost: 18.25,
            reason: "Zero traffic in 30 days",
            daysIdle: 60,
        },
    ],
    totalMonthlyWaste: 438.25,
};

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        try {
            await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(MOCK_PAYLOAD);
        }

        // ARG integration pending para tenants reales. NO devolver mocks; lista vacía
        // con flag explícito así el frontend muestra estado "sin datos".
        return NextResponse.json({
            success: true, mock: false,
            items: [], totalMonthlyWaste: 0,
            warning: "Detección en vivo de zombies de red pendiente de implementación. Usá el módulo principal de Audit para resultados consolidados.",
        });
    } catch (err: unknown) {
        console.error("[zombies/networking] error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
