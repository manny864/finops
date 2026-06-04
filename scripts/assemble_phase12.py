import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

# 1. Update kqlCatalog.ts
kql_path = os.path.join(base_dir, "src", "lib", "kqlCatalog.ts")
with open(kql_path, "r") as f:
    kql = f.read()

new_kql_keys = """,

  orphanedNics: `Resources \n| where type =~ 'microsoft.network/networkinterfaces' \n| where isnull(properties.virtualMachine) \n| project id, name, location, resourceGroup, subscriptionId`,

  orphanedNsgs: `Resources \n| where type =~ 'microsoft.network/networksecuritygroups' \n| where isnull(properties.networkInterfaces) and isnull(properties.subnets) \n| project id, name, location, resourceGroup, subscriptionId`,

  emptyAppServicePlans: `Resources \n| where type =~ 'microsoft.web/serverfarms' \n| where properties.numberOfSites == 0 \n| project id, name, location, resourceGroup, subscriptionId, sku=sku.name`
"""
kql = kql.replace("\n};", new_kql_keys + "\n};");
with open(kql_path, "w") as f:
    f.write(kql)

# 2. Update auditService.ts
audit_path = os.path.join(base_dir, "src", "services", "auditService.ts")
with open(audit_path, "r") as f:
    audit = f.read()

old_promise = """  const [disks, ips, snaps, tags] = await Promise.all([
    client.resources({ query: getQuery(kqlCatalog.unattachedDisks) }),
    client.resources({ query: getQuery(kqlCatalog.unusedIps) }),
    client.resources({ query: getQuery(kqlCatalog.staleSnapshots) }),
    client.resources({ query: getQuery(kqlCatalog.taggingNonCompliance) })
  ]);

  return {
      unattachedDisks: disks.data,
      unusedIps: ips.data,
      staleSnapshots: snaps.data,
      taggingNonCompliance: tags.data
  };"""

new_promise = """  const [disks, ips, snaps, tags, nics, nsgs, asps] = await Promise.all([
    client.resources({ query: getQuery(kqlCatalog.unattachedDisks) }),
    client.resources({ query: getQuery(kqlCatalog.unusedIps) }),
    client.resources({ query: getQuery(kqlCatalog.staleSnapshots) }),
    client.resources({ query: getQuery(kqlCatalog.taggingNonCompliance) }),
    client.resources({ query: getQuery(kqlCatalog.orphanedNics) }),
    client.resources({ query: getQuery(kqlCatalog.orphanedNsgs) }),
    client.resources({ query: getQuery(kqlCatalog.emptyAppServicePlans) })
  ]);

  return {
      unattachedDisks: disks.data,
      unusedIps: ips.data,
      staleSnapshots: snaps.data,
      taggingNonCompliance: tags.data,
      orphanedNics: nics.data,
      orphanedNsgs: nsgs.data,
      emptyAppServicePlans: asps.data
  };"""
audit = audit.replace(old_promise, new_promise)
with open(audit_path, "w") as f:
    f.write(audit)

