const fs = require('fs');
const path = require('path');

const base_dir = '/Users/manuelchavez/Documents/FinOpsProyect';

// 1. kqlCatalog.ts
const kqlContent = `export const kqlCatalog: Record<string, string> = {
  staleSnapshots: \`Resources | where type =~ 'microsoft.compute/snapshots' | where properties.timeCreated < ago(90d) | project id, name, location, resourceGroup, subscriptionId, sizeGB=properties.diskSizeGB\`,
  taggingNonCompliance: \`Resources | where isnull(tags.CostCenter) or isnull(tags.Owner) or isnull(tags.Environment) | project id, name, type, location, resourceGroup, subscriptionId\`,
  unattachedDisks: \`Resources | where type =~ 'microsoft.compute/disks' | where properties.diskState == 'Unattached' | project id, name, location, resourceGroup, subscriptionId, sku=sku.name, diskSizeGB=properties.diskSizeGB\`,
  unusedIps: \`Resources | where type =~ 'microsoft.network/publicipaddresses' | where properties.ipConfiguration == '' or isnull(properties.ipConfiguration) | project id, name, location, resourceGroup, subscriptionId\`,
  orphanedNics: \`Resources | where type =~ 'microsoft.network/networkinterfaces' | where isnull(properties.virtualMachine) | project id, name, location, resourceGroup, subscriptionId\`,
  orphanedNsgs: \`Resources | where type =~ 'microsoft.network/networksecuritygroups' | where isnull(properties.networkInterfaces) and isnull(properties.subnets) | project id, name, location, resourceGroup, subscriptionId\`,
  emptyAppServicePlans: \`Resources | where type =~ 'microsoft.web/serverfarms' | where properties.numberOfSites == 0 | project id, name, location, resourceGroup, subscriptionId, sku=sku.name\`,

  availabilitySets: \`Resources | where type =~ 'Microsoft.Compute/availabilitySets' | where properties.virtualMachines == "[]" | where not(name endswith "-asr") | project id, name, location, resourceGroup, subscriptionId\`,
  elasticPools: \`resources | where type =~ 'microsoft.sql/servers/elasticpools' | project elasticPoolId = tolower(id), id, name, resourceGroup, location, subscriptionId, tags, properties | join kind=leftouter (resources | where type =~ 'Microsoft.Sql/servers/databases' | project dbId=id, properties | extend elasticPoolId = tolower(properties.elasticPoolId)) on elasticPoolId | summarize databaseCount = countif(dbId != '') by id, name, resourceGroup, location, subscriptionId | where databaseCount == 0\`,
  routeTables: \`resources | where type =~ "microsoft.network/routetables" | where isnull(properties.subnets) | project id, name, location, resourceGroup, subscriptionId\`,
  loadBalancers: \`resources | where type =~ "microsoft.network/loadbalancers" | where properties.backendAddressPools == "[]" and properties.inboundNatRules == "[]" | project id, name, location, resourceGroup, subscriptionId\`,
  frontDoorWaf: \`resources | where type =~ "microsoft.network/frontdoorwebapplicationfirewallpolicies" | where properties.securityPolicyLinks == "[]" | project id, name, location, resourceGroup, subscriptionId\`,
  trafficManager: \`resources | where type =~ "microsoft.network/trafficmanagerprofiles" | where properties.endpoints == "[]" | project id, name, location, resourceGroup, subscriptionId\`,
  appGateways: \`resources | where type =~ 'microsoft.network/applicationgateways' | extend backendPoolsCount = array_length(properties.backendAddressPools), AppGwId = tostring(id) | project AppGwId, resourceGroup, location, subscriptionId, name | join (resources | where type =~ 'microsoft.network/applicationgateways' | mvexpand backendPools = properties.backendAddressPools | extend backendIPCount = array_length(backendPools.properties.backendIPConfigurations) | extend backendAddressesCount = array_length(backendPools.properties.backendAddresses) | extend AppGwId = tostring(id) | summarize backendIPCount = sum(backendIPCount) ,backendAddressesCount=sum(backendAddressesCount) by AppGwId) on AppGwId | where (backendIPCount == 0 or isempty(backendIPCount)) and (backendAddressesCount==0 or isempty(backendAddressesCount)) | project id=AppGwId, name, location, resourceGroup, subscriptionId\`,
  emptyVnets: \`resources | where type =~ "microsoft.network/virtualnetworks" | where properties.subnets == "[]" | project id, name, location, resourceGroup, subscriptionId\`,
  emptySubnets: \`resources | where type =~ "microsoft.network/virtualnetworks" | extend subnet = properties.subnets | mv-expand subnet | extend ipConfigurations = subnet.properties.ipConfigurations | extend delegations = subnet.properties.delegations | extend applicationGatewayIPConfigurations = subnet.properties.applicationGatewayIPConfigurations | where isnull(ipConfigurations) and delegations == "[]" and isnull(applicationGatewayIPConfigurations) | extend SubnetName = tostring(subnet.name), SubnetId = tostring(subnet.id) | project id=SubnetId, name=SubnetName, location, resourceGroup, subscriptionId\`,
  natGateways: \`resources | where type =~ "microsoft.network/natgateways" | where isnull(properties.subnets) | project id, name, location, resourceGroup, subscriptionId\`,
  ipGroups: \`resources | where type =~ "microsoft.network/ipgroups" | where properties.firewalls == "[]" and properties.firewallPolicies == "[]" | project id, name, location, resourceGroup, subscriptionId\`,
  privateDnsZones: \`resources | where type =~ "microsoft.network/privatednszones" | where properties.numberOfVirtualNetworkLinks == 0 | project id, name, location, resourceGroup, subscriptionId\`,
  privateEndpoints: \`resources | where type =~ "microsoft.network/privateendpoints" | extend connection = iff(array_length(properties.manualPrivateLinkServiceConnections) > 0, properties.manualPrivateLinkServiceConnections[0], properties.privateLinkServiceConnections[0]) | extend stateEnum = tostring(connection.properties.privateLinkServiceConnectionState?.status) | where stateEnum == "Disconnected" | project id, name, location, resourceGroup, subscriptionId\`,
  vnetGateways: \`resources | where type =~ "microsoft.network/virtualnetworkgateways" | extend vpnClientConfiguration = properties.vpnClientConfiguration | extend Resource = id | join kind=leftouter (resources | where type =~ "microsoft.network/connections" | mv-expand Resource = pack_array(properties.virtualNetworkGateway1.id, properties.virtualNetworkGateway2.id) to typeof(string) | project Resource, connectionId = id) on Resource | where isempty(vpnClientConfiguration) and isempty(connectionId) | project id=Resource, name, location, resourceGroup, subscriptionId\`,
  ddos: \`resources | where type =~ "microsoft.network/ddosprotectionplans" | where isnull(properties.virtualNetworks) | project id, name, location, resourceGroup, subscriptionId\`,
  emptyRgs: \`ResourceContainers | where type =~ "microsoft.resources/subscriptions/resourcegroups" | extend rgAndSub = strcat(resourceGroup, "--", subscriptionId) | join kind=leftouter (Resources | extend rgAndSub = strcat(resourceGroup, "--", subscriptionId) | summarize count() by rgAndSub) on rgAndSub | where isnull(count_) | project id, name, location, resourceGroup, subscriptionId\`,
  apiConnections: \`resources | where type =~ 'Microsoft.Web/connections' | project subscriptionId, Resource = id , name, resourceGroup, location | join kind = leftouter (resources | where type =~ 'microsoft.logic/workflows' | extend var_json = properties["parameters"]["$connections"]["value"] | mvexpand var_connection = var_json | where notnull(var_connection) | extend connectionId = extract("connectionId\\\\\\":\\\\\\"(.*?)\\\\\\"", 1, tostring(var_connection)) | project connectionId) on $left.Resource == $right.connectionId | where connectionId == "" | project id=Resource, name, location, resourceGroup, subscriptionId\`,
  expiredCerts: \`resources | where type =~ 'microsoft.web/certificates' | extend expiresOn = todatetime(properties.expirationDate) | where expiresOn <= now() | project id, name, location, resourceGroup, subscriptionId\`
};
`;
fs.writeFileSync(path.join(base_dir, 'src', 'lib', 'kqlCatalog.ts'), kqlContent);

