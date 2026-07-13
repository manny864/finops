import { NextRequest, NextResponse } from "next/server";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";
import { runGraphAudits } from "@/services/auditService";
import { getMonthlyCostEstimate } from "@/services/pricingService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

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
            return NextResponse.json(getMockDataForRoute('networking_zombies', tenantId));
        }

        // Detección en vivo: reutiliza runGraphAudits (el mismo motor que
        // alimenta /api/audit/full y el resto del módulo de Limpieza), que ya
        // ejecuta las queries `unusedLoadBalancers` y `unusedAppGateways` del
        // catálogo KQL (src/modules/core/kqlCatalog.ts) — estaban definidas y
        // se corrían en cada audit, pero ningún endpoint las leía todavía.
        // Se cachea (auditService) junto con el resto del audit, así este
        // endpoint no dispara llamadas extra a Resource Graph.
        const subscriptionId = searchParams.get("subscriptionId") || undefined;
        const cacheKey = `cleanup:zombies-networking:v1:${tenantId}:${subscriptionId || 'all'}`;
        const payload = await getWithStaleWhileRevalidate(cacheKey, () => fetchNetworkingZombies(tenantId, subscriptionId), 1800, 600);
        return NextResponse.json({ success: true, mock: false, ...payload });
    } catch (err: unknown) {
        console.error("[zombies/networking] error:", err instanceof Error ? err.message : err);
        const code = (err as any)?.code;
        if (code === "AccessDenied") {
            return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
        }
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

async function fetchNetworkingZombies(tenantId: string, subscriptionId: string | undefined) {
        const credential = await getAzureCredential(tenantId);
        const resourceGraphClient = new ResourceGraphClient(credential);
        const graphResults = await runGraphAudits(resourceGraphClient, credential, subscriptionId);

        const items: Array<{
            resourceId: string; resourceName: string; resourceType: string; armType: string;
            resourceGroup: string; subscriptionId: string; monthlyCost: number;
            reason: string; daysIdle: number;
        }> = [];

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
                armType: "Microsoft.Network/applicationGateways",
                resourceGroup: agw.resourceGroup,
                subscriptionId: agw.subscriptionId,
                monthlyCost: cost,
                reason: "Sin backend pools o reglas de ruteo configuradas",
                daysIdle: 30,
            });
        }

        // Bastion: sin telemetría de sesiones vía Resource Graph, se estima por SKU.
        const allBastionHosts = (graphResults as any)?.allBastionHosts as any[] | undefined;
        for (const b of allBastionHosts || []) {
            const sku = String(b.sku || "Basic");
            items.push({
                resourceId: b.id,
                resourceName: b.name,
                resourceType: "bastionHost",
                armType: "Microsoft.Network/bastionHosts",
                resourceGroup: b.resourceGroup,
                subscriptionId: b.subscriptionId,
                monthlyCost: /premium/i.test(sku) ? 280.0 : /standard/i.test(sku) ? 209.0 : 137.0,
                reason: "Revisar uso — Bastion no expone sesiones vía Resource Graph, validar necesidad real",
                daysIdle: 0,
            });
        }

        // Tabla de recursos "zombie" con costo estimado plano — cada entrada lee
        // una key del catálogo KQL (src/modules/core/kqlCatalog.ts), ya ejecutada
        // por runGraphAudits para todo el audit. armType es el tipo ARM exacto
        // usado por /api/remediation para el DELETE (puede diferir del
        // resourceType usado solo para agrupar/badges, ej. Front Door classic
        // vs Standard/Premium comparten badge pero tienen provider distinto).
        const FLAT_COST_TYPES: Array<{
            key: string; resourceType: string; armType: string; monthlyCost: number; reason: string; daysIdle?: number;
        }> = [
            { key: "unusedLoadBalancers", resourceType: "loadBalancer", armType: "Microsoft.Network/loadBalancers", monthlyCost: 18.0, reason: "Sin frontend IP configurado o sin backend pool asociado" },
            { key: "unusedVNetGateways", resourceType: "virtualNetworkGateway", armType: "Microsoft.Network/virtualNetworkGateways", monthlyCost: 130.0, reason: "Sin conexiones (Connections) configuradas" },
            { key: "emptyVnets", resourceType: "virtualNetwork", armType: "Microsoft.Network/virtualNetworks", monthlyCost: 0, reason: "VNet sin subnets configuradas" },
            { key: "emptySubnets", resourceType: "subnet", armType: "Microsoft.Network/virtualNetworks/subnets", monthlyCost: 0, reason: "Subnet sin recursos ni delegaciones asociadas" },
            { key: "unusedVirtualHubs", resourceType: "virtualWanHub", armType: "Microsoft.Network/virtualHubs", monthlyCost: 180.0, reason: "Virtual WAN Hub sin conexiones a VNets" },
            { key: "unusedRouteServers", resourceType: "routeServer", armType: "Microsoft.Network/virtualHubs", monthlyCost: 216.0, reason: "Azure Route Server sin conexiones a VNets" },
            { key: "unprovisionedExpressRoute", resourceType: "expressRouteCircuit", armType: "Microsoft.Network/expressRouteCircuits", monthlyCost: 300.0, reason: "Circuito sin aprovisionar o sin peerings/autorizaciones" },
            { key: "disconnectedVnetPeerings", resourceType: "vnetPeering", armType: "Microsoft.Network/virtualNetworks/virtualNetworkPeerings", monthlyCost: 0, reason: "Peering en estado distinto de Connected" },
            { key: "idleAzureFirewalls", resourceType: "azureFirewall", armType: "Microsoft.Network/azureFirewalls", monthlyCost: 900.0, reason: "Sin reglas (network/application/nat) ni Firewall Policy asociada" },
            { key: "orphanedNsgs", resourceType: "networkSecurityGroup", armType: "Microsoft.Network/networkSecurityGroups", monthlyCost: 0, reason: "NSG sin NICs ni Subnets asociadas" },
            { key: "orphanedAsgs", resourceType: "applicationSecurityGroup", armType: "Microsoft.Network/applicationSecurityGroups", monthlyCost: 0, reason: "ASG sin NICs asociadas" },
            { key: "privateEndpoints", resourceType: "privateEndpoint", armType: "Microsoft.Network/privateEndpoints", monthlyCost: 7.2, reason: "Conexión Private Link en estado Disconnected" },
            { key: "privateDnsZones", resourceType: "privateDnsZone", armType: "Microsoft.Network/privateDnsZones", monthlyCost: 0.5, reason: "Zona Private DNS sin Virtual Network Links" },
            { key: "ddos", resourceType: "ddosProtectionPlan", armType: "Microsoft.Network/ddosProtectionPlans", monthlyCost: 2944.0, reason: "Plan DDoS Standard sin VNets protegidas" },
            { key: "unattachedWafPolicies", resourceType: "webApplicationFirewall", armType: "Microsoft.Network/applicationGatewayWebApplicationFirewallPolicies", monthlyCost: 0, reason: "WAF Policy (Application Gateway) sin Application Gateway asociado" },
            { key: "frontDoorWaf", resourceType: "webApplicationFirewall", armType: "Microsoft.Network/frontDoorWebApplicationFirewallPolicies", monthlyCost: 0, reason: "WAF Policy (Front Door) sin Security Policy vinculada" },
            { key: "unusedFrontDoorClassic", resourceType: "frontDoor", armType: "Microsoft.Network/frontDoors", monthlyCost: 35.0, reason: "Front Door (classic) sin backend pools configurados" },
            { key: "unusedFrontDoorStandard", resourceType: "frontDoor", armType: "Microsoft.Cdn/profiles", monthlyCost: 35.0, reason: "Front Door Standard/Premium sin endpoints configurados" },
            { key: "trafficManager", resourceType: "trafficManager", armType: "Microsoft.Network/trafficManagerProfiles", monthlyCost: 1.0, reason: "Perfil de Traffic Manager sin endpoints configurados" },
            { key: "natGateways", resourceType: "natGateway", armType: "Microsoft.Network/natGateways", monthlyCost: 32.0, reason: "NAT Gateway sin subnets asociadas" },
            { key: "emptyDnsZones", resourceType: "dnsZone", armType: "Microsoft.Network/dnsZones", monthlyCost: 0.5, reason: "Zona DNS pública sin registros más allá de NS/SOA por defecto" },
            { key: "networkWatchersNoFlowLogs", resourceType: "networkWatcher", armType: "Microsoft.Network/networkWatchers", monthlyCost: 0, reason: "Network Watcher habilitado sin Flow Logs configurados" },
            { key: "flowLogsWithoutTrafficAnalytics", resourceType: "trafficAnalytics", armType: "Microsoft.Network/networkWatchers/flowLogs", monthlyCost: 0, reason: "Flow Log activo sin Traffic Analytics habilitado" },
        ];

        for (const cfg of FLAT_COST_TYPES) {
            const rows = (graphResults as any)?.[cfg.key] as any[] | undefined;
            for (const r of rows || []) {
                items.push({
                    resourceId: r.id,
                    resourceName: r.name,
                    resourceType: cfg.resourceType,
                    armType: cfg.armType,
                    resourceGroup: r.resourceGroup,
                    subscriptionId: r.subscriptionId,
                    monthlyCost: cfg.monthlyCost,
                    reason: cfg.reason,
                    daysIdle: cfg.daysIdle ?? 30,
                });
            }
        }

        const totalMonthlyWaste = Number(items.reduce((sum, i) => sum + i.monthlyCost, 0).toFixed(2));

        return { items, totalMonthlyWaste };
}
