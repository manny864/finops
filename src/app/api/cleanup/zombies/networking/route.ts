import { NextRequest, NextResponse } from "next/server";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";
import { runGraphAudits } from "@/services/auditService";
import { getMonthlyCostEstimate } from "@/services/pricingService";

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
            // Networking Zombies es feature Professional (ver Sidebar).
            await requireTenantTier(request, tenantId, 'Professional');
            await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(MOCK_PAYLOAD);
        }

        // Detección en vivo: reutiliza runGraphAudits (el mismo motor que
        // alimenta /api/audit/full y el resto del módulo de Limpieza), que ya
        // ejecuta las queries `unusedLoadBalancers` y `unusedAppGateways` del
        // catálogo KQL (src/modules/core/kqlCatalog.ts) — estaban definidas y
        // se corrían en cada audit, pero ningún endpoint las leía todavía.
        // Se cachea (auditService) junto con el resto del audit, así este
        // endpoint no dispara llamadas extra a Resource Graph.
        const subscriptionId = searchParams.get("subscriptionId") || undefined;
        const credential = await getAzureCredential(tenantId);
        const resourceGraphClient = new ResourceGraphClient(credential);
        const graphResults = await runGraphAudits(resourceGraphClient, credential, subscriptionId);

        const items: Array<{
            resourceId: string; resourceName: string; resourceType: string;
            resourceGroup: string; subscriptionId: string; monthlyCost: number;
            reason: string; daysIdle: number;
        }> = [];

        const unusedLoadBalancers = (graphResults as any)?.unusedLoadBalancers as any[] | undefined;
        for (const lb of unusedLoadBalancers || []) {
            items.push({
                resourceId: lb.id,
                resourceName: lb.name,
                resourceType: "loadBalancer",
                resourceGroup: lb.resourceGroup,
                subscriptionId: lb.subscriptionId,
                monthlyCost: 18.0, // Standard LB base, sin reglas de balanceo activas.
                reason: "Sin frontend IP configurado o sin backend pool asociado",
                daysIdle: 30,
            });
        }

        const unusedAppGateways = (graphResults as any)?.unusedAppGateways as any[] | undefined;
        for (const agw of unusedAppGateways || []) {
            const sku = agw.sku || "Standard_v2";
            const loc = agw.location || "eastus";
            let cost = await getMonthlyCostEstimate("Application Gateway", sku, loc).catch(() => 0);
            if (!cost) cost = 125.0; // Piso Standard_v2 (1 capacity unit) si no hay match en pricingService.
            items.push({
                resourceId: agw.id,
                resourceName: agw.name,
                resourceType: "applicationGateway",
                resourceGroup: agw.resourceGroup,
                subscriptionId: agw.subscriptionId,
                monthlyCost: cost,
                reason: "Sin backend pools o reglas de ruteo configuradas",
                daysIdle: 30,
            });
        }

        const totalMonthlyWaste = Number(items.reduce((sum, i) => sum + i.monthlyCost, 0).toFixed(2));

        return NextResponse.json({ success: true, mock: false, items, totalMonthlyWaste });
    } catch (err: unknown) {
        console.error("[zombies/networking] error:", err instanceof Error ? err.message : err);
        const code = (err as any)?.code;
        if (code === "AccessDenied") {
            return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
        }
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
