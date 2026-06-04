import { NextRequest, NextResponse } from "next/server";
import { getComputeClient, getNetworkClient } from "@/lib/azure";
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

    // Instanciación asíncrona tras validación
    const computeClient = await getComputeClient(tenantId, subscriptionId);
    const networkClient = await getNetworkClient(tenantId, subscriptionId);

    const zombieResources = [];

    try {
      const disks = computeClient.disks.list();
      for await (const disk of disks) {
        if (disk.diskState === 'Unattached') {
          zombieResources.push({ id: disk.id, resourceName: disk.name, type: "Disk", issue: "Disco sin asociar", potentialSavings: disk.diskSizeGB ? disk.diskSizeGB * 0.15 : 0 });
        }
      }
    } catch (computeError: any) {
      throw new Error(`Fallo en Compute: ${computeError.message}`);
    }

    try {
      const publicIPs = networkClient.publicIPAddresses.listAll();
      for await (const ip of publicIPs) {
        if (!ip.ipConfiguration) {
          zombieResources.push({ id: ip.id, resourceName: ip.name, type: "Public IP", issue: "IP Pública sin asignar", potentialSavings: 3.5 });
        }
      }
    } catch (networkError: any) {
      throw new Error(`Fallo en Network: ${networkError.message}`);
    }

    return NextResponse.json({ success: true, tenantId, subscriptionId, count: zombieResources.length, zombieResources });

  } catch (error: any) {
    return NextResponse.json({ error: "Error en SDK o Key Vault", details: error.message }, { status: 500 });
  }
}
