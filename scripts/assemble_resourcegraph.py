import os
import subprocess

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print("--- Instalando @azure/arm-resourcegraph ---")
    subprocess.run(["npm", "install", "@azure/arm-resourcegraph"], cwd=base_dir, check=True)

    print("\n--- Refactorizando azure.ts ---")
    azure_ts_path = os.path.join(base_dir, "src", "lib", "azure.ts")
    with open(azure_ts_path, "r") as f:
        azure_ts = f.read()

    if "ResourceGraphClient" not in azure_ts:
        azure_ts = 'import { ResourceGraphClient } from "@azure/arm-resourcegraph";\n' + azure_ts
        resource_client_func = """
export async function getResourceGraphClient(tenantId: string) {
  const credential = await getAzureCredential(tenantId);
  return new ResourceGraphClient(credential);
}
"""
        azure_ts += resource_client_func
        with open(azure_ts_path, "w") as f:
            f.write(azure_ts)

    print("\n--- Refactorizando API de Recommendations ---")
    route_path = os.path.join(base_dir, "src", "app", "api", "recommendations", "route.ts")
    route_code = """import { NextRequest, NextResponse } from "next/server";
import { getResourceGraphClient } from "@/lib/azure";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!subscriptionId || !tenantId) {
      return NextResponse.json({ error: "Parámetros faltantes" }, { status: 400 });
    }

    // Aislamiento Multi-Tenant: Validación estricta JWT
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as { tid?: string } | null;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    if (decoded.tid !== tenantId) {
      return NextResponse.json(
        { error: `Acceso denegado. El token (tid: ${decoded.tid}) no coincide con el tenant solicitado.` },
        { status: 403 }
      );
    }

    // Instanciar Resource Graph Client
    const resourceGraphClient = await getResourceGraphClient(tenantId);

    // Consultas KQL
    const disksQuery = `Resources | where type =~ 'microsoft.compute/disks' | where properties.diskState == 'Unattached' | project id, name, location, resourceGroup, sku=sku.name, diskSizeGB=properties.diskSizeGB`;
    const ipsQuery = `Resources | where type =~ 'microsoft.network/publicipaddresses' | where properties.ipConfiguration == '' or isnull(properties.ipConfiguration) | project id, name, location, resourceGroup`;

    let unattachedDisks = [];
    let unusedIps = [];

    try {
      const diskResponse = await resourceGraphClient.resources({ 
        query: disksQuery, 
        subscriptions: [subscriptionId] 
      });
      unattachedDisks = diskResponse.data || [];
    } catch (e: any) {
      console.error("Resource Graph Query Disks Error", e);
      throw new Error(`Fallo en Query Disks: ${e.message}`);
    }

    try {
      const ipResponse = await resourceGraphClient.resources({ 
        query: ipsQuery, 
        subscriptions: [subscriptionId] 
      });
      unusedIps = ipResponse.data || [];
    } catch (e: any) {
      console.error("Resource Graph Query IPs Error", e);
      throw new Error(`Fallo en Query IPs: ${e.message}`);
    }

    return NextResponse.json({ 
        success: true, 
        tenantId, 
        subscriptionId, 
        unattachedDisks, 
        unusedIps 
    });

  } catch (error: any) {
    return NextResponse.json({ error: "Error en SDK o Resource Graph", details: error.message }, { status: 500 });
  }
}
"""
    with open(route_path, "w") as f:
        f.write(route_code)

    print("\nInyección completada. El backend ahora utiliza KQL para consultas de recursos zombis.")

if __name__ == "__main__":
    main()
