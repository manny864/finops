import os
import subprocess

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("Instalando SDK de Azure Monitor...")
    subprocess.run(["npm", "install", "@azure/arm-monitor"], cwd=base_dir)

    print("Generando SOP de Rightsizing...")
    sop_path = os.path.join(base_dir, "directivas/rightsizing_SOP.md")
    os.makedirs(os.path.dirname(sop_path), exist_ok=True)
    with open(sop_path, "w") as f:
        f.write("# Rightsizing Engine SOP\\n\\n")
        f.write("- **Azure Monitor API**: Se consulta `Percentage CPU` utilizando la sintaxis de ISO 8601 Duration (`P14D` para timespan, `P1D` para intervalo).\\n")
        f.write("- **Lógica de Decisión**: Máquinas con Pico CPU (Maximum) inferior a 20% en un periodo de 14 días se marcan como subutilizadas.\\n")
        f.write("- **Concurrencia**: Al leer métricas de múltiples VMs, se envuelve en `Promise.all` para evitar tiempos de espera prolongados en el backend.\\n")

    print("Creando metricsService.ts...")
    service_path = os.path.join(base_dir, "src/services/metricsService.ts")
    with open(service_path, "w") as f:
        f.write("""import { MonitorClient } from "@azure/arm-monitor";
import { getAzureCredential } from "../lib/azure";

export async function getVmUtilization(tenantId: string, subscriptionId: string, resourceId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new MonitorClient(credential, subscriptionId);

    const now = new Date();
    const past14Days = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const timespan = `${past14Days.toISOString()}/${now.toISOString()}`;

    try {
        const metrics = await client.metrics.list(resourceId, {
            timespan,
            interval: "P1D",
            metricnames: "Percentage CPU",
            aggregation: "Maximum,Average"
        });

        let maxCpu = 0;
        let avgSum = 0;
        let avgCount = 0;

        const timeSeries = metrics.value[0]?.timeseries?.[0]?.data || [];
        
        for (const data of timeSeries) {
            if (data.maximum !== undefined && data.maximum > maxCpu) {
                maxCpu = data.maximum;
            }
            if (data.average !== undefined) {
                avgSum += data.average;
                avgCount++;
            }
        }

        const avgCpu = avgCount > 0 ? avgSum / avgCount : 0;

        return { maxCpu, avgCpu };
    } catch (error) {
        console.error(`Error fetching metrics for ${resourceId}:`, error);
        return { maxCpu: 0, avgCpu: 0 };
    }
}
""")

    print("Creando rightsizingEngine.ts...")
    engine_path = os.path.join(base_dir, "src/lib/rightsizingEngine.ts")
    with open(engine_path, "w") as f:
        f.write("""export function analyzeVmEfficiency(vm: any, metrics: { maxCpu: number, avgCpu: number }) {
    const skuMapping: Record<string, string> = {
        "Standard_D8s_v3": "Standard_D4s_v3",
        "Standard_D4s_v3": "Standard_D2s_v3",
        "Standard_B4ms": "Standard_B2ms",
        "Standard_B2ms": "Standard_B2s",
        "Standard_E8s_v3": "Standard_E4s_v3",
        "Standard_F8s_v2": "Standard_F4s_v2"
    };

    let isUnderutilized = false;
    let recommendedSku = "Sin recomendación clara";

    if (metrics.maxCpu > 0 && metrics.maxCpu < 20) {
        isUnderutilized = true;
        
        if (vm.sku && skuMapping[vm.sku]) {
            recommendedSku = skuMapping[vm.sku];
        } else {
            recommendedSku = "Analizar reducción (1 tier menos)";
        }
    }

    return {
        isUnderutilized,
        recommendedSku,
        maxCpu: metrics.maxCpu,
        avgCpu: metrics.avgCpu
    };
}
""")

    print("Creando API route...")
    api_dir = os.path.join(base_dir, "src/app/api/intelligence/rightsizing")
    os.makedirs(api_dir, exist_ok=True)
    with open(os.path.join(api_dir, "route.ts"), "w") as f:
        f.write("""import { NextRequest, NextResponse } from 'next/server';
import { getResourceGraphClient } from '@/lib/azure';
import { getVmUtilization } from '@/services/metricsService';
import { analyzeVmEfficiency } from '@/lib/rightsizingEngine';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');
        const subscriptionId = request.headers.get('x-subscription-id');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: 'Faltan credenciales del entorno' }, { status: 400 });
        }

        const argClient = await getResourceGraphClient(tenantId);

        const query = `
            Resources
            | where type =~ 'microsoft.compute/virtualmachines'
            | where subscriptionId =~ '${subscriptionId}'
            | project id, name, sku = sku.name, location
        `;

        const response = await argClient.resources({ query });
        const vms = response.data as any[];

        if (!vms || vms.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        const rightsizingPromises = vms.map(async (vm) => {
            const metrics = await getVmUtilization(tenantId, subscriptionId, vm.id);
            const analysis = analyzeVmEfficiency(vm, metrics);
            
            return {
                id: vm.id,
                name: vm.name,
                currentSku: vm.sku,
                maxCpu: analysis.maxCpu,
                avgCpu: analysis.avgCpu,
                recommendedSku: analysis.recommendedSku,
                isUnderutilized: analysis.isUnderutilized
            };
        });

        const results = await Promise.all(rightsizingPromises);
        
        const underutilizedVms = results.filter(r => r.isUnderutilized);

        return NextResponse.json({ success: true, data: underutilizedVms });
    } catch (error: any) {
        console.error('Rightsizing API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
""")

    print("Creando UI en page.tsx...")
    page_path = os.path.join(base_dir, "src/app/intelligence/rightsizing/page.tsx")
    with open(page_path, "w") as f:
        f.write(""""use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { Zap, AlertTriangle, ArrowRight, CheckCircle } from "lucide-react";

export default function RightsizingPage() {
  const { selectedTenant } = useTenant();
  const [vms, setVms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedTenant || selectedTenant.id === 'default') return;

    const fetchRightsizing = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch('/api/intelligence/rightsizing', {
            headers: {
                'x-tenant-id': selectedTenant.id,
                'x-subscription-id': selectedTenant.id
            }
        });
        const json = await res.json();
        if (json.success) {
            setVms(json.data);
        } else {
            setError(json.error || "Error al obtener recomendaciones");
        }
      } catch(e) {
          setError("Error de red");
      }
      setLoading(false);
    };

    fetchRightsizing();
  }, [selectedTenant]);

  const handleDowngrade = (vmName: string) => {
      alert(`Simulando aplicación de Downgrade automático para la VM: ${vmName}`);
  };

  if (selectedTenant.id === 'default') return null;

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6 flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center">
             <Zap className="w-8 h-8 mr-3 text-amber-500" />
             Rightsizing Engine
          </h1>
          <p className="text-gray-500 mt-2">Detección de máquinas virtuales subutilizadas (Pico CPU &lt; 20% en 14 días).</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg mb-6">
            <p className="text-red-700 font-bold">Error:</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
        </div>
      )}

      {loading && (
        <div className="bg-white p-10 rounded-xl shadow-sm border border-gray-200 text-center animate-pulse">
            <Zap className="w-10 h-10 mx-auto text-amber-300 mb-4 animate-bounce" />
            <p className="text-gray-500 font-medium">Analizando telemetría de 14 días para todas las VMs...</p>
        </div>
      )}

      {!loading && !error && vms.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
            <CheckCircle className="w-16 h-16 mx-auto text-green-500 mb-4" />
            <h3 className="text-xl font-bold text-green-800">Infraestructura Optimizada</h3>
            <p className="text-green-600 mt-2">No se detectaron Máquinas Virtuales subutilizadas en la suscripción.</p>
        </div>
      )}

      {!loading && vms.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Nombre de VM</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">SKU Actual</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Pico Máx. CPU (14 días)</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">SKU Recomendado</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {vms.map((vm, idx) => (
                            <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 flex items-center">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 mr-2" />
                                    {vm.name}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                    <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded border border-gray-200 font-mono text-xs">
                                        {vm.currentSku}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <div className="w-full bg-gray-200 rounded-full h-2 mr-2 max-w-[4rem]">
                                            <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${Math.max(vm.maxCpu, 5)}%` }}></div>
                                        </div>
                                        <span className="text-sm font-bold text-amber-600">{vm.maxCpu.toFixed(1)}%</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                    <div className="flex items-center text-green-600 font-bold">
                                        <ArrowRight className="w-4 h-4 mr-1" />
                                        <span className="bg-green-50 px-2 py-1 rounded border border-green-200 font-mono text-xs">
                                            {vm.recommendedSku}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                    <button
                                        onClick={() => handleDowngrade(vm.name)}
                                        className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-md text-xs font-bold shadow-sm transition-colors"
                                    >
                                        Aplicar Downgrade
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
      )}
    </div>
  );
}
""")

if __name__ == "__main__":
    deploy()
    print("Rightsizing Module Deploy completed.")
