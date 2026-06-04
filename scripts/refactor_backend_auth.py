import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print("Refactorizando Arquitectura Backend de FinOps a modelo Multi-Tenant...")
    
    # 1. Modificar src/lib/azure.ts
    azure_path = os.path.join(base_dir, "src", "lib", "azure.ts")
    azure_code = """import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";

/**
 * Instancia una credencial dinámicamente basada en el Tenant solicitado.
 * Requiere que la aplicación FinOps (Service Principal) esté registrada globalmente
 * y las variables de entorno AZURE_CLIENT_ID y AZURE_CLIENT_SECRET estén configuradas.
 */
export function getAzureCredential(tenantId: string) {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("AZURE_CLIENT_ID y AZURE_CLIENT_SECRET deben estar definidos en las variables de entorno (.env)");
  }

  return new ClientSecretCredential(tenantId, clientId, clientSecret);
}

export function getComputeClient(tenantId: string, subscriptionId: string) {
  const credential = getAzureCredential(tenantId);
  return new ComputeManagementClient(credential, subscriptionId);
}

export function getNetworkClient(tenantId: string, subscriptionId: string) {
  const credential = getAzureCredential(tenantId);
  return new NetworkManagementClient(credential, subscriptionId);
}
"""
    with open(azure_path, "w") as f:
        f.write(azure_code)

    # 2. Modificar src/app/api/recommendations/route.ts
    recom_path = os.path.join(base_dir, "src", "app", "api", "recommendations", "route.ts")
    recom_code = """import { NextRequest, NextResponse } from "next/server";
import { getComputeClient, getNetworkClient } from "@/lib/azure";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!subscriptionId || !tenantId) {
      return NextResponse.json(
        { error: "Los parámetros 'tenantId' y 'subscriptionId' son estrictamente obligatorios en la URL." },
        { status: 400 }
      );
    }

    const computeClient = getComputeClient(tenantId, subscriptionId);
    const networkClient = getNetworkClient(tenantId, subscriptionId);

    const zombieResources = [];

    // 1. Detectar Discos No Asociados
    try {
      const disks = computeClient.disks.list();
      for await (const disk of disks) {
        if (disk.diskState === 'Unattached') {
          zombieResources.push({
            id: disk.id,
            resourceName: disk.name,
            type: "Disk",
            issue: "Disco sin asociar",
            potentialSavings: disk.diskSizeGB ? disk.diskSizeGB * 0.15 : 0
          });
        }
      }
    } catch (computeError: any) {
      console.error("Error fetching disks:", computeError);
      throw new Error(`Fallo al consultar los recursos Compute: ${computeError.message}`);
    }

    // 2. Detectar IPs Públicas Estáticas No Asignadas
    try {
      const publicIPs = networkClient.publicIPAddresses.listAll();
      for await (const ip of publicIPs) {
        if (!ip.ipConfiguration) {
          zombieResources.push({
            id: ip.id,
            resourceName: ip.name,
            type: "Public IP",
            issue: "IP Pública sin asignar",
            potentialSavings: 3.5
          });
        }
      }
    } catch (networkError: any) {
      console.error("Error fetching Public IPs:", networkError);
      throw new Error(`Fallo al consultar los recursos Network: ${networkError.message}`);
    }

    return NextResponse.json({
      success: true,
      tenantId,
      subscriptionId,
      count: zombieResources.length,
      zombieResources,
    });

  } catch (error: any) {
    console.error("Recommendations API Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor durante la ejecución del SDK de Azure", details: error.message },
      { status: 500 }
    );
  }
}
"""
    with open(recom_path, "w") as f:
        f.write(recom_code)

    # 3. Modificar src/app/api/consumption/route.ts
    cons_path = os.path.join(base_dir, "src", "app", "api", "consumption", "route.ts")
    cons_code = """import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!subscriptionId || !tenantId) {
      return NextResponse.json(
        { error: "Los parámetros 'tenantId' y 'subscriptionId' son estrictamente obligatorios en la URL." },
        { status: 400 }
      );
    }

    // Inicializar credenciales estrictamente para validar funcionamiento multi-tenant
    getAzureCredential(tenantId);
    
    // Placeholder para la lógica real (ej. CostManagementClient)
    const costSummary = {
      amortizedCost: 0,
      currency: "USD",
      note: "El extractor de datos CostManagementClient para este Tenant aún no está implementado."
    };

    return NextResponse.json({
      success: true,
      tenantId,
      subscriptionId,
      costSummary,
    });

  } catch (error: any) {
    console.error("Consumption API Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor al consultar Consumo", details: error.message },
      { status: 500 }
    );
  }
}
"""
    with open(cons_path, "w") as f:
        f.write(cons_code)

    print("Refactorización Backend completada.")

if __name__ == "__main__":
    main()
