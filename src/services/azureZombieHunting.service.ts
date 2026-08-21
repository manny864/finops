import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { isMockTenant } from "@/lib/mockData";
import { withArgLimit } from "@/lib/argConcurrency";
import { getMonthlyCostEstimate } from "@/services/pricingService";
import { getExemptionsForTenant } from "@/modules/storage/recommendationExemptions";
import { kqlCatalog } from "@/modules/core/kqlCatalog";
import type {
    FinancialLeakResource,
    FinancialLeaksSummary,
    LeakCategoryBreakdown,
    LeakCategoryType,
} from "@/types/financialLeaks.types";

const CATEGORY_COLORS: Record<LeakCategoryType, string> = {
    UNATTACHED_DISK: "#0078D4",   // Azul corporativo profundo
    DEALLOCATED_VM: "#2563EB",    // Azul cobalto
    ORPHAN_IP: "#0284C7",         // Azul cian intermedio
    EMPTY_ASP: "#38BDF8",         // Azul cielo suave
    OLD_SNAPSHOT: "#93C5FD",      // Azul hielo
    UNUSED_LB: "#60A5FA",         // Azul intermedio
    UNUSED_GATEWAY: "#3B82F6",    // Azul real
    EMPTY_RG: "#94A3B8",          // Slate
    UNTAGGED: "#CBD5E1",          // Slate claro
};

const CATEGORY_NAMES: Record<LeakCategoryType, string> = {
    UNATTACHED_DISK: "Discos Desasociados",
    DEALLOCATED_VM: "VMs Desasignadas con Discos",
    ORPHAN_IP: "IPs Públicas Huérfanas",
    EMPTY_ASP: "App Service Plans Vacíos",
    OLD_SNAPSHOT: "Snapshots Antiguos (>30d)",
    UNUSED_LB: "Load Balancers sin Backend",
    UNUSED_GATEWAY: "VNet Gateways Inactivos",
    EMPTY_RG: "Grupos de Recursos Vacíos",
    UNTAGGED: "Recursos sin Etiquetas FinOps",
};

export class AzureZombieHuntingService {
    /**
     * Main entrypoint: Retrieves financial leaks summary for tenant.
     */
    static async getFinancialLeaksSummary(
        tenantId: string,
        subscriptionId?: string | null,
        tier: string = "Enterprise"
    ): Promise<FinancialLeaksSummary> {
        if (isMockTenant(tenantId)) {
            return this.getMockFinancialLeaks(tier);
        }

        return this.fetchLiveFinancialLeaks(tenantId, subscriptionId);
    }

