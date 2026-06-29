import { NextRequest, NextResponse } from "next/server";
import { getResourceGraphClient, getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { runGraphAudits, runMonitorAudits, runM365Audits } from "@/services/auditService";
import { getMonthlyCostEstimate } from "@/services/pricingService";
import { tenants } from "@/lib/tenants";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";


export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    // 2. Obtener Cliente Autenticado
    const credential = await getAzureCredential(tenantId);
    const resourceGraphClient = new ResourceGraphClient(credential);

    // 3. Orquestar Servicios de Auditoría
    const graphResults = await runGraphAudits(resourceGraphClient, credential, subscriptionId || undefined);
    
    // Interceptar para estimación de costos en huérfanos
    if (graphResults.unattachedDisks && Array.isArray(graphResults.unattachedDisks)) {
        await Promise.all(graphResults.unattachedDisks.map(async (disk: any) => {
            const sku = disk.sku || "Standard_HDD";
            const loc = disk.location || "eastus";
            const cost = await getMonthlyCostEstimate("Storage", sku, loc);
            disk.estimatedMonthlyCost = cost;
        }));
    }

    if (graphResults.unusedIps && Array.isArray(graphResults.unusedIps)) {
        await Promise.all(graphResults.unusedIps.map(async (ip: any) => {
            const sku = ip.sku || "Standard";
            const loc = ip.location || "eastus";
            const cost = await getMonthlyCostEstimate("Virtual Network", sku, loc);
            ip.estimatedMonthlyCost = cost;
        }));
    }

    if (graphResults.oldSnapshots && Array.isArray(graphResults.oldSnapshots)) {
        await Promise.all(graphResults.oldSnapshots.map(async (res: any) => {
            const size = res.sizeGB || 50;
            const cost = size * 0.05;
            res.estimatedMonthlyCost = cost;
            res.resourceId = res.id;
            res.resourceType = res.type || "microsoft.compute/snapshots";
            res.monthlyCost = cost;
        }));
    }

    if (graphResults.unusedLoadBalancers && Array.isArray(graphResults.unusedLoadBalancers)) {
        await Promise.all(graphResults.unusedLoadBalancers.map(async (res: any) => {
            const cost = 18.0;
            res.estimatedMonthlyCost = cost;
            res.resourceId = res.id;
            res.resourceType = res.type || "microsoft.network/loadbalancers";
            res.monthlyCost = cost;
        }));
    }

    if (graphResults.unusedVNetGateways && Array.isArray(graphResults.unusedVNetGateways)) {
        await Promise.all(graphResults.unusedVNetGateways.map(async (res: any) => {
            const cost = 130.0;
            res.estimatedMonthlyCost = cost;
            res.resourceId = res.id;
            res.resourceType = res.type || "microsoft.network/virtualnetworkgateways";
            res.monthlyCost = cost;
        }));
    }

    if (graphResults.emptyAppServicePlans && Array.isArray(graphResults.emptyAppServicePlans)) {
        await Promise.all(graphResults.emptyAppServicePlans.map(async (res: any) => {
            const sku = res.sku || "S1";
            const loc = res.location || "eastus";
            let cost = await getMonthlyCostEstimate("App Service", sku, loc);
            if (!cost) {
                const skuUpper = sku.toUpperCase();
                if (skuUpper.startsWith("P")) {
                    cost = 150.0;
                } else if (skuUpper.startsWith("S")) {
                    cost = 75.0;
                } else if (skuUpper.startsWith("B")) {
                    cost = 55.0;
                } else if (skuUpper.startsWith("D") || skuUpper.startsWith("F")) {
                    cost = 0.0;
                } else {
                    cost = 45.0;
                }
            }
            res.estimatedMonthlyCost = cost;
            res.resourceId = res.id;
            res.resourceType = res.type || "microsoft.web/serverfarms";
            res.monthlyCost = cost;
        }));
    }

    if (graphResults.unattachedPublicIps && Array.isArray(graphResults.unattachedPublicIps)) {
        await Promise.all(graphResults.unattachedPublicIps.map(async (ip: any) => {
            const sku = ip.sku || "Standard";
            const loc = ip.location || "eastus";
            const cost = await getMonthlyCostEstimate("Virtual Network", sku, loc);
            ip.estimatedMonthlyCost = cost;
            ip.resourceId = ip.id;
            ip.resourceType = ip.type || "microsoft.network/publicipaddresses";
            ip.monthlyCost = cost;
        }));
    }

    if (graphResults.unattachedNics && Array.isArray(graphResults.unattachedNics)) {
        await Promise.all(graphResults.unattachedNics.map(async (nic: any) => {
            nic.estimatedMonthlyCost = 0;
            nic.resourceId = nic.id;
            nic.resourceType = nic.type || "microsoft.network/networkinterfaces";
            nic.monthlyCost = 0;
        }));
    }

    if (graphResults.longStoppedVMs && Array.isArray(graphResults.longStoppedVMs)) {
        let subs: string[] = [];
        if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
            subs = [subscriptionId];
        } else {
            subs = await getSubscriptionsForTenant(tenantId, credential);
        }

        const disksQuery = `
            Resources
            | where type =~ 'microsoft.compute/disks'
            | project id = tolower(id), diskSizeGB = toint(properties.diskSizeGB), sku = sku.name, location
        `;
        const disksResponse = await resourceGraphClient.resources({ query: disksQuery, subscriptions: subs });
        const disksData = disksResponse.data as any[] || [];
        const disksMap = new Map<string, { sizeGB: number, sku: string, location: string }>();
        for (const d of disksData) {
            if (d.id) {
                disksMap.set(d.id.toLowerCase(), {
                    sizeGB: d.diskSizeGB || 0,
                    sku: d.sku || "Standard_LRS",
                    location: d.location || "eastus"
                });
            }
        }

        await Promise.all(graphResults.longStoppedVMs.map(async (res: any) => {
            let storageCost = 0;
            const attachedDiskIds: string[] = [];
            if (res.osDiskId) attachedDiskIds.push(res.osDiskId.toLowerCase());
            if (res.dataDisks && Array.isArray(res.dataDisks)) {
                for (const d of res.dataDisks) {
                    if (d.managedDisk?.id) {
                        attachedDiskIds.push(d.managedDisk.id.toLowerCase());
                    }
                }
            }
            for (const diskId of attachedDiskIds) {
                const diskInfo = disksMap.get(diskId);
                if (diskInfo) {
                    const price = await getMonthlyCostEstimate("Storage", diskInfo.sku, diskInfo.location || res.location || "eastus");
                    storageCost += price || (diskInfo.sizeGB * 0.15);
                }
            }
            const cost = parseFloat(storageCost.toFixed(2));
            res.estimatedMonthlyCost = cost;
            res.resourceId = res.id;
            res.resourceType = res.type || "microsoft.compute/virtualmachines";
            res.monthlyCost = cost;
        }));
    }

    if (graphResults.emptyRgs && Array.isArray(graphResults.emptyRgs)) {
        graphResults.emptyRgs.forEach((res: any) => {
            res.estimatedMonthlyCost = 0;
            res.resourceId = res.id;
            res.resourceType = res.type || "microsoft.resources/subscriptions/resourcegroups";
            res.monthlyCost = 0;
            res.isHygiene = true;
        });
    }
    
    // Ejecutar stubs (para futura expansión)
    // const monitorResults = await runMonitorAudits(credential, subscriptionId);
    // const m365Results = await runM365Audits(credential, tenantId);

    // 4. Lógica Freemium Teaser (Removido el enmascaramiento de privacidad de VMs por solicitud)
    // El nombre real (vm.name) ahora se enviará como texto plano.

    // 5. Retornar Estructura Unificada
    return NextResponse.json({ 
        success: true, 
        tenantId, 
        mode: subscriptionId ? "single-subscription" : "tenant-wide",
        auditResults: {
            ...graphResults,
            // vmUnderutilized: monitorResults,
            // unassignedLicenses: m365Results
        }
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const maybeMessage = error instanceof Error ? error.message : String(error);
    if (maybeMessage.includes("Tenant no registrado en la base de datos") || maybeMessage.includes("Faltan credenciales (Client ID o Secret)")) {
      return NextResponse.json({
        success: true,
        tenantId: request.nextUrl.searchParams.get('tenantId') || null,
        mode: "tenant-wide",
        auditResults: {},
        message: "Tenant sin onboarding técnico completo (credenciales Azure pendientes)."
      });
    }

    const errorObj = (typeof error === "object" && error !== null)
      ? (error as { message?: string; code?: string; name?: string; statusCode?: number; status?: number })
      : {};
    const errorMessage = errorObj.message || String(error) || "Error desconocido";
    const errorCode = errorObj.code || errorObj.name || "";
    const errorStatus = errorObj.statusCode || errorObj.status || 0;

    console.error(`[Audit] ERROR capturado:`, {
      name: errorObj.name,
      code: errorCode,
      statusCode: errorStatus,
      message: errorMessage,
    });
    
    // Detectar falta de Admin Consent (Service Principal faltante)
    if (errorMessage.includes("AADSTS7000229")) {
      return NextResponse.json({
        error: "MISSING_ADMIN_CONSENT",
        details: "Falta el Service Principal en el Tenant destino. Debe proporcionar Admin Consent a la aplicación."
      }, { status: 403 });
    }

    // Detectar secreto de cliente inválido o expirado (AADSTS7000215)
    if (errorMessage.includes("AADSTS7000215") || errorMessage.includes("invalid_client") || errorMessage.includes("Invalid client secret")) {
      return NextResponse.json({
        error: "INVALID_CLIENT_SECRET",
        details: "El Client Secret de la aplicación Azure AD es inválido o ha expirado. Genere uno nuevo en Azure Portal > App Registrations > Certificates & secrets."
      }, { status: 401 });
    }

    // Intercepción RBAC Inteligente (Fase 6)
    if (errorCode === "AccessDenied" || errorStatus === 403 || errorMessage.includes("AccessDenied") || errorMessage.includes("AuthorizationFailed")) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en la suscripción." }, { status: 403 });
    }

    if (
      errorMessage.includes("No hay suscripciones disponibles o no se tienen permisos") ||
      errorMessage.includes("Failed to fetch subscriptions")
    ) {
      return NextResponse.json({
        success: true,
        tenantId: request.nextUrl.searchParams.get('tenantId') || null,
        mode: "tenant-wide",
        auditResults: {},
        message: "No se pudieron obtener suscripciones para auditoría en este momento."
      });
    }
    
    return NextResponse.json({ error: "Error en el Motor de Auditoría", details: errorMessage }, { status: 500 });
  }
}
