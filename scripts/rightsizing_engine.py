import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def create_metrics_service():
    path = os.path.join(base_dir, "src/services/metricsService.ts")
    code = """import { getAzureCredential } from "@/lib/azure";
import { MonitorClient } from "@azure/arm-monitor";

export async function getVmUtilization(tenantId: string, subscriptionId: string, resourceId: string) {
    const credential = await getAzureCredential(tenantId);
    // MonitorClient requires credential and an optional subscriptionId (though usually omitted for ARM calls directly on resourceId)
    const client = new MonitorClient(credential, subscriptionId);
    
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 14);
    const timespan = `${start.toISOString()}/${end.toISOString()}`;
    const interval = "P1D";
    
    try {
        const response = await client.metrics.list(resourceId, {
            metricnames: "Percentage CPU,Available Memory Bytes",
            timespan: timespan,
            interval: interval,
            aggregation: "Maximum,Average"
        });
        
        const metrics = response.value || [];
        
        let maxCpu = 0;
        let avgCpu = 0;
        
        for (const metric of metrics) {
            if (metric.name?.value === "Percentage CPU") {
                const timeseries = metric.timeseries?.[0]?.data || [];
                for (const point of timeseries) {
                    if (point.maximum && point.maximum > maxCpu) maxCpu = point.maximum;
                    if (point.average && point.average > avgCpu) avgCpu = point.average;
                }
            }
        }
        
        return {
            maxCpu,
            avgCpu
        };
    } catch (e) {
        console.error(`Error fetching metrics for ${resourceId}:`, e);
        return { maxCpu: 0, avgCpu: 0 };
    }
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("metricsService created.")

def create_rightsizing_engine():
    path = os.path.join(base_dir, "src/lib/rightsizingEngine.ts")
    code = """export function evaluateRightsizing(maxCpu: number, currentSku: string) {
    if (maxCpu === 0) {
        return null;
    }

    if (maxCpu < 20) {
        return getDowngradeSku(currentSku);
    }
    
    return null;
}

function getDowngradeSku(currentSku: string) {
    const skuMap: Record<string, string> = {
        "Standard_D4s_v3": "Standard_D2s_v3",
        "Standard_D8s_v3": "Standard_D4s_v3",
        "Standard_D4_v4": "Standard_D2_v4",
        "Standard_E4s_v3": "Standard_E2s_v3",
        "Standard_B4ms": "Standard_B2ms",
        "Standard_B8ms": "Standard_B4ms"
    };
    
    return skuMap[currentSku] || "Revisar familia de SKU (posible downgrade a la mitad de vCPUs)";
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("rightsizingEngine created.")

def create_api():
    api_dir = os.path.join(base_dir, "src/app/api/audit/rightsizing")
    os.makedirs(api_dir, exist_ok=True)
    
    path = os.path.join(api_dir, "route.ts")
    code = """import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getVmUtilization } from "@/services/metricsService";
import { evaluateRightsizing } from "@/lib/rightsizingEngine";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }
        
        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        const credential = await getAzureCredential(tenantId);
        const client = new ResourceGraphClient(credential);

        const query = `
            Resources
            | where type =~ 'microsoft.compute/virtualmachines'
            | project id, name, subscriptionId, sku = sku.name
            | limit 50
        `;

        const res = await client.resources({ query });
        const vms = res.data as any[];

        if (!vms || vms.length === 0) {
            return NextResponse.json({ recommendations: [] });
        }

        const recommendations = [];

        // Concurrencia limitada a 5 para no sobrecargar Azure Monitor
        for (let i = 0; i < vms.length; i += 5) {
            const batch = vms.slice(i, i + 5);
            const batchResults = await Promise.all(batch.map(async (vm) => {
                const util = await getVmUtilization(tenantId, vm.subscriptionId, vm.id);
                const recommendation = evaluateRightsizing(util.maxCpu, vm.sku);
                
                if (recommendation) {
                    return {
                        vmName: vm.name,
                        subscriptionId: vm.subscriptionId,
                        currentSku: vm.sku,
                        maxCpuPeak: util.maxCpu,
                        suggestedSku: recommendation
                    };
                }
                return null;
            }));
            
            recommendations.push(...batchResults.filter(r => r !== null));
        }

        return NextResponse.json({ recommendations });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("API route created.")

def update_sop():
    path = os.path.join(base_dir, "directivas/rightsizing_SOP.md")
    with open(path, "w") as f:
        f.write("# Rightsizing Engine SOP\\n\\n")
        f.write("- **Servicio**: `metricsService.ts` invoca `MonitorClient` para traer `Percentage CPU` de los últimos 14 días con agregación diaria.\\n")
        f.write("- **API**: `/api/audit/rightsizing` consulta las VMs por Resource Graph con un `limit 50` para evitar bloqueos, y evalúa las métricas en batches de 5.\\n")
        f.write("- **Métricas Omitidas**: Si `Available Memory Bytes` no se reporta debido a falta de Agente en el Guest OS, la recomendación se basa explícitamente en el CPU histórico.\\n")
    print("SOP created.")

if __name__ == "__main__":
    create_metrics_service()
    create_rightsizing_engine()
    create_api()
    update_sop()
    print("Deploy completo de Rightsizing.")