# 3. Create remediationService.ts
remediation_path = os.path.join(base_dir, "src", "services", "remediationService.ts")
remediation_code = """import { getAzureCredential } from "@/lib/azure";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { WebSiteManagementClient } from "@azure/arm-appservice";

export async function deleteResource(tenantId: string, subscriptionId: string, resourceGroup: string, resourceName: string, resourceType: string) {
    const credential = await getAzureCredential(tenantId);
    const type = resourceType.toLowerCase();

    if (type.includes("disks") || type.includes("snapshots")) {
        const client = new ComputeManagementClient(credential, subscriptionId);
        if (type.includes("disks")) {
            return await client.disks.beginDeleteAndWait(resourceGroup, resourceName);
        } else {
            return await client.snapshots.beginDeleteAndWait(resourceGroup, resourceName);
        }
    } else if (type.includes("networkinterfaces")) {
        const client = new NetworkManagementClient(credential, subscriptionId);
        return await client.networkInterfaces.beginDeleteAndWait(resourceGroup, resourceName);
    } else if (type.includes("networksecuritygroups")) {
        const client = new NetworkManagementClient(credential, subscriptionId);
        return await client.networkSecurityGroups.beginDeleteAndWait(resourceGroup, resourceName);
    } else if (type.includes("publicipaddresses")) {
        const client = new NetworkManagementClient(credential, subscriptionId);
        return await client.publicIPAddresses.beginDeleteAndWait(resourceGroup, resourceName);
    } else if (type.includes("serverfarms")) {
        const client = new WebSiteManagementClient(credential, subscriptionId);
        return await client.appServicePlans.beginDeleteAndWait(resourceGroup, resourceName);
    } else {
        throw new Error(`Tipo de recurso no soportado para borrado automático: ${resourceType}`);
    }
}
"""
with open(remediation_path, "w") as f:
    f.write(remediation_code)

# 4. Create /api/remediation/route.ts
api_rem_dir = os.path.join(base_dir, "src", "app", "api", "remediation")
if not os.path.exists(api_rem_dir):
    os.makedirs(api_rem_dir)

api_rem_code = """import { NextRequest, NextResponse } from "next/server";
import { deleteResource } from "@/services/remediationService";
import jwt from "jsonwebtoken";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return NextResponse.json({ error: "No auth" }, { status: 401 });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const body = await request.json();
    const { tenantId, subscriptionId, resourceGroup, resourceName, resourceType } = body;

    // SuperAdmin bypass
    const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
    const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

    if (decoded.tid !== tenantId && !isAdmin) {
      return NextResponse.json({ error: "Cross-tenant deletion denied" }, { status: 403 });
    }

    await deleteResource(tenantId, subscriptionId, resourceGroup, resourceName, resourceType);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("Delete error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
"""
with open(os.path.join(api_rem_dir, "route.ts"), "w") as f:
    f.write(api_rem_code)

# 5. Update ZombieResourcesTable.tsx with mappings and UI actions
table_path = os.path.join(base_dir, "src", "components", "ZombieResourcesTable.tsx")
with open(table_path, "r") as f:
    table = f.read()

# Find the line "const formattedDisks = ..." and inject the others above it
format_injection = """        const formattedNics = (audit.orphanedNics || []).map((n: any) => ({
            id: n.id, 
            resourceName: n.name, 
            type: "NIC", 
            armType: "microsoft.network/networkinterfaces",
            resourceGroup: n.resourceGroup,
            issue: "NIC Huérfano", 
            subscriptionId: n.subscriptionId || selectedSub,
            potentialSavings: 0.0,
            issueType: "cost"
        }));

        const formattedNsgs = (audit.orphanedNsgs || []).map((n: any) => ({
            id: n.id, 
            resourceName: n.name, 
            type: "NSG", 
            armType: "microsoft.network/networksecuritygroups",
            resourceGroup: n.resourceGroup,
            issue: "NSG sin asociar", 
            subscriptionId: n.subscriptionId || selectedSub,
            potentialSavings: 0.0,
            issueType: "governance"
        }));

        const formattedAsps = (audit.emptyAppServicePlans || []).map((a: any) => ({
            id: a.id, 
            resourceName: a.name, 
            type: "App Service Plan", 
            armType: "microsoft.web/serverfarms",
            resourceGroup: a.resourceGroup,
            issue: "Plan ASP vacío", 
            subscriptionId: a.subscriptionId || selectedSub,
            potentialSavings: 45.0,
            issueType: "cost"
        }));

"""
table = table.replace("const formattedDisks =", format_injection + "const formattedDisks =")

