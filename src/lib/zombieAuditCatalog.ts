import { baselineForResourceType } from "@/lib/realizedSavings";

export interface UnifiedAuditConfigItem {
    type: string;
    armType: string;
    issue: string;
    issueType: "cost" | "governance";
    manualDelete: boolean;
    isHygiene?: boolean;
}

export const UNIFIED_AUDIT_RESOURCE_CONFIG: Record<string, UnifiedAuditConfigItem> = {
    // --- Cost / Fugas Directas ---
    unattachedDisks: { type: "Disk", armType: "microsoft.compute/disks", issue: "Disco sin asociar", issueType: "cost", manualDelete: false },
    unusedIps: { type: "Public IP", armType: "microsoft.network/publicipaddresses", issue: "IP Pública huérfana", issueType: "cost", manualDelete: false },
    unattachedPublicIps: { type: "Public IP", armType: "microsoft.network/publicipaddresses", issue: "IP Pública sin asignar", issueType: "cost", manualDelete: false },
    staleSnapshots: { type: "Snapshot", armType: "microsoft.compute/snapshots", issue: "Snapshot antiguo (>90d)", issueType: "cost", manualDelete: false },
    oldSnapshots: { type: "Snapshot", armType: "microsoft.compute/snapshots", issue: "Snapshot antiguo (>30d)", issueType: "cost", manualDelete: false },
    emptyAppServicePlans: { type: "App Service Plan", armType: "microsoft.web/serverfarms", issue: "Plan ASP vacío", issueType: "cost", manualDelete: false },
    elasticPools: { type: "SQL Elastic Pool", armType: "microsoft.sql/servers/elasticpools", issue: "Pool Vacío", issueType: "cost", manualDelete: true },
    emptySqlElasticPools: { type: "SQL Elastic Pool", armType: "microsoft.sql/servers/elasticpools", issue: "Pool sin bases de datos", issueType: "cost", manualDelete: true },
    loadBalancers: { type: "Load Balancer", armType: "microsoft.network/loadbalancers", issue: "Sin Backend", issueType: "cost", manualDelete: false },
    unusedLoadBalancers: { type: "Load Balancer", armType: "microsoft.network/loadbalancers", issue: "Sin Frontend / Backend Vacío", issueType: "cost", manualDelete: false },
    frontDoorWaf: { type: "Front Door WAF", armType: "microsoft.network/frontdoorwebapplicationfirewallpolicies", issue: "Sin Política", issueType: "cost", manualDelete: false },
    trafficManager: { type: "Traffic Manager", armType: "microsoft.network/trafficmanagerprofiles", issue: "Sin Endpoints", issueType: "cost", manualDelete: false },
    appGateways: { type: "App Gateway", armType: "microsoft.network/applicationgateways", issue: "Sin Backend IPs", issueType: "cost", manualDelete: false },
    unusedAppGateways: { type: "App Gateway", armType: "microsoft.network/applicationgateways", issue: "Sin Backend / Sin Reglas", issueType: "cost", manualDelete: false },
    natGateways: { type: "NAT Gateway", armType: "microsoft.network/natgateways", issue: "Sin Subred", issueType: "cost", manualDelete: false },
    privateEndpoints: { type: "Private Endpoint", armType: "microsoft.network/privateendpoints", issue: "Desconectado", issueType: "cost", manualDelete: false },
    vnetGateways: { type: "VNet Gateway", armType: "microsoft.network/virtualnetworkgateways", issue: "Sin Conexiones", issueType: "cost", manualDelete: false },
    unusedVNetGateways: { type: "VNet Gateway", armType: "microsoft.network/virtualnetworkgateways", issue: "Sin Conexiones Activas", issueType: "cost", manualDelete: false },
    ddos: { type: "DDoS Plan", armType: "microsoft.network/ddosprotectionplans", issue: "Sin Recursos", issueType: "cost", manualDelete: false },
    stoppedFlexibleServers: { type: "Flexible Server", armType: "microsoft.dbforpostgresql/flexibleservers", issue: "Servidor Flexible detenido", issueType: "cost", manualDelete: true },
    emptyCosmosDbAccounts: { type: "Cosmos DB", armType: "microsoft.documentdb", issue: "Cuenta Cosmos DB sin bases", issueType: "cost", manualDelete: true },
    emptyEventHubNamespaces: { type: "Event Hub", armType: "microsoft.eventhub", issue: "Namespace Event Hub vacío", issueType: "cost", manualDelete: true },
    emptyServiceBusNamespaces: { type: "Service Bus", armType: "microsoft.servicebus", issue: "Namespace Service Bus vacío", issueType: "cost", manualDelete: true },
    emptyApiManagement: { type: "API Management", armType: "microsoft.apimanagement", issue: "Instancia API Management vacía", issueType: "cost", manualDelete: true },
    unprovisionedExpressRoute: { type: "ExpressRoute", armType: "microsoft.network/expressroutecircuits", issue: "ExpressRoute no provisionado", issueType: "cost", manualDelete: false },
    unattachedWafPolicies: { type: "WAF Policy", armType: "microsoft.network/applicationgatewaywebapplicationfirewallpolicies", issue: "Política WAF sin asociar", issueType: "cost", manualDelete: false },
    emptyAse: { type: "App Service Env", armType: "microsoft.web/hostingenvironments", issue: "ASE vacío", issueType: "cost", manualDelete: true },
    longStoppedVMs: { type: "VM (Stopped)", armType: "microsoft.compute/virtualmachines/stopped", issue: "VM Apagada con Discos", issueType: "cost", manualDelete: false },
    stoppedVirtualMachines: { type: "VM (Stopped)", armType: "microsoft.compute/virtualmachines/stopped", issue: "VM Apagada con Discos", issueType: "cost", manualDelete: false },
    expiredTtlResources: { type: "TTL Expired", armType: "ttl", issue: "Recurso con TTL Expirado", issueType: "cost", manualDelete: false },

    // --- Gobernanza / Higiene (Sin costo facturado directo o costo residual) ---
    taggingNonCompliance: { type: "Tag Issue", armType: "tagging", issue: "Sin Etiquetas FinOps", issueType: "governance", manualDelete: true },
    completelyUntaggedResources: { type: "Tag Issue", armType: "tagging", issue: "Sin Etiquetas FinOps", issueType: "governance", manualDelete: true },
    missingMandatoryTags: { type: "Tag Issue", armType: "tagging", issue: "Faltan Etiquetas Obligatorias", issueType: "governance", manualDelete: true },
    orphanedNics: { type: "NIC", armType: "microsoft.network/networkinterfaces", issue: "NIC Huérfano", issueType: "governance", manualDelete: false },
    unattachedNics: { type: "NIC", armType: "microsoft.network/networkinterfaces", issue: "NIC Huérfano", issueType: "governance", manualDelete: false },
    orphanedNsgs: { type: "NSG", armType: "microsoft.network/networksecuritygroups", issue: "NSG sin asociar", issueType: "governance", manualDelete: false },
    availabilitySets: { type: "Availability Set", armType: "microsoft.compute/availabilitysets", issue: "Set vacío", issueType: "governance", manualDelete: true },
    idleVmss: { type: "VM Scale Set", armType: "microsoft.compute/virtualmachinescalesets", issue: "Escalado a 0 instancias", issueType: "governance", manualDelete: true },
    routeTables: { type: "Route Table", armType: "microsoft.network/routetables", issue: "No asignada", issueType: "governance", manualDelete: true },
    emptyVnets: { type: "VNet", armType: "microsoft.network/virtualnetworks", issue: "Red Vacía", issueType: "governance", manualDelete: false },
    emptySubnets: { type: "Subnet", armType: "microsoft.network/virtualnetworks/subnets", issue: "Subred Vacía", issueType: "governance", manualDelete: false },
    ipGroups: { type: "IP Group", armType: "microsoft.network/ipgroups", issue: "Sin Firewall", issueType: "governance", manualDelete: true },
    privateDnsZones: { type: "Private DNS", armType: "microsoft.network/privatednszones", issue: "Sin Enlaces", issueType: "governance", manualDelete: false },
    emptyRgs: { type: "Resource Group", armType: "microsoft.resources/subscriptions/resourcegroups", issue: "RG Vacío", issueType: "governance", manualDelete: true, isHygiene: true },
    apiConnections: { type: "API Connection", armType: "microsoft.web/connections", issue: "Desconectada", issueType: "governance", manualDelete: true },
    expiredCerts: { type: "Certificate", armType: "microsoft.web/certificates", issue: "Certificado Expirado", issueType: "governance", manualDelete: true },
    emptySqlServers: { type: "SQL Server", armType: "microsoft.sql/servers", issue: "Servidor SQL sin bases", issueType: "governance", manualDelete: true },
    orphanedAsgs: { type: "ASG", armType: "microsoft.network/applicationsecuritygroups", issue: "ASG Huérfano", issueType: "governance", manualDelete: false },
    disconnectedVnetPeerings: { type: "Peering", armType: "microsoft.network/virtualnetworks/virtualnetworkpeerings", issue: "Peering Desconectado", issueType: "governance", manualDelete: false },
    unusedVirtualHubs: { type: "Virtual Hub", armType: "microsoft.network/virtualhubs", issue: "Virtual Hub sin conexiones", issueType: "cost", manualDelete: false },
    emptyDnsZones: { type: "DNS Zone", armType: "microsoft.network/dnszones", issue: "Zona DNS Vacía", issueType: "cost", manualDelete: false },
};