    /**
     * Tier-scaled synthetic mock data for demo tenants.
     */
    static getMockFinancialLeaks(tier: string = "Enterprise"): FinancialLeaksSummary {
        const normalizedTier = (tier || "Enterprise").toUpperCase();
        let multiplier = 1.0;
        if (normalizedTier === "PROFESSIONAL") multiplier = 0.35;
        else if (normalizedTier === "BUSINESS") multiplier = 0.65;
        else multiplier = 1.0;

        const round2 = (num: number) => Math.round(num * 100) / 100;

        const mockResources: FinancialLeakResource[] = [
            {
                id: "/subscriptions/sub-mock-01/resourceGroups/rg-cscs-prod-compute/providers/Microsoft.Compute/disks/disk-prod-app01-unattached",
                name: "disk-prod-app01-unattached",
                resourceType: "Discos Administrados",
                armType: "microsoft.compute/disks",
                location: "eastus2",
                resourceGroup: "rg-cscs-prod-compute",
                subscriptionId: "sub-mock-01",
                subscriptionName: "CSCS-LandingZone-Production",
                leakCategory: "UNATTACHED_DISK",
                issueDescription: "Disco Premium SSD (256 GB) desasociado hace más de 45 días",
                estimatedMonthlySavingsUSD: round2(38.4 * multiplier),
                isHygiene: false,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-01/resourceGroups/rg-cscs-prod-compute/providers/Microsoft.Compute/disks/disk-temp-worker-orphan",
                name: "disk-temp-worker-orphan",
                resourceType: "Discos Administrados",
                armType: "microsoft.compute/disks",
                location: "eastus2",
                resourceGroup: "rg-cscs-prod-compute",
                subscriptionId: "sub-mock-01",
                subscriptionName: "CSCS-LandingZone-Production",
                leakCategory: "UNATTACHED_DISK",
                issueDescription: "Disco Standard SSD (128 GB) sin asociar a ninguna máquina virtual",
                estimatedMonthlySavingsUSD: round2(12.8 * multiplier),
                isHygiene: false,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-01/resourceGroups/rg-cscs-dev-sandbox/providers/Microsoft.Compute/virtualMachines/vm-dev-batch-stopped",
                name: "vm-dev-batch-stopped",
                resourceType: "Máquinas Virtuales",
                armType: "microsoft.compute/virtualmachines",
                location: "eastus2",
                resourceGroup: "rg-cscs-dev-sandbox",
                subscriptionId: "sub-mock-01",
                subscriptionName: "CSCS-LandingZone-Production",
                leakCategory: "DEALLOCATED_VM",
                issueDescription: "VM desasignada hace 60 días con 2 discos administrados facturando almacenamiento",
                estimatedMonthlySavingsUSD: round2(45.0 * multiplier),
                isHygiene: false,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-02/resourceGroups/rg-cscs-analytics-hub/providers/Microsoft.Compute/virtualMachines/vm-analytics-etl-idle",
                name: "vm-analytics-etl-idle",
                resourceType: "Máquinas Virtuales",
                armType: "microsoft.compute/virtualmachines",
                location: "canadacentral",
                resourceGroup: "rg-cscs-analytics-hub",
                subscriptionId: "sub-mock-02",
                subscriptionName: "CSCS-LandingZone-DataPlatform",
                leakCategory: "DEALLOCATED_VM",
                issueDescription: "VM Standard_D4s_v5 desasignada con disco OS de 128GB acumulando costo",
                estimatedMonthlySavingsUSD: round2(24.5 * multiplier),
                isHygiene: false,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-01/resourceGroups/rg-cscs-network-shared/providers/Microsoft.Network/publicIPAddresses/pip-legacy-ingress",
                name: "pip-legacy-ingress",
                resourceType: "IPs Públicas",
                armType: "microsoft.network/publicipaddresses",
                location: "eastus2",
                resourceGroup: "rg-cscs-network-shared",
                subscriptionId: "sub-mock-01",
                subscriptionName: "CSCS-LandingZone-Production",
                leakCategory: "ORPHAN_IP",
                issueDescription: "Dirección IP pública estática huérfana sin interfaz de red vinculada",
                estimatedMonthlySavingsUSD: round2(3.65 * multiplier),
                isHygiene: false,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-02/resourceGroups/rg-cscs-network-transit/providers/Microsoft.Network/publicIPAddresses/pip-dev-bastion-unused",
                name: "pip-dev-bastion-unused",
                resourceType: "IPs Públicas",
                armType: "microsoft.network/publicipaddresses",
                location: "eastus",
                resourceGroup: "rg-cscs-network-transit",
                subscriptionId: "sub-mock-02",
                subscriptionName: "CSCS-LandingZone-DataPlatform",
                leakCategory: "ORPHAN_IP",
                issueDescription: "IP pública Standard huérfana tras eliminación de Bastion",
                estimatedMonthlySavingsUSD: round2(3.65 * multiplier),
                isHygiene: false,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-01/resourceGroups/rg-cscs-webapps-tier/providers/Microsoft.Web/serverfarms/asp-legacy-php-apps",
                name: "asp-legacy-php-apps",
                resourceType: "App Service Plans",
                armType: "microsoft.web/serverfarms",
                location: "eastus2",
                resourceGroup: "rg-cscs-webapps-tier",
                subscriptionId: "sub-mock-01",
                subscriptionName: "CSCS-LandingZone-Production",
                leakCategory: "EMPTY_ASP",
                issueDescription: "Plan App Service (P1v2) activo sin ninguna aplicación web desplegada (0 apps)",
                estimatedMonthlySavingsUSD: round2(73.0 * multiplier),
                isHygiene: false,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-02/resourceGroups/rg-cscs-data-backups/providers/Microsoft.Compute/snapshots/snap-sql-migration-202511",
                name: "snap-sql-migration-202511",
                resourceType: "Snapshots de Disco",
                armType: "microsoft.compute/snapshots",
                location: "canadacentral",
                resourceGroup: "rg-cscs-data-backups",
                subscriptionId: "sub-mock-02",
                subscriptionName: "CSCS-LandingZone-DataPlatform",
                leakCategory: "OLD_SNAPSHOT",
                issueDescription: "Snapshot de disco (500 GB) creado hace más de 180 días",
                estimatedMonthlySavingsUSD: round2(25.0 * multiplier),
                isHygiene: false,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-01/resourceGroups/rg-cscs-network-shared/providers/Microsoft.Network/loadBalancers/lb-internal-old-qa",
                name: "lb-internal-old-qa",
                resourceType: "Load Balancers",
                armType: "microsoft.network/loadbalancers",
                location: "eastus2",
                resourceGroup: "rg-cscs-network-shared",
                subscriptionId: "sub-mock-01",
                subscriptionName: "CSCS-LandingZone-Production",
                leakCategory: "UNUSED_LB",
                issueDescription: "Load Balancer Standard sin pools de backend configurados",
                estimatedMonthlySavingsUSD: round2(18.0 * multiplier),
                isHygiene: false,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-01/resourceGroups/rg-cscs-network-shared/providers/Microsoft.Network/virtualNetworkGateways/vgw-vpn-onprem-standby",
                name: "vgw-vpn-onprem-standby",
                resourceType: "Virtual Network Gateways",
                armType: "microsoft.network/virtualnetworkgateways",
                location: "eastus2",
                resourceGroup: "rg-cscs-network-shared",
                subscriptionId: "sub-mock-01",
                subscriptionName: "CSCS-LandingZone-Production",
                leakCategory: "UNUSED_GATEWAY",
                issueDescription: "VNet Gateway VpnGw1 sin conexiones activas ni configuración VPN de cliente",
                estimatedMonthlySavingsUSD: round2(130.0 * multiplier),
                isHygiene: false,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-01/resourceGroups/rg-cscs-temp-poc-empty",
                name: "rg-cscs-temp-poc-empty",
                resourceType: "Grupos de Recursos",
                armType: "microsoft.resources/subscriptions/resourcegroups",
                location: "eastus2",
                resourceGroup: "rg-cscs-temp-poc-empty",
                subscriptionId: "sub-mock-01",
                subscriptionName: "CSCS-LandingZone-Production",
                leakCategory: "EMPTY_RG",
                issueDescription: "Grupo de recursos sin ningún recurso activo (Higiene Cloud)",
                estimatedMonthlySavingsUSD: 0,
                isHygiene: true,
                isExempt: false,
            },
            {
                id: "/subscriptions/sub-mock-01/resourceGroups/rg-cscs-prod-compute/providers/Microsoft.Storage/storageAccounts/stanalyticsunlabeled01",
                name: "stanalyticsunlabeled01",
                resourceType: "Cuentas de Almacenamiento",
                armType: "microsoft.storage/storageaccounts",
                location: "eastus2",
                resourceGroup: "rg-cscs-prod-compute",
                subscriptionId: "sub-mock-01",
                subscriptionName: "CSCS-LandingZone-Production",
                leakCategory: "UNTAGGED",
                issueDescription: "Recurso activo sin etiquetas obligatorias de FinOps (CostCenter, Environment, Owner)",
                estimatedMonthlySavingsUSD: 0,
                isHygiene: true,
                isExempt: false,
                manualDelete: true,
            },
        ];

        const breakdown = this.buildBreakdown(mockResources);
        const totalMonthlyLeakUSD = round2(
            mockResources.reduce((sum, r) => sum + r.estimatedMonthlySavingsUSD, 0)
        );

        return {
            totalMonthlyLeakUSD,
            totalAffectedResources: mockResources.length,
            breakdownByCategory: breakdown,
            resources: mockResources,
        };
    }

