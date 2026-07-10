/**
 * Nombre completo/legible del tipo de recurso ARM:
 * "microsoft.compute/virtualmachines" → "Virtual Machines".
 * Mapa para los tipos más comunes; fallback: prettify del último segmento.
 */
export const FRIENDLY_TYPES: Record<string, string> = {
    "microsoft.compute/virtualmachines": "Virtual Machines",
    "microsoft.compute/disks": "Managed Disks",
    "microsoft.compute/virtualmachinescalesets": "VM Scale Sets",
    "microsoft.compute/snapshots": "Disk Snapshots",
    "microsoft.compute/images": "VM Images",
    "microsoft.storage/storageaccounts": "Storage Accounts",
    "microsoft.network/networkinterfaces": "Network Interfaces",
    "microsoft.network/networksecuritygroups": "Network Security Groups",
    "microsoft.network/publicipaddresses": "Public IP Addresses",
    "microsoft.network/virtualnetworks": "Virtual Networks",
    "microsoft.network/loadbalancers": "Load Balancers",
    "microsoft.network/applicationgateways": "Application Gateways",
    "microsoft.network/privateendpoints": "Private Endpoints",
    "microsoft.network/privatednszones": "Private DNS Zones",
    "microsoft.network/dnszones": "DNS Zones",
    "microsoft.web/sites": "App Services / Function Apps",
    "microsoft.web/serverfarms": "App Service Plans",
    "microsoft.sql/servers": "SQL Servers",
    "microsoft.sql/servers/databases": "SQL Databases",
    "microsoft.dbformysql/flexibleservers": "MySQL Flexible Servers",
    "microsoft.dbforpostgresql/flexibleservers": "PostgreSQL Flexible Servers",
    "microsoft.documentdb/databaseaccounts": "Cosmos DB Accounts",
    "microsoft.keyvault/vaults": "Key Vaults",
    "microsoft.keyvault/vault": "Key Vaults",
    "microsoft.containerservice/managedclusters": "AKS Clusters",
    "microsoft.containerregistry/registries": "Container Registries",
    "microsoft.insights/components": "Application Insights",
    "microsoft.insights/metricalerts": "Metric Alerts",
    "microsoft.insights/actiongroups": "Action Groups",
    "microsoft.operationalinsights/workspaces": "Log Analytics Workspaces",
    "microsoft.recoveryservices/vaults": "Recovery Services Vaults",
    "microsoft.managedidentity/userassignedidentities": "Managed Identities",
    "microsoft.automation/automationaccounts": "Automation Accounts",
    "microsoft.logic/workflows": "Logic Apps",
    "microsoft.eventhub/namespaces": "Event Hubs Namespaces",
    "microsoft.servicebus/namespaces": "Service Bus Namespaces",
    "microsoft.cache/redis": "Azure Cache for Redis",
    "microsoft.cognitiveservices/accounts": "Cognitive Services / OpenAI",
    "microsoft.apimanagement/service": "API Management",
    "microsoft.datafactory/factories": "Data Factories",
};

export function formatResourceType(type: string): string {
    const lower = (type || "").toLowerCase();
    const friendly = FRIENDLY_TYPES[lower];
    if (friendly) return friendly;
    const last = lower.split("/").pop() || lower;
    // prettify: "virtualmachines" no es separable sin diccionario; capitalizar basta.
    return last.charAt(0).toUpperCase() + last.slice(1);
}
