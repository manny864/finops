"use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useViewMode } from "@/context/ViewModeContext";
import { Zap, AlertTriangle, ArrowRight, CheckCircle } from "lucide-react";

export default function RightsizingPage() {
  const { selectedTenant } = useTenant();
  const { selectedSubscription } = useSubscription();
  const { viewMode } = useViewMode();
  const [vms, setVms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedTenant || selectedTenant.id === 'default' || !selectedSubscription) return;

    const fetchRightsizing = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch('/api/intelligence/rightsizing', {
            headers: {
                'x-tenant-id': selectedTenant.id,
                'x-subscription-id': selectedSubscription
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
  }, [selectedTenant, selectedSubscription]);

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
        <div className="bg-white border-l-4 border-amber-500 shadow-sm p-6 rounded-lg mb-6 flex items-start">
            <div className="flex-shrink-0">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
            </div>
            <div className="ml-4">
                <h3 className="text-lg font-bold text-gray-900">Permisos de Resource Graph Restringidos</h3>
                <div className="mt-2 text-sm text-gray-600">
                    <p>Azure Resource Graph ha bloqueado la consulta de Máquinas Virtuales para la suscripción solicitada. Esto sucede comúnmente por dos razones:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-700">
                        <li>El Service Principal (Enterprise App) no tiene el rol de <strong>Reader</strong> (Lector) o <strong>Monitoring Reader</strong> asignado a nivel Suscripción.</li>
                        <li>La suscripción proporcionada no existe en este Tenant o ha sido cancelada.</li>
                    </ul>
                    <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200 font-mono text-xs text-red-600 break-all">
                        <strong>Log técnico:</strong> {error}
                    </div>
                </div>
            </div>
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
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Suscripción</th>
                            {viewMode === 'engineer' && <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Raw ARM ID</th>}
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
                                <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                                    {vm.subscriptionId}
                                </td>
                                {viewMode === 'engineer' && (
                                    <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-400 max-w-xs truncate" title={vm.id}>
                                        {vm.id}
                                    </td>
                                )}
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
