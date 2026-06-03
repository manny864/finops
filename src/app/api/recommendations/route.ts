import { NextRequest, NextResponse } from "next/server";
import { getComputeClient, getNetworkClient } from "@/lib/azure";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId') || process.env.AZURE_SUBSCRIPTION_ID;

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "El parámetro subscriptionId o la variable de entorno AZURE_SUBSCRIPTION_ID es requerida." },
        { status: 400 }
      );
    }

    const computeClient = getComputeClient(subscriptionId);
    const networkClient = getNetworkClient(subscriptionId);

    const zombieResources = [];

    // 1. Detectar Discos No Asociados (Unattached Disks)
    try {
      const disks = computeClient.disks.list();
      for await (const disk of disks) {
        if (disk.diskState === 'Unattached') {
          zombieResources.push({
            id: disk.id,
            resourceName: disk.name,
            type: "Disk",
            issue: "Disco sin asociar",
            potentialSavings: disk.diskSizeGB ? disk.diskSizeGB * 0.15 : 0 // Estimación de precio
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
            potentialSavings: 3.5 // Estimación típica mensual
          });
        }
      }
    } catch (networkError: any) {
      console.error("Error fetching Public IPs:", networkError);
      throw new Error(`Fallo al consultar los recursos Network: ${networkError.message}`);
    }

    return NextResponse.json({
      success: true,
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