// 2. auditService.ts
const auditContent = `import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "./kqlCatalog";

const getQuery = (query: string) => ({
    subscriptions: [],
    query
});

async function runInBatches(client: ResourceGraphClient, queries: {key: string, query: string}[], batchSize = 5) {
    const results: any = {};
    for (let i = 0; i < queries.length; i += batchSize) {
        const batch = queries.slice(i, i + batchSize);
        const batchPromises = batch.map(async (q) => {
            try {
                const res = await client.resources({ query: getQuery(q.query) });
                return { key: q.key, data: res.data };
            } catch (e) {
                console.warn(\`Query \${q.key} failed:\`, e);
                return { key: q.key, data: [] };
            }
        });
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(r => results[r.key] = r.data);
        
        if (i + batchSize < queries.length) {
            await new Promise(resolve => setTimeout(resolve, 800)); // 800ms delay to prevent 429
        }
    }
    return results;
}

export async function runGraphAudits(client: ResourceGraphClient, subscriptionId?: string) {
    const queryList = Object.keys(kqlCatalog).map(key => ({
        key,
        query: subscriptionId ? \`\${kqlCatalog[key]} | where subscriptionId =~ '\${subscriptionId}'\` : kqlCatalog[key]
    }));

    const results = await runInBatches(client, queryList, 5);
    return results;
}

export async function runMonitorAudits() {
    return [];
}

export async function runM365Audits() {
    return [];
}
`;
fs.writeFileSync(path.join(base_dir, 'src', 'services', 'auditService.ts'), auditContent);

