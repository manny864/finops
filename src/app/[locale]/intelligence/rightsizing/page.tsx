"use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useViewMode } from "@/context/ViewModeContext";
import { Zap, AlertTriangle, ArrowRight, CheckCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getMockDataForRoute } from '@/lib/mockData';

export default function RightsizingPage() {
  const t = useTranslations("Rightsizing");
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const { selectedSubscription, subscriptions } = useSubscription();
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
        if (selectedTenant.id === 'demo_tenant') {
            const mock = getMockDataForRoute('rightsizing', 'demo_tenant');
            if (mock?.success) {
                setVms((mock.data as any[]) || []);
            }
        } else {
            const res = await fetch('/api/intelligence/rightsizing', {
                headers: {
                    'x-tenant-id': selectedTenant.id,
                    'x-subscription-id': selectedSubscription
                }
            });
            const json = await res.json();
            if (json.success) {
                setVms(json.data || []);
            } else {
                setError(json.error || "Error");
            }
        }
      } catch(e) {
          setError("Error");
      }
      setLoading(false);
    };

    fetchRightsizing();
  }, [selectedTenant, selectedSubscription]);

  const handleDowngrade = async (vm: any) => {
      if (!window.confirm(`¿Estás seguro de hacer downgrade de la máquina ${vm.name} al tamaño ${vm.recommendedSku}? Esto podría reiniciar la máquina.`)) return;
      try {
          const account = accounts[0];
          const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
          
          const res = await fetch('/api/remediation/downgrade', {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${tokenResponse.idToken}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                  tenantId: selectedTenant.id,
                  subscriptionId: vm.subscriptionId,
                  resourceGroup: vm.id.split('/')[4],
                  resourceName: vm.name,
                  newSku: vm.recommendedSku
              })
          });
          const json = await res.json();
          if (json.success) {
              alert(`Downgrade iniciado para ${vm.name}`);
              setVms(prev => prev.filter(v => v.id !== vm.id));
          } else {
              alert(`Error: ${json.error}`);
          }
      } catch (e) {
          alert(`Error al aplicar downgrade: ${e}`);
      }
  };

  const handleDeleteStoppedVm = async (vm: any) => {
      if (!window.confirm(`¿Estás seguro de ELIMINAR la máquina virtual deallocated ${vm.name} permanentemente? Se recomienda realizar un snapshot de sus discos en Azure Portal antes de continuar.`)) return;
      try {
          const account = accounts[0];
          const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
          
          const res = await fetch('/api/remediation', {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${tokenResponse.idToken}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                  tenantId: selectedTenant.id,
                  subscriptionId: vm.subscriptionId,
                  resourceGroup: vm.id.split('/')[4],
                  resourceName: vm.name,
                  resourceType: 'microsoft.compute/virtualmachines'
              })
          });
          const json = await res.json();
          if (json.success) {
              alert(`Eliminación iniciada para la VM ${vm.name}`);
              setVms(prev => prev.filter(v => v.id !== vm.id));
          } else {
              alert(`Error: ${json.error}`);
          }
      } catch (e) {
          alert(`Error al eliminar la VM: ${e}`);
      }
  };

  if (selectedTenant.id === 'default') return null;

  return (
    <div className="content animate-in fade-in duration-500">
      <div className="vhead">
        <div>
          <div className="vt">
             <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">📐</span>
             {t("title")}
          </div>
          <div className="vs">{t("subtitle")}</div>
        </div>
        <div className="right">
          <span className="scopechip">📍 {selectedTenant?.name || "Tenant"}</span>
        </div>
      </div>

      {error && (
        <div className="card">
            <div className="card-h">
                <h3 className="text-danger">⚠️ {t("permissions_error")}</h3>
            </div>
            <div className="p-[18px]">
                <div className="text-sm text-ink-soft">
                    <p>{t("permissions_desc")}</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-ink">
                        <li><strong>{t("permissions_reason1")}</strong></li>
                        <li>{t("permissions_reason2")}</li>
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
            <p className="text-ink-soft font-bold">{t("analyzing")}</p>
        </div>
      )}

      {!loading && !error && (!vms || vms.length === 0) && (
        <div className="empty">
            <CheckCircle className="w-16 h-16 mx-auto text-green mb-4" />
            <h3 className="text-xl font-bold text-green">{t("optimized_title")}</h3>
            <p className="text-green mt-2">{t("optimized_desc")}</p>
        </div>
      )}

      {!loading && vms && vms.length > 0 && (
        <div className="card">
            <div className="card-h">
                <h3>📉 {t("recommendations_title")}</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="tbl">
                    <thead>
                        <tr>
                            <th>{t("col_vm_name")}</th>
                            <th>{t("col_subscription")}</th>
                            {viewMode === 'engineer' && <th>Raw ARM ID</th>}
                            <th>{t("col_current_sku")}</th>
                            <th>{t("col_peak_cpu")}</th>
                            <th>{t("col_recommended_sku")}</th>
                            <th className="num">{t("col_action")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vms?.map((vm, idx) => (
                            <tr key={idx}>
                                <td>
                                    <div className="flex items-center gap-[7px] font-bold text-ink">
                                        <AlertTriangle className={`w-4 h-4 ${vm.reason === 'Deallocated VM with attached Storage' ? 'text-rose-500' : 'text-amber'}`} />
                                        {vm.name}
                                    </div>
                                    {vm.reason === 'Deallocated VM with attached Storage' && (
                                        <span className="text-[10px] text-rose-500 font-bold block ml-[23px]">
                                            Deallocated VM (Falso Ahorro)
                                        </span>
                                    )}
                                </td>
                                <td>{subscriptions.find(s => s.id.toLowerCase() === vm.subscriptionId.toLowerCase())?.name || vm.subscriptionId}</td>
                                {viewMode === 'engineer' && (
                                    <td className="font-mono text-xs max-w-xs truncate" title={vm.id}>
                                        {vm.id}
                                    </td>
                                )}
                                <td><span className="tag grey font-mono">{vm.currentSku}</span></td>
                                <td>
                                    {vm.reason === 'Deallocated VM with attached Storage' ? (
                                        <span className="text-xs font-semibold text-gray-400">VM Apagada</span>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <div className="w-full bg-surface-2 rounded-full h-2 mr-2 max-w-[4rem] border border-line">
                                                <div className="bg-amber h-full rounded-full" style={{ width: `${Math.max(vm.maxCpu, 5)}%` }}></div>
                                            </div>
                                            <span className="font-bold text-amber">{vm.maxCpu.toFixed(1)}%</span>
                                        </div>
                                    )}
                                </td>
                                <td>
                                    <div className="flex flex-col items-start gap-1">
                                        <div className="flex items-center text-green font-bold gap-2">
                                            <ArrowRight className="w-4 h-4" />
                                            <span className={`tag font-mono ${vm.reason === 'Deallocated VM with attached Storage' ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'green'}`}>{vm.recommendedSku}</span>
                                        </div>
                                        {vm.hiddenCost > 0 && (
                                            <span className="text-xs text-rose-500 font-bold ml-6" title="Gasto oculto por almacenamiento adjunto activo">
                                                Costo Oculto: {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(vm.hiddenCost)}/mes
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="num">
                                    {vm.reason === 'Deallocated VM with attached Storage' ? (
                                        <button
                                            onClick={() => handleDeleteStoppedVm(vm)}
                                            className="font-heading font-semibold text-[12px] rounded-[10px] bg-rose-600 text-white p-[7px_11px] cursor-pointer hover:bg-rose-700 active:scale-95 transition-all shadow-sm"
                                        >
                                            Snapshot & Delete
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleDowngrade(vm)}
                                            className="font-heading font-semibold text-[12px] rounded-[10px] bg-amber text-white p-[7px_11px] cursor-pointer hover:brightness-110 active:scale-95 transition-all shadow-sm"
                                        >
                                            {t("btn_downgrade")}
                                        </button>
                                    )}
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
