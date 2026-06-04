import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
kql_path = os.path.join(base_dir, "src/lib/kqlCatalog.ts")
sop_path = os.path.join(base_dir, "directivas/audit_and_tags_enhancement_SOP.md")

# Ensure SOP exists and update it
if not os.path.exists(sop_path):
    with open(sop_path, "w") as f:
        f.write("# Auditoría y Gestión de Etiquetas SOP\\n\\n")

with open(sop_path, "a") as f:
    f.write("\\n- **KQL Catalog**: Las consultas KQL deben incluir `isnull(prop) or array_length(prop) == 0` para manejar los nulos y arrays vacíos correctamente en recursos huérfanos (Availability Sets, Route Tables, Load Balancers, NAT Gateways).\\n")

# Replace existing entries in kqlCatalog.ts
with open(kql_path, "r") as f:
    content = f.read()

import re

# Availability Sets
content = re.sub(
    r"availabilitySets:\s*`.*?`,",
    r"availabilitySets: `Resources | where type =~ 'microsoft.compute/availabilitysets' | where isnull(properties.virtualMachines) or array_length(properties.virtualMachines) == 0 | project id, name, location, resourceGroup, subscriptionId`,",
    content,
    flags=re.DOTALL
)

# Route Tables
content = re.sub(
    r"routeTables:\s*`.*?`,",
    r"routeTables: `Resources | where type =~ 'microsoft.network/routetables' | where isnull(properties.subnets) or array_length(properties.subnets) == 0 | project id, name, location, resourceGroup, subscriptionId`,",
    content,
    flags=re.DOTALL
)

# Load Balancers
content = re.sub(
    r"loadBalancers:\s*`.*?`,",
    r"loadBalancers: `Resources | where type =~ 'microsoft.network/loadbalancers' | where isnull(properties.backendAddressPools) or array_length(properties.backendAddressPools) == 0 | project id, name, location, resourceGroup, subscriptionId`,",
    content,
    flags=re.DOTALL
)

# NAT Gateways
content = re.sub(
    r"natGateways:\s*`.*?`,",
    r"natGateways: `Resources | where type =~ 'microsoft.network/natgateways' | where isnull(properties.subnets) or array_length(properties.subnets) == 0 | project id, name, location, resourceGroup, subscriptionId`,",
    content,
    flags=re.DOTALL
)

with open(kql_path, "w") as f:
    f.write(content)

print("KQL Catalog updated successfully.")
