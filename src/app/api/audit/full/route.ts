import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant, getResourceGraphClient } from "@/lib/azure";
import { runGraphAudits } from "@/services/auditService";
import { getMonthlyCostEstimate } from "@/services/pricingService";
import { precioMensualDisco, precioMensualIpPublica } from "@/services/precioRecursoAzure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { exigirSuscripcionDelTenant } from "@/lib/scopeDelTenant";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { withArgLimit } from "@/lib/argConcurrency";
import { getExemptionsForTenant } from "@/modules/storage/recommendationExemptions";
import { errorMessage } from '@/lib/apiErrors';

type AuditPayload = { mode: string; auditResults: Record<string, unknown[]> };

/**
 * Lo que devuelve la ruta. El mock de la demo se ata a este tipo en
 * `MockContracts`: la ruta no se puede invocar con un tenant de demo, asi que
 * el typecheck es la unica red (MEJ-03).
 *
 * `auditResults` es un mapa dinamico con una clave por chequeo del catalogo KQL
 * -- hoy 63 --, asi que el tipo no puede afirmar cuales vienen. El mock trae 8;
 * no es una divergencia de contrato sino de RIQUEZA de la demo, anotada en
 * docs/MEJORAS-FUTURAS.md para que se decida a proposito y no por olvido.
 */
export interface AuditFullResponse {
    success: boolean;
    tenantId: string | null;
    mode: string;
    auditResults: Record<string, unknown[]>;
    message?: string;
}

async function computeAuditPayload(tenantId: string, subscriptionId: string | null): Promise<AuditPayload> {
    // 2. Obtener Cliente Autenticado
    const credential = await getAzureCredential(tenantId);
    const resourceGraphClient = await getResourceGraphClient(tenantId, credential);

    // 3. Orquestar Servicios de Auditoría
    const graphResults = await runGraphAudits(resourceGraphClient, credential, tenantId, subscriptionId || undefined);
    
    // Interceptar para estimación de costos en huérfanos
    if (graphResults.unattachedDisks && Array.isArray(graphResults.unattachedDisks)) {
        await Promise.all(graphResults.unattachedDisks.map(async (disk: any) => {
            const sku = disk.sku || "Standard_HDD";
            const loc = disk.location || "eastus";
            // `sku` es el `sku.name` de ARM (`Premium_LRS`): la Retail API publica los discos por tier
            // y tamaño (`P10 LRS`), y por eso esto daba SIEMPRE 0 (acá no hay respaldo).
            const cost = await precioMensualDisco(sku, disk.diskSizeGB, loc);
            disk.estimatedMonthlyCost = cost ?? 0;
        }));
    }

    if (graphResults.unusedIps && Array.isArray(graphResults.unusedIps)) {
        await Promise.all(graphResults.unusedIps.map(async (ip: any) => {
            const sku = ip.sku || "Standard";
            const loc = ip.location || "eastus";
            // `skuName eq 'Standard'` trae la IP (0,005/h) y también el Public IP Prefix (0,006/h): el
            // helper viejo se quedaba con la primera fila, o sea que el número dependía del orden de la API.
            const cost = (await precioMensualIpPublica(sku, loc)) ?? 0;
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
            // Misma consulta que `unusedIps`, ver arriba.
            const cost = (await precioMensualIpPublica(sku, loc)) ?? 0;
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
        // Esta query NO pasaba por retry ni por el limitador global de ARG:
        // ante un 429 sostenido, tiraba una excepcion sin capturar que
        // rompia TODO /api/audit/full con un 500 (visto en produccion).
        let disksData: any[] = [];
        try {
            let retries = 3;
            let currentDelay = 3000;
            for (;;) {
                try {
                    const disksResponse = await withArgLimit(() => resourceGraphClient.resources({ query: disksQuery, subscriptions: subs }));
                    disksData = disksResponse.data as any[] || [];
                    break;
                } catch (e: any) {
                    const isRateLimit = e?.statusCode === 429 || (e?.code && e.code === 'RateLimiting');
                    if (isRateLimit && retries > 1) {
                        await new Promise(resolve => setTimeout(resolve, currentDelay));
                        currentDelay *= 2;
                        retries--;
                    } else {
                        throw e;
                    }
                }
            }
        } catch (e) {
            console.warn(`[Audit] No se pudo enriquecer costo de discos de longStoppedVMs (degradado a $0):`, errorMessage(e) || e);
        }
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
                    // `diskInfo.sku` es el `sku.name` de ARM: ver el chequeo unattachedDisks.
                    const price = await precioMensualDisco(diskInfo.sku, diskInfo.sizeGB, diskInfo.location || res.location || "eastus");
                    storageCost += price ?? (diskInfo.sizeGB * 0.15);
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

    return {
        mode: subscriptionId ? "single-subscription" : "tenant-wide",
        auditResults: graphResults
    };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
    // Antes del cache: lo cacheado antes de este chequeo puede ser de otro tenant.
    await exigirSuscripcionDelTenant(tenantId, subscriptionId);

    // Cache Redis SWR: evita relanzar las ~47 queries de ARG en cada refresh.
    const cacheKey = `audit:full:v1:${tenantId}:${(subscriptionId || 'all').toLowerCase()}`;
    const payload = await getWithStaleWhileRevalidate(
      cacheKey,
      () => computeAuditPayload(tenantId, subscriptionId),
      600,
      120,
      (data: AuditPayload) => {
        const total = Object.values(data.auditResults || {}).reduce(
          (acc: number, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0
        );
        return total > 0 ? 600 : 30;
      }
    );

    // Inyectar Exenciones dinámicamente en vivo (fuera de la caché SWR de la auditoría)
    const exemptions = await getExemptionsForTenant(tenantId);
    const exemptionsMap = new Map(exemptions.filter(e => e.recommendationType === 'zombies').map(e => [(e.resourceId || '').toLowerCase(), e]));

    const auditResultsCopy = JSON.parse(JSON.stringify(payload.auditResults || {}));
    Object.keys(auditResultsCopy).forEach(key => {
        const arr = auditResultsCopy[key];
        if (Array.isArray(arr)) {
            arr.forEach((res: any) => {
                const ex = exemptionsMap.get((res.resourceId || res.id || '').toLowerCase());
                if (ex) {
                    res.isExempted = true;
                    res.exemptionReason = ex.reason || null;
                    res.exemptionComment = ex.comment || null;
                } else {
                    res.isExempted = false;
                }
            });
        }
    });

    // 5. Retornar Estructura Unificada
    const respuesta: AuditFullResponse = {
        success: true,
        tenantId,
        mode: payload.mode,
        auditResults: auditResultsCopy,
    };
    return NextResponse.json(respuesta);

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