    /**
     * Executes KQL policies concurrently across Azure Resource Graph.
     */
    private static async fetchLiveFinancialLeaks(
        tenantId: string,
        subscriptionId?: string | null
    ): Promise<FinancialLeaksSummary> {
        let credential;
        try {
            credential = await getAzureCredential(tenantId);
        } catch (e: any) {
            console.warn(`[AzureZombieHuntingService] No Azure credentials for tenant ${tenantId}:`, e?.message);
            return { totalMonthlyLeakUSD: 0, totalAffectedResources: 0, breakdownByCategory: [], resources: [] };
        }

        const client = new ResourceGraphClient(credential);

        let subs: string[] = [];
        if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
            subs = [subscriptionId];
        } else {
            try {
                subs = await getSubscriptionsForTenant(tenantId, credential);
            } catch (err: any) {
                console.warn(`[AzureZombieHuntingService] getSubscriptionsForTenant warning:`, err?.message);
            }
        }

        let subMap = new Map<string, string>();
        try {
            subMap = await getSubscriptionNameMap(tenantId, credential);
        } catch (err: any) {
            console.warn(`[AzureZombieHuntingService] getSubscriptionNameMap warning:`, err?.message);
        }

        let exemptions: any[] = [];
        try {
            exemptions = await getExemptionsForTenant(tenantId);
        } catch (err: any) {
            console.warn(`[AzureZombieHuntingService] getExemptionsForTenant warning:`, err?.message);
        }
        const exemptionMap = new Map(
            exemptions
                .filter((e) => e.recommendationType === "zombies")
                .map((e) => [String(e.resourceId || "").toLowerCase(), e])
        );