export interface MappedZombieResourceItem {
    id: string;
    resourceName: string;
    type: string;
    armType: string;
    resourceGroup: string;
    subscriptionId: string;
    region: string;
    issue: string;
    issueType: "cost" | "governance";
    /** Clave del catalogo, para traducir el badge en el cliente (`Zombies.issues.*`). */
    issueKey: string;
    potentialSavings: number;
    savingsSource: "cost_management" | "type_baseline" | "none";
    manualDelete: boolean;
    isHygiene?: boolean;
    isExempted?: boolean;
    exemptionReason?: string | null;
    exemptionComment?: string | null;
    tags?: Record<string, string>;
    sku?: string;
    [key: string]: any;
}

export function mapAuditToUnifiedZombieList(auditResults: Record<string, any[]>): MappedZombieResourceItem[] {
    const seenIds = new Set<string>();
    const result: MappedZombieResourceItem[] = [];

    // Priorizamos longStoppedVMs sobre stoppedVirtualMachines para capturar el costo de discos enriquecido
    const keysOrder = Object.keys(UNIFIED_AUDIT_RESOURCE_CONFIG);

    for (const key of keysOrder) {
        const config = UNIFIED_AUDIT_RESOURCE_CONFIG[key];
        const rawItems = Array.isArray(auditResults[key]) ? auditResults[key] : [];

        for (const item of rawItems) {
            const rawId = String(item.id || item.resourceId || item.name || "");
            const normalizedId = rawId.toLowerCase();

            // Evitar duplicados exactos por id
            if (normalizedId && seenIds.has(normalizedId)) {
                // Si el item ya existía pero el nuevo tiene potentialSavings medido, actualizamos el costo
                if (Number(item.estimatedMonthlyCost || item.potentialSavings || 0) > 0) {
                    const existing = result.find((r) => r.id.toLowerCase() === normalizedId);
                    if (existing && existing.potentialSavings === 0) {
                        existing.potentialSavings = Number(item.estimatedMonthlyCost || item.potentialSavings);
                        existing.savingsSource = "cost_management";
                    }
                }
                continue;
            }

            if (normalizedId) {
                seenIds.add(normalizedId);
            }

            const estimatedMonthlyCost = Number(item.estimatedMonthlyCost || item.monthlyCost || item.potentialSavings || 0);
            let potentialSavings = 0;
            let savingsSource: "cost_management" | "type_baseline" | "none" = "none";

            if (Number.isFinite(estimatedMonthlyCost) && estimatedMonthlyCost > 0) {
                potentialSavings = estimatedMonthlyCost;
                savingsSource = "cost_management";
            } else if (config.issueType === "cost") {
                const diskSizeGB = Number(item.diskSizeGB || item.sizeGB || item.size || 0);
                const targetType = key.toLowerCase().includes("stopped")
                    ? config.armType
                    : String(item.armType || item.type || item.resourceType || config.armType || key);
                const baseline = baselineForResourceType(targetType, diskSizeGB || null);
                potentialSavings = baseline.monthly;
                savingsSource = baseline.source === "type_baseline" ? "type_baseline" : "none";
            }

            const mappedItem: MappedZombieResourceItem = {
                ...item,
                id: rawId || `res-${Math.random()}`,
                resourceName: String(item.name || item.resourceName || rawId.split("/").pop() || "Recurso"),
                type: config.type,
                armType: String(item.type || item.armType || config.armType),
                resourceGroup: String(item.resourceGroup || "Sin RG"),
                subscriptionId: String(item.subscriptionId || ""),
                region: String(item.location || item.region || "global"),
                issue: config.issue,
                // La clave del catalogo es el identificador estable de la regla, y
                // ZombieResourcesTable ya la prefiere sobre `issue` para traducir el
                // badge. Nadie la mandaba, asi que el badge caia siempre al texto en
                // espanol de `config.issue` -- que es justamente el fallback.
                issueKey: key,
                issueType: config.issueType,
                potentialSavings,
                savingsSource,
                manualDelete: config.manualDelete,
                isHygiene: config.isHygiene || false,
                isExempted: Boolean(item.isExempted),
                exemptionReason: item.exemptionReason || null,
                exemptionComment: item.exemptionComment || null,
            };

            result.push(mappedItem);
        }
    }

    return result;
}