// 3. ZombieResourcesTable.tsx mapped replacement
const tablePath = path.join(base_dir, 'src', 'components', 'ZombieResourcesTable.tsx');
let tableContent = fs.readFileSync(tablePath, 'utf8');

// Replace all the const formatted... blocks and setData with a dynamic loop
const mappingRegex = /const formattedNics = [\s\S]*?setData\(\[.*?\]\);/g;

const dynamicMapper = `const resourceConfig: any = {
            unattachedDisks: { type: "Disk", armType: "microsoft.compute/disks", issue: "Disco sin asociar", savings: 15.0, issueType: "cost", manualDelete: false },
            unusedIps: { type: "Public IP", armType: "microsoft.network/publicipaddresses", issue: "IP Pública sin asignar", savings: 3.5, issueType: "cost", manualDelete: false },
            staleSnapshots: { type: "Snapshot", armType: "microsoft.compute/snapshots", issue: "Snapshot Antiguo (>90d)", savings: 5.0, issueType: "cost", manualDelete: false },
            taggingNonCompliance: { type: "Resource", armType: "unknown", issue: "Sin Etiquetas FinOps", savings: 0.0, issueType: "governance", manualDelete: true },
            orphanedNics: { type: "NIC", armType: "microsoft.network/networkinterfaces", issue: "NIC Huérfano", savings: 0.0, issueType: "cost", manualDelete: false },
            orphanedNsgs: { type: "NSG", armType: "microsoft.network/networksecuritygroups", issue: "NSG sin asociar", savings: 0.0, issueType: "governance", manualDelete: false },
            emptyAppServicePlans: { type: "App Service Plan", armType: "microsoft.web/serverfarms", issue: "Plan ASP vacío", savings: 45.0, issueType: "cost", manualDelete: false },
            availabilitySets: { type: "Availability Set", armType: "microsoft.compute/availabilitysets", issue: "Set vacío", savings: 0.0, issueType: "governance", manualDelete: true },
            elasticPools: { type: "SQL Elastic Pool", armType: "microsoft.sql/servers/elasticpools", issue: "Pool Vacío", savings: 250.0, issueType: "cost", manualDelete: true },
            routeTables: { type: "Route Table", armType: "microsoft.network/routetables", issue: "No asignada", savings: 0.0, issueType: "governance", manualDelete: true },
            loadBalancers: { type: "Load Balancer", armType: "microsoft.network/loadbalancers", issue: "Sin Backend", savings: 18.0, issueType: "cost", manualDelete: true },
            frontDoorWaf: { type: "Front Door WAF", armType: "microsoft.network/frontdoorwebapplicationfirewallpolicies", issue: "Sin Política", savings: 5.0, issueType: "cost", manualDelete: true },
            trafficManager: { type: "Traffic Manager", armType: "microsoft.network/trafficmanagerprofiles", issue: "Sin Endpoints", savings: 3.0, issueType: "cost", manualDelete: true },
            appGateways: { type: "App Gateway", armType: "microsoft.network/applicationgateways", issue: "Sin Backend IPs", savings: 180.0, issueType: "cost", manualDelete: true },
            emptyVnets: { type: "VNET", armType: "microsoft.network/virtualnetworks", issue: "Red Vacía", savings: 0.0, issueType: "governance", manualDelete: true },
            emptySubnets: { type: "Subnet", armType: "microsoft.network/virtualnetworks/subnets", issue: "Subred Vacía", savings: 0.0, issueType: "governance", manualDelete: true },
            natGateways: { type: "NAT Gateway", armType: "microsoft.network/natgateways", issue: "Sin Subred", savings: 32.0, issueType: "cost", manualDelete: true },
            ipGroups: { type: "IP Group", armType: "microsoft.network/ipgroups", issue: "Sin Firewall", savings: 0.0, issueType: "governance", manualDelete: true },
            privateDnsZones: { type: "Private DNS", armType: "microsoft.network/privatednszones", issue: "Sin Enlaces", savings: 0.5, issueType: "governance", manualDelete: true },
            privateEndpoints: { type: "Private Endpoint", armType: "microsoft.network/privateendpoints", issue: "Desconectado", savings: 7.0, issueType: "cost", manualDelete: true },
            vnetGateways: { type: "VNet Gateway", armType: "microsoft.network/virtualnetworkgateways", issue: "Sin Conexiones", savings: 130.0, issueType: "cost", manualDelete: true },
            ddos: { type: "DDoS Plan", armType: "microsoft.network/ddosprotectionplans", issue: "Sin Recursos", savings: 2944.0, issueType: "cost", manualDelete: true },
            emptyRgs: { type: "Resource Group", armType: "microsoft.resources/subscriptions/resourcegroups", issue: "RG Vacío", savings: 0.0, issueType: "governance", manualDelete: true },
            apiConnections: { type: "API Connection", armType: "microsoft.web/connections", issue: "Desconectada", savings: 0.0, issueType: "governance", manualDelete: true },
            expiredCerts: { type: "Certificate", armType: "microsoft.web/certificates", issue: "Expirado", savings: 0.0, issueType: "governance", manualDelete: true }
        };

        let allMappedData: any[] = [];
        for (const [key, config] of Object.entries(resourceConfig)) {
            const items = audit[key] || [];
            const mapped = items.map((r: any) => ({
                id: r.id,
                resourceName: r.name,
                type: r.type ? (r.type.split("/").pop() || config.type) : config.type,
                armType: r.type || config.armType,
                resourceGroup: r.resourceGroup,
                issue: config.issue,
                subscriptionId: r.subscriptionId || selectedSub,
                potentialSavings: r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : config.savings),
                issueType: config.issueType,
                manualDelete: config.manualDelete
            }));
            allMappedData = [...allMappedData, ...mapped];
        }

        setData(allMappedData);`;

tableContent = tableContent.replace(mappingRegex, dynamicMapper);

// Update handleDelete to check for manualDelete
const oldHandle = `if (!window.confirm(\`¿Estás completamente seguro de ELIMINAR el recurso \${item.resourceName} permanentemente? Esto impactará los costos en Azure al instante.\`)) return;`;
const newHandle = `if (item.manualDelete) {
          alert(\`La eliminación automática de [\${item.type}] requiere precaución extra y no está enlazada al SDK en esta versión.\\n\\nPor favor, bórralo manualmente en el portal de Azure.\`);
          return;
      }

      if (!window.confirm(\`¿Estás completamente seguro de ELIMINAR el recurso \${item.resourceName} permanentemente? Esto impactará los costos en Azure al instante.\`)) return;`;

tableContent = tableContent.replace(oldHandle, newHandle);
fs.writeFileSync(tablePath, tableContent);
console.log("Phase 13 Omni-Scan Builder Completed!");