        const executeKql = async (queryKey: string, queryStr: string): Promise<any[]> => {
            try {
                const response = await withArgLimit(() =>
                    client.resources({
                        query: queryStr,
                        subscriptions: subs.length > 0 ? subs : undefined,
                    })
                );
                return (response.data as any[]) || [];
            } catch (e: any) {
                console.warn(`[AzureZombieHuntingService] Query ${queryKey} failed:`, e?.message);
                return [];
            }
        };

        // Run the 8 Flexera waste policies + untagged resources in parallel
        const [
            unattachedDisks,
            longStoppedVMs,
            unattachedPublicIps,
            emptyAppServicePlans,
            unusedLoadBalancers,
            unusedVNetGateways,
            oldSnapshots,
            emptyRgs,
            taggingNonCompliance,
        ] = await Promise.all([
            executeKql("unattachedDisks", kqlCatalog.unattachedDisks),
            executeKql("longStoppedVMs", kqlCatalog.longStoppedVMs),
            executeKql("unattachedPublicIps", kqlCatalog.unattachedPublicIps),
            executeKql("emptyAppServicePlans", kqlCatalog.emptyAppServicePlans),
            executeKql("unusedLoadBalancers", kqlCatalog.unusedLoadBalancers),
            executeKql("unusedVNetGateways", kqlCatalog.unusedVNetGateways),
            executeKql("oldSnapshots", kqlCatalog.oldSnapshots),
            executeKql("emptyRgs", kqlCatalog.emptyRgs),
            executeKql("taggingNonCompliance", kqlCatalog.taggingNonCompliance),
        ]);

        const resources: FinancialLeakResource[] = [];

        // 1. Unattached Disks
        for (const d of unattachedDisks) {
            const sizeGB = Number(d.diskSizeGB || d.sizeGB || 128);
            const sku = d.sku || "Standard_LRS";
            const loc = d.location || "eastus";
            let cost = 15.0;
            try {
                const estimate = await getMonthlyCostEstimate("Storage", sku, loc);
                if (estimate && estimate > 0) cost = estimate;
                else cost = sizeGB * 0.15;
            } catch {}

            resources.push(this.mapItem(d, "UNATTACHED_DISK", "Discos Administrados", "microsoft.compute/disks", "Disco administrado sin asociar a ninguna VM", cost, false, subMap, exemptionMap));
        }

        // 2. Long Stopped VMs with attached disks
        for (const vm of longStoppedVMs) {
            const cost = 30.0; // VM stopped with OS / data disks
            resources.push(this.mapItem(vm, "DEALLOCATED_VM", "Máquinas Virtuales", "microsoft.compute/virtualmachines", "VM desasignada acumulando costo de almacenamiento", cost, false, subMap, exemptionMap));
        }

        // 3. Unattached Public IPs
        for (const ip of unattachedPublicIps) {
            const cost = 3.65;
            resources.push(this.mapItem(ip, "ORPHAN_IP", "IPs Públicas", "microsoft.network/publicipaddresses", "Dirección IP pública huérfana sin asociar", cost, false, subMap, exemptionMap));
        }

        // 4. Empty App Service Plans
        for (const asp of emptyAppServicePlans) {
            let cost = 45.0;
            const sku = String(asp.sku || "S1").toUpperCase();
            if (sku.startsWith("P")) cost = 140.0;
            else if (sku.startsWith("S")) cost = 73.0;
            else if (sku.startsWith("B")) cost = 54.0;

            resources.push(this.mapItem(asp, "EMPTY_ASP", "App Service Plans", "microsoft.web/serverfarms", "Plan App Service sin aplicaciones desplegadas (0 sitios)", cost, false, subMap, exemptionMap));
        }

        // 5. Unused Load Balancers
        for (const lb of unusedLoadBalancers) {
            const cost = 18.0;
            resources.push(this.mapItem(lb, "UNUSED_LB", "Load Balancers", "microsoft.network/loadbalancers", "Load Balancer sin configuración de backend activo", cost, false, subMap, exemptionMap));
        }

        // 6. Unused VNet Gateways
        for (const vgw of unusedVNetGateways) {
            const cost = 130.0;
            resources.push(this.mapItem(vgw, "UNUSED_GATEWAY", "Virtual Network Gateways", "microsoft.network/virtualnetworkgateways", "Gateway VPN sin conexiones activas configuradas", cost, false, subMap, exemptionMap));
        }

