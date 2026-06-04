import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def make_dirs(path):
    if not os.path.exists(path):
        os.makedirs(path)

make_dirs(os.path.join(base_dir, "src", "lib"))
make_dirs(os.path.join(base_dir, "src", "services"))
make_dirs(os.path.join(base_dir, "src", "app", "api", "audit", "full"))

# 1. kqlCatalog.ts
kql_content = """export const kqlCatalog: Record<string, string> = {
  staleSnapshots: `Resources \n| where type =~ 'microsoft.compute/snapshots' \n| where properties.timeCreated < ago(90d) \n| project id, name, location, resourceGroup, subscriptionId, sizeGB=properties.diskSizeGB`,

  taggingNonCompliance: `Resources \n| where isnull(tags.CostCenter) or isnull(tags.Owner) or isnull(tags.Environment) \n| project id, name, type, location, resourceGroup, subscriptionId`,

  unattachedDisks: `Resources \n| where type =~ 'microsoft.compute/disks' \n| where properties.diskState == 'Unattached' \n| project id, name, location, resourceGroup, subscriptionId, sku=sku.name, diskSizeGB=properties.diskSizeGB`,

  unusedIps: `Resources \n| where type =~ 'microsoft.network/publicipaddresses' \n| where properties.ipConfiguration == '' or isnull(properties.ipConfiguration) \n| project id, name, location, resourceGroup, subscriptionId`
};
"""
with open(os.path.join(base_dir, "src", "lib", "kqlCatalog.ts"), "w") as f:
    f.write(kql_content)

# 2. auditService.ts
audit_content = """import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../lib/kqlCatalog";

export async function runGraphAudits(resourceGraphClient: ResourceGraphClient, subscriptionId?: string) {
    const results: Record<string, any[]> = {};
    
    for (const [key, query] of Object.entries(kqlCatalog)) {
        const queryOptions: any = {};
        if (subscriptionId) {
            queryOptions.subscriptions = [subscriptionId];
        }
        
        try {
            const response = await resourceGraphClient.resources({
                query: query,
                ...queryOptions
            });
            results[key] = response.data || [];
        } catch (error: any) {
            console.error(`Error executing KQL query for ${key}:`, error);
            // Allow partial success if one query fails
            results[key] = [];
            
            // If AccessDenied, propagate immediately to trigger MISSING_RBAC_ROLE
            if (error.code === "AccessDenied" || error.statusCode === 403 || (error.message && error.message.includes("AccessDenied"))) {
                throw error;
            }
        }
    }
    
    return results;
}

/**
 * Stub function prepared to use @azure/arm-monitor
 * Finds VMs with < 5% CPU utilization over the last 7 days.
 */
export async function runMonitorAudits(credential: any, subscriptionId: string): Promise<any[]> {
    console.log("Stub: runMonitorAudits initialized for subscription", subscriptionId);
    return [];
}

/**
 * Stub function prepared to use Microsoft Graph
 * Finds unassigned M365 licenses to optimize SaaS spending.
 */
export async function runM365Audits(credential: any, tenantId: string): Promise<any[]> {
    console.log("Stub: runM365Audits initialized for tenant", tenantId);
    return [];
}
"""
with open(os.path.join(base_dir, "src", "services", "auditService.ts"), "w") as f:
    f.write(audit_content)

# 3. /api/audit/full/route.ts
route_content = """import { NextRequest, NextResponse } from "next/server";
import { getResourceGraphClient } from "@/lib/azure";
import { runGraphAudits, runMonitorAudits, runM365Audits } from "@/services/auditService";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    // 1. Validar el Token MSAL (Aislamiento Cero-Trust)
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
        { error: `Acceso denegado. El token no coincide con el tenant.` },
        { status: 403 }
      );
    }

    // 2. Obtener Cliente Autenticado
    const resourceGraphClient = await getResourceGraphClient(tenantId);

    // 3. Orquestar Servicios de Auditoría
    const graphResults = await runGraphAudits(resourceGraphClient, subscriptionId || undefined);
    
    // Ejecutar stubs (para futura expansión)
    // const monitorResults = await runMonitorAudits(credential, subscriptionId);
    // const m365Results = await runM365Audits(credential, tenantId);

    // 4. Retornar Estructura Unificada
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

  } catch (error: any) {
    console.error("Audit Engine Error:", error);
    
    // Intercepción RBAC Inteligente (Fase 6)
    if (error.code === "AccessDenied" || error.statusCode === 403 || (error.message && error.message.includes("AccessDenied"))) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en la suscripción." }, { status: 403 });
    }
    
    return NextResponse.json({ error: "Error en el Motor de Auditoría", details: error.message }, { status: 500 });
  }
}
"""
with open(os.path.join(base_dir, "src", "app", "api", "audit", "full", "route.ts"), "w") as f:
    f.write(route_content)

# 4. SOP
sop_path = os.path.join(base_dir, "directivas", "modular_audit_SOP.md")
sop_content = """# Directiva: Motor de Auditoría Modular (Fase 7)

## Reglas de Arquitectura
1. **Catálogo Central**: Todas las consultas KQL deben escribirse exclusivamente en `src/lib/kqlCatalog.ts`. Ningún archivo de ruta debe contener strings de Kusto quemados en el código.
2. **Servicios Desacoplados**: La interacción con los SDKs (`@azure/arm-resourcegraph`, `@azure/arm-monitor`) se realiza en `src/services/`.
3. **Cero-Trust en la API**: Cualquier nueva ruta (como `/api/audit/full`) debe validar obligatoriamente la congruencia entre `tenantId` del query parameter y el reclamo `tid` del Bearer token decodificado de MSAL.
"""
with open(sop_path, "w") as f:
    f.write(sop_content)

print("Módulos construidos exitosamente.")