# Update existing map functions to include armType and resourceGroup
table = table.replace(
    "type: \"Disk\",",
    "type: \"Disk\", armType: \"microsoft.compute/disks\", resourceGroup: d.resourceGroup,"
)
table = table.replace(
    "type: \"Public IP\",",
    "type: \"Public IP\", armType: \"microsoft.network/publicipaddresses\", resourceGroup: ip.resourceGroup,"
)
table = table.replace(
    "type: \"Snapshot\",",
    "type: \"Snapshot\", armType: \"microsoft.compute/snapshots\", resourceGroup: s.resourceGroup,"
)
table = table.replace(
    "type: r.type?.split(\"/\").pop() || \"Resource\",",
    "type: r.type?.split(\"/\").pop() || \"Resource\", armType: r.type, resourceGroup: r.resourceGroup,"
)

# Update setData array
table = table.replace(
    "setData([...formattedDisks, ...formattedIps, ...formattedSnapshots, ...formattedTags]);",
    "setData([...formattedDisks, ...formattedIps, ...formattedSnapshots, ...formattedTags, ...formattedNics, ...formattedNsgs, ...formattedAsps]);"
)

# Add handleDelete logic and states inside component
state_injection = """  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (item: any) => {
      if (!window.confirm(`¿Estás completamente seguro de ELIMINAR el recurso ${item.resourceName} permanentemente? Esto impactará los costos en Azure al instante.`)) return;
      
      try {
          setDeletingId(item.id);
          const account = accounts[0];
          const tokenResponse = await instance.acquireTokenSilent({
              scopes: ["User.Read"],
              account: account
          });
          
          const res = await fetch('/api/remediation', {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${tokenResponse.idToken}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                  tenantId: selectedTenant.id,
                  subscriptionId: item.subscriptionId,
                  resourceGroup: item.resourceGroup,
                  resourceName: item.resourceName,
                  resourceType: item.armType
              })
          });
          
          if (!res.ok) throw new Error("Fallo al eliminar");
          
          // Remover de la tabla local
          setData(prev => prev.filter(r => r.id !== item.id));
      } catch (err) {
          console.error("Error de eliminación:", err);
          alert("Hubo un error o no tienes los permisos suficientes para borrar este recurso remotamente.");
      } finally {
          setDeletingId(null);
      }
  };"""

table = table.replace("const [loading, setLoading] = useState(true);", state_injection)

# Add Action column Header
table = table.replace(
    "<th className=\"p-4 font-medium text-right\">Ahorro Mensual (USD)</th>",
    "<th className=\"p-4 font-medium text-right\">Ahorro Mensual (USD)</th>\n                <th className=\"p-4 font-medium text-right\">Acciones</th>"
)

# Add Action column Data
action_col = """<td className=\"p-4 text-sm font-bold text-right ${item.potentialSavings > 0 ? 'text-green-600' : 'text-gray-400'}\">${item.potentialSavings > 0 ? `$` + Number(item.potentialSavings).toFixed(2) : \"-\"}</td>\n                  <td className=\"p-4 text-right\">\n                    <button \n                        onClick={() => handleDelete(item)}\n                        disabled={deletingId === item.id || item.issueType === 'governance'}\n                        className={`px-3 py-1 rounded-md text-xs font-semibold shadow-sm transition-colors ${deletingId === item.id ? 'bg-gray-100 text-gray-400 cursor-wait' : item.issueType === 'governance' ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'}`}\n                    >\n                        {deletingId === item.id ? 'Borrando...' : 'Borrar'}\n                    </button>\n                  </td>"""
table = table.replace(
    "<td className={`p-4 text-sm font-bold text-right ${item.potentialSavings > 0 ? 'text-green-600' : 'text-gray-400'}`}>{item.potentialSavings > 0 ? `$` + Number(item.potentialSavings).toFixed(2) : \"-\"}</td>",
    action_col
)

# Fix colSpan in empty state
table = table.replace("colSpan={5}", "colSpan={6}")

with open(table_path, "w") as f:
    f.write(table)

print("Motor de Remediación Integrado y Tabla actualizada exitosamente.")