        // 7. Old Snapshots
        for (const snap of oldSnapshots) {
            const sizeGB = Number(snap.sizeGB || snap.diskSizeGB || 50);
            const cost = Math.max(5.0, sizeGB * 0.05);
            resources.push(this.mapItem(snap, "OLD_SNAPSHOT", "Snapshots de Disco", "microsoft.compute/snapshots", "Snapshot de disco con antigüedad superior a 30 días", cost, false, subMap, exemptionMap));
        }

        // 8. Empty Resource Groups (Hygiene)
        for (const rg of emptyRgs) {
            resources.push(this.mapItem(rg, "EMPTY_RG", "Grupos de Recursos", "microsoft.resources/subscriptions/resourcegroups", "Grupo de recursos sin recursos activos", 0, true, subMap, exemptionMap));
        }

        // 9. Untagged Resources (Governance Hygiene)
        for (const tagRes of taggingNonCompliance.slice(0, 50)) {
            resources.push(this.mapItem(tagRes, "UNTAGGED", "Recursos sin Etiquetas", tagRes.type || "unknown", "Recurso sin etiquetas FinOps obligatorias", 0, true, subMap, exemptionMap, true));
        }

        const breakdown = this.buildBreakdown(resources);
        const totalMonthlyLeakUSD = Math.round(
            resources.reduce((sum, r) => sum + (r.isExempt ? 0 : r.estimatedMonthlySavingsUSD), 0) * 100
        ) / 100;

        return {
            totalMonthlyLeakUSD,
            totalAffectedResources: resources.length,
            breakdownByCategory: breakdown,
            resources,
        };
    }

    private static mapItem(
        raw: any,
        category: LeakCategoryType,
        resourceType: string,
        armType: string,
        defaultIssue: string,
        savingsUSD: number,
        isHygiene: boolean,
        subMap: Map<string, string>,
        exemptionMap: Map<string, any>,
        manualDelete: boolean = false
    ): FinancialLeakResource {
        const id = String(raw.id || "");
        const rawName = String(raw.name || id.split("/").pop() || "Recurso sin nombre");
        const subId = String(raw.subscriptionId || "");
        const resolvedSubName = resolveSubscriptionName(subId, subMap);
        const exemption = exemptionMap.get(id.toLowerCase());

        return {
            id,
            name: rawName,
            resourceType,
            armType: raw.type || armType,
            location: raw.location || raw.region || "global",
            resourceGroup: raw.resourceGroup || "rg-default",
            subscriptionId: subId,
            subscriptionName: resolvedSubName,
            leakCategory: category,
            issueDescription: raw.issue || defaultIssue,
            estimatedMonthlySavingsUSD: Math.round(savingsUSD * 100) / 100,
            isHygiene,
            isExempt: !!exemption,
            exemptionReason: exemption?.reason || null,
            exemptionComment: exemption?.comment || null,
            manualDelete,
        };
    }

    private static buildBreakdown(resources: FinancialLeakResource[]): LeakCategoryBreakdown[] {
        const grouped: Record<LeakCategoryType, { count: number; savingsUSD: number }> = {
            UNATTACHED_DISK: { count: 0, savingsUSD: 0 },
            DEALLOCATED_VM: { count: 0, savingsUSD: 0 },
            ORPHAN_IP: { count: 0, savingsUSD: 0 },
            EMPTY_ASP: { count: 0, savingsUSD: 0 },
            OLD_SNAPSHOT: { count: 0, savingsUSD: 0 },
            UNUSED_LB: { count: 0, savingsUSD: 0 },
            UNUSED_GATEWAY: { count: 0, savingsUSD: 0 },
            EMPTY_RG: { count: 0, savingsUSD: 0 },
            UNTAGGED: { count: 0, savingsUSD: 0 },
        };

        for (const res of resources) {
            if (grouped[res.leakCategory]) {
                grouped[res.leakCategory].count += 1;
                grouped[res.leakCategory].savingsUSD += res.estimatedMonthlySavingsUSD;
            }
        }

        return (Object.keys(grouped) as LeakCategoryType[])
            .map((catKey) => ({
                categoryName: CATEGORY_NAMES[catKey] || catKey,
                categoryKey: catKey,
                count: grouped[catKey].count,
                savingsUSD: Math.round(grouped[catKey].savingsUSD * 100) / 100,
                color: CATEGORY_COLORS[catKey] || "#0078D4",
            }))
            .filter((item) => item.count > 0)
            .sort((a, b) => b.savingsUSD - a.savingsUSD || b.count - a.count);
    }
}
