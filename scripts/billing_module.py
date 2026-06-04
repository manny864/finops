import os
import subprocess

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    # 1. install
    print("Instalando SDK de Azure Cost Management...")
    subprocess.run(["npm", "install", "@azure/arm-costmanagement"], cwd=base_dir)

    # 2. service
    service_path = os.path.join(base_dir, "src/services/billingService.ts")
    with open(service_path, "w") as f:
        f.write("""import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential } from "../lib/azure";

export async function getCurrentMonthAmortizedCosts(tenantId: string, subscriptionId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const scope = `/subscriptions/${subscriptionId}`;
    
    const result = await client.query.usage(scope, {
        type: "Usage",
        timeframe: "MonthToDate",
        dataset: {
            granularity: "Daily",
            aggregation: {
                totalCost: {
                    name: "AmortizedCost",
                    function: "Sum"
                }
            },
            grouping: [
                { type: "Dimension", name: "ServiceName" }
            ]
        }
    });

    if (!result.rows) return { costByService: [], dailyTrend: [], totalCost: 0 };

    let totalCost = 0;
    const serviceMap: Record<string, number> = {};
    const dailyMap: Record<string, number> = {};

    result.rows.forEach(row => {
        const cost = Number(row[0]) || 0;
        const dateStr = String(row[1]);
        const service = String(row[2]);

        totalCost += cost;

        if (!serviceMap[service]) serviceMap[service] = 0;
        serviceMap[service] += cost;

        if (!dailyMap[dateStr]) dailyMap[dateStr] = 0;
        dailyMap[dateStr] += cost;
    });

    const costByService = Object.keys(serviceMap).map(k => ({
        name: k,
        cost: Number(serviceMap[k].toFixed(2))
    })).sort((a, b) => b.cost - a.cost);

    const dailyTrend = Object.keys(dailyMap).sort().map(k => {
        const formattedDate = k.length === 8 ? `${k.substring(0,4)}-${k.substring(4,6)}-${k.substring(6,8)}` : k;
        return {
            date: formattedDate,
            cost: Number(dailyMap[k].toFixed(2))
        };
    });

    return {
        costByService,
        dailyTrend,
        totalCost: Number(totalCost.toFixed(2))
    };
}
""")

    # 3. API
    api_dir = os.path.join(base_dir, "src/app/api/intelligence/billing")
    os.makedirs(api_dir, exist_ok=True)
    with open(os.path.join(api_dir, "route.ts"), "w") as f:
        f.write("""import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMonthAmortizedCosts } from '@/services/billingService';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');
        const subscriptionId = request.headers.get('x-subscription-id');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: 'Faltan credenciales del entorno' }, { status: 400 });
        }

        const data = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId);
        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Billing API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
""")

    # 4. Frontend
    page_path = os.path.join(base_dir, "src/app/intelligence/billing/page.tsx")
    with open(page_path, "w") as f:
        f.write(""""use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid
} from 'recharts';
import { PieChart, DollarSign, Activity } from "lucide-react";

export default function BillingPage() {
  const { selectedTenant } = useTenant();
  const [data, setData] = useState<{costByService: any[], dailyTrend: any[], totalCost: number} | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedTenant || selectedTenant.id === 'default') return;

    const fetchBilling = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch('/api/intelligence/billing', {
            headers: {
                'x-tenant-id': selectedTenant.id,
                'x-subscription-id': selectedTenant.id
            }
        });
        const json = await res.json();
        if (json.success) {
            setData(json.data);
        } else {
            setError(json.error || "Error al obtener facturación");
        }
      } catch(e) {
          setError("Error de red");
      }
      setLoading(false);
    };

    fetchBilling();
  }, [selectedTenant]);

  if (selectedTenant.id === 'default') return null;

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6 flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center">
             <PieChart className="w-8 h-8 mr-3 text-[#0054A6]" />
             Consumo y Facturación
          </h1>
          <p className="text-gray-500 mt-2">Visibilidad de costos amortizados en el mes en curso.</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6">
            Error: {error}. Revise que el entorno tenga permisos de lectura en Cost Management.
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse">
            <div className="bg-gray-200 h-32 rounded-xl"></div>
            <div className="bg-gray-200 h-32 rounded-xl md:col-span-2"></div>
            <div className="bg-gray-200 h-80 rounded-xl md:col-span-3"></div>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-6">
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Costo Amortizado (MTD)</p>
                        <h2 className="text-4xl font-black text-gray-900">${data.totalCost.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</h2>
                    </div>
                    <div className="p-3 bg-blue-50 text-[#0054A6] rounded-full">
                        <DollarSign className="w-8 h-8" />
                    </div>
                </div>

                <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm md:col-span-2">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center">
                        <Activity className="w-4 h-4 mr-2" />
                        Tendencia Diaria de Consumo
                    </h3>
                    <div className="h-24 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.dailyTrend}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                <Tooltip 
                                    formatter={(v: any) => [`$${v} USD`, 'Costo']}
                                    labelStyle={{ color: '#374151', fontWeight: 'bold' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Line type="monotone" dataKey="cost" stroke="#0054A6" strokeWidth={3} dot={{r:3}} activeDot={{r: 6}} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Bar Chart by Service */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden p-6">
                <h3 className="text-lg font-bold text-gray-800 mb-6 border-b border-gray-100 pb-4">
                    Desglose de Costos por Servicio
                </h3>
                <div className="h-96 w-full">
                    {data.costByService.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.costByService} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                                <YAxis dataKey="name" type="category" width={150} tick={{fontSize: 12, fill: '#4B5563'}} />
                                <Tooltip 
                                    cursor={{fill: '#f9fafb'}}
                                    formatter={(v: any) => [`$${v} USD`, 'Costo']}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                                    {data.costByService.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={index === 0 ? '#EF4444' : index === 1 ? '#F59E0B' : '#0054A6'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400">
                            <p className="font-medium">No se detectaron costos en este periodo.</p>
                        </div>
                    )}
                </div>
            </div>

        </div>
      )}
    </div>
  );
}
""")

    # 5. SOP
    sop_path = os.path.join(base_dir, "directivas/billing_module_SOP.md")
    with open(sop_path, "w") as f:
        f.write("# Billing Module SOP\\n\\n")
        f.write("- **Cost Management API**: `CostManagementClient.query.usage()` devuelve matrices sin nombres de columna. Columna 0 es costo, 1 es fecha, 2 es nombre de dimension.\\n")
        f.write("- **Fechas**: La API requiere cortes en ISO 8601 sin milisegundos (`YYYY-MM-DDTHH:mm:ssZ`). Para simplificar, se recomienda enviar el Timeframe absoluto `MonthToDate`.\\n")

if __name__ == "__main__":
    deploy()
    print("Billing Module Deploy completed.")
