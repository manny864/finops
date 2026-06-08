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
    <div className="content animate-in fade-in duration-500">
      <div className="vhead">
        <div>
          <div className="vt">
             <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">📐</span>
             Rightsizing Engine
          </div>
          <div className="vs">Detección de máquinas virtuales subutilizadas (Pico CPU &lt; 20% en 14 días).</div>
        </div>
        <div className="right">
          <span className="scopechip">📍 {selectedTenant?.name || "Tenant"}</span>
        </div>
      </div>

      {error && (
        <div className="card">
            <div className="card-h">
                <h3 className="text-danger">⚠️ Permisos Restringidos</h3>
            </div>
            <div className="p-[18px]">
                <div className="text-sm text-ink-soft">
                    <p>Azure Resource Graph ha bloqueado la consulta. Razones comunes:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-ink">
                        <li>Falta el rol de <strong>Reader</strong>.</li>
                        <li>La suscripción no existe.</li>
                    </ul>
                    <div className="mt-4 p-3 bg-danger-soft rounded border border-line font-mono text-xs text-danger break-all">
                        <strong>Log técnico:</strong> {error}
                    </div>
                </div>
            </div>
        </div>
      )}

      {loading && (
        <div className="empty">
            <Zap className="w-10 h-10 mx-auto text-amber mb-4 animate-bounce" />
            <p className="text-ink-soft font-bold">Analizando telemetría de 14 días para todas las VMs...</p>
        </div>
      )}

      {!loading && !error && vms.length === 0 && (
        <div className="empty">
            <CheckCircle className="w-16 h-16 mx-auto text-green mb-4" />
            <h3 className="text-xl font-bold text-green">Infraestructura Optimizada</h3>
            <p className="text-green mt-2">No se detectaron Máquinas Virtuales subutilizadas.</p>
        </div>
      )}

      {!loading && vms.length > 0 && (
        <div className="card">
            <div className="card-h">
                <h3>📉 Recomendaciones de Downgrade</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="tbl">
                    <thead>
                        <tr>
                            <th>Nombre de VM</th>
                            <th>Suscripción</th>
                            {viewMode === 'engineer' && <th>Raw ARM ID</th>}
                            <th>SKU Actual</th>
                            <th>Pico Máx. CPU (14 días)</th>
                            <th>SKU Recomendado</th>
                            <th className="num">Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vms.map((vm, idx) => (
                            <tr key={idx}>
                                <td>
                                    <div className="flex items-center gap-[7px] font-bold text-ink">
                                        <AlertTriangle className="w-4 h-4 text-amber" />
                                        {vm.name}
                                    </div>
                                </td>
                                <td>{vm.subscriptionId}</td>
                                {viewMode === 'engineer' && (
                                    <td className="font-mono text-xs max-w-xs truncate" title={vm.id}>
                                        {vm.id}
                                    </td>
                                )}
                                <td><span className="tag grey font-mono">{vm.currentSku}</span></td>
                                <td>
                                    <div className="flex items-center gap-2">
                                        <div className="w-full bg-surface-2 rounded-full h-2 mr-2 max-w-[4rem] border border-line">
                                            <div className="bg-amber h-full rounded-full" style={{ width: `${Math.max(vm.maxCpu, 5)}%` }}></div>
                                        </div>
                                        <span className="font-bold text-amber">{vm.maxCpu.toFixed(1)}%</span>
                                    </div>
                                </td>
                                <td>
                                    <div className="flex items-center text-green font-bold gap-2">
                                        <ArrowRight className="w-4 h-4" />
                                        <span className="tag green font-mono">{vm.recommendedSku}</span>
                                    </div>
                                </td>
                                <td className="num">
                                    <button
                                        onClick={() => handleDowngrade(vm.name)}
                                        className="font-heading font-semibold text-[12px] rounded-[10px] bg-amber text-white p-[7px_11px] cursor-pointer hover:brightness-110 active:scale-95 transition-all shadow-sm"
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
