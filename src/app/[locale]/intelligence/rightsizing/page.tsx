"use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useViewMode } from "@/context/ViewModeContext";
import { Zap, AlertTriangle, ArrowRight, CheckCircle, Ruler, MapPin, TrendingDown, ShieldCheck, Shield, Edit3, Trash2, X, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getMockDataForRoute } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import MockBanner from '@/components/MockBanner';
import TelemetryDisclaimerBanner from '@/components/TelemetryDisclaimerBanner';
import HistoryButton from '@/components/history/HistoryButton';
import Pagination, { usePagination } from '@/components/Pagination';
import PageHeaderTierBadge from '@/components/dashboard/PageHeaderTierBadge';

export default function RightsizingPage() {
  const t = useTranslations("Rightsizing");
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const { selectedSubscription, subscriptions } = useSubscription();
  const { viewMode } = useViewMode();
  const [vms, setVms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<'all' | 'active' | 'exempted'>('all');

  // Modal State
  const [exemptionModalVm, setExemptionModalVm] = useState<any | null>(null);
  const [reasonInput, setReasonInput] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [savingExemption, setSavingExemption] = useState(false);

  const filteredVms = (vms || []).filter(v => {
    if (filter === 'active') return !v.isExempted;
    if (filter === 'exempted') return !!v.isExempted;
    return true;
  });

  const { page, setPage, pageSize, setPageSize, total, totalPages, paged: pagedVms } = usePagination(filteredVms);

  const fetchRightsizing = async () => {
    if (!selectedTenant || selectedTenant.id === 'default' || !selectedSubscription) return;
    setLoading(true);
    setError("");
    try {
      if (selectedTenant.id === 'demo_tenant') {
          const mock = getMockDataForRoute('rightsizing', 'demo_tenant');
          if (mock?.success) {
              setVms((mock.data as any[]) || []);
          }
      } else {
          const idToken = accounts.length > 0
              ? await getFreshIdToken(instance, accounts[0], ['User.Read'])
              : '';
          const res = await fetch('/api/intelligence/rightsizing', {
              headers: {
                  'Authorization': `Bearer ${idToken}`,
                  'x-tenant-id': selectedTenant.id,
                  'x-subscription-id': selectedSubscription
              }
          });
          const json = await res.json();
          if (json.success) {
              setVms(json.data || []);
          } else {
              setError(json.error || t("generic_error"));
          }
      }
    } catch(e) {
        setError(t("generic_error"));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRightsizing();
  }, [selectedTenant, selectedSubscription]);

  const handleOpenExemptionModal = (vm: any) => {
    setExemptionModalVm(vm);
    setReasonInput(vm.exemptionReason || (vm.name.includes("worker") || vm.name.includes("backup") ? "VM requerida para backups periódicos de MySQL" : "Eximida por decisión del usuario"));
    setCommentInput(vm.exemptionComment || "");
  };

  const handleSaveExemption = async () => {
    if (!exemptionModalVm) return;
    setSavingExemption(true);
    try {
      if (selectedTenant.id === 'demo_tenant') {
        setVms(prev => prev.map(v => v.id === exemptionModalVm.id ? {
          ...v,
          isExempted: true,
          exemptionReason: reasonInput || "Eximida por el usuario",
          exemptionComment: commentInput || null
        } : v));
        setExemptionModalVm(null);
        setSavingExemption(false);
        return;
      }

      const account = accounts[0];
      const token = await getFreshIdToken(instance, account);

      const res = await fetch('/api/intelligence/rightsizing/exemptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-tenant-id': selectedTenant.id
        },
        body: JSON.stringify({
          resourceId: exemptionModalVm.id,
          resourceName: exemptionModalVm.name,
          recommendationType: 'rightsizing',
          reason: reasonInput || "Eximida por el usuario",
          comment: commentInput || null
        })
      });
      const json = await res.json();
      if (json.success) {
        setVms(prev => prev.map(v => v.id === exemptionModalVm.id ? {
          ...v,
          isExempted: true,
          exemptionReason: reasonInput || "Eximida por el usuario",
          exemptionComment: commentInput || null
        } : v));
        setExemptionModalVm(null);
      } else {
        alert(t("error_prefix", { error: json.error }));
      }
    } catch (e: any) {
      alert(t("error_prefix", { error: e.message || String(e) }));
    }
    setSavingExemption(false);
  };

  const handleRemoveExemption = async (vm: any) => {
    if (!window.confirm(t("confirm_remove_exemption", { name: vm.name }))) return;
    try {
      if (selectedTenant.id === 'demo_tenant') {
        setVms(prev => prev.map(v => v.id === vm.id ? {
          ...v,
          isExempted: false,
          exemptionReason: null,
          exemptionComment: null
        } : v));
        return;
      }

      const account = accounts[0];
      const token = await getFreshIdToken(instance, account);

      const res = await fetch(`/api/intelligence/rightsizing/exemptions?resourceId=${encodeURIComponent(vm.id)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-tenant-id': selectedTenant.id
        }
      });
      const json = await res.json();
      if (json.success) {
        setVms(prev => prev.map(v => v.id === vm.id ? {
          ...v,
          isExempted: false,
          exemptionReason: null,
          exemptionComment: null
        } : v));
      } else {
        alert(t("error_prefix", { error: json.error }));
      }
    } catch (e: any) {
      alert(t("error_prefix", { error: e.message || String(e) }));
    }
  };

  const handleDowngrade = async (vm: any) => {
      if (!window.confirm(t("confirm_downgrade", { name: vm.name, sku: vm.recommendedSku }))) return;
      try {
          const account = accounts[0];
          const tokenResponse = { idToken: await getFreshIdToken(instance, account) };

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
              alert(t("downgrade_started", { name: vm.name }));
              setVms(prev => prev.filter(v => v.id !== vm.id));
          } else {
              alert(t("error_prefix", { error: json.error }));
          }
      } catch (e) {
          alert(t("downgrade_error", { error: String(e) }));
      }
  };

  const handleDeleteStoppedVm = async (vm: any) => {
      if (!window.confirm(t("confirm_delete_stopped", { name: vm.name }))) return;
      try {
          const account = accounts[0];
          const tokenResponse = { idToken: await getFreshIdToken(instance, account) };

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
              alert(t("delete_started", { name: vm.name }));
              setVms(prev => prev.filter(v => v.id !== vm.id));
          } else {
              alert(t("error_prefix", { error: json.error }));
          }
      } catch (e) {
          alert(t("delete_error", { error: String(e) }));
      }
  };

  if (selectedTenant.id === 'default') return null;

  const totalCount = (vms || []).length;
  const activeCount = (vms || []).filter(v => !v.isExempted).length;
  const exemptedCount = (vms || []).filter(v => v.isExempted).length;

  return (
    <div className="content animate-in fade-in duration-500">
      <div className="vhead">
        <div>
          <div className="vt">
             <span className="vico !bg-transparent !shadow-none"><Ruler className="w-5 h-5" /></span>
             {t("title")}
          </div>
          <div className="vs">{t("subtitle")} <PageHeaderTierBadge tier="Enterprise" /></div>
        </div>
        <div className="right">
          <HistoryButton domain="rightsizing" title={t("title")} />
          <span className="scopechip inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {selectedTenant?.name || "Tenant"}</span>
        </div>
      </div>
      <MockBanner />
      <div className="mb-4">
        <TelemetryDisclaimerBanner compact />
      </div>

      {error && (
        <div className="card mb-4">
            <div className="card-h">
                <h3 className="text-danger inline-flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {t("permissions_error")}</h3>
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
            <div className="card-h flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                <h3 className="inline-flex items-center gap-2"><TrendingDown className="w-4 h-4" /> {t("recommendations_title")}</h3>
                
                {/* Filter Chips */}
                <div className="flex items-center gap-1.5 bg-surface-2 p-1 rounded-xl border border-line text-xs font-semibold">
                    <button
                        onClick={() => setFilter('all')}
                        className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${filter === 'all' ? 'bg-primary text-white shadow-xs font-bold' : 'text-ink-soft hover:text-ink'}`}
                    >
                        {t("filter_all", { count: totalCount })}
                    </button>
                    <button
                        onClick={() => setFilter('active')}
                        className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${filter === 'active' ? 'bg-amber text-white shadow-xs font-bold' : 'text-ink-soft hover:text-ink'}`}
                    >
                        {t("filter_active", { count: activeCount })}
                    </button>
                    <button
                        onClick={() => setFilter('exempted')}
                        className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${filter === 'exempted' ? 'bg-slate-700 dark:bg-slate-600 text-white shadow-xs font-bold' : 'text-ink-soft hover:text-ink'}`}
                    >
                        {t("filter_exempted", { count: exemptedCount })}
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="tbl">
                    <thead>
                        <tr>
                            <th>{t("col_vm_name")}</th>
                            <th>{t("col_subscription")}</th>
                            {viewMode === 'engineer' && <th>{t("col_arm_id")}</th>}
                            <th>{t("col_current_sku")}</th>
                            <th>{t("col_peak_cpu")}</th>
                            <th>{t("col_recommended_sku")}</th>
                            <th className="num">{t("col_action")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pagedVms?.map((vm, idx) => (
                            <tr key={idx} className={vm.isExempted ? "bg-amber-500/5 dark:bg-amber-500/10" : ""}>
                                <td>
                                    <div className="flex items-center gap-[7px] font-bold text-ink">
                                        {vm.isExempted ? (
                                            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                                        ) : (
                                            <AlertTriangle className={`w-4 h-4 ${vm.reason === 'Deallocated VM with attached Storage' ? 'text-rose-500' : 'text-amber'}`} />
                                        )}
                                        {vm.name}
                                    </div>
                                    
                                    {/* Badge & Comment if Exempted */}
                                    {vm.isExempted ? (
                                        <div className="mt-1.5 ml-6 flex flex-col gap-1">
                                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 w-fit">
                                                <Shield className="w-3 h-3" />
                                                {t("badge_exempted")}
                                            </span>
                                            {vm.exemptionReason && (
                                                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 m-0">
                                                    📌 {vm.exemptionReason}
                                                </p>
                                            )}
                                            {vm.exemptionComment && (
                                                <p className="text-[10px] text-slate-500 dark:text-slate-400 italic m-0 bg-surface-2 p-1.5 rounded border border-line/60 max-w-md">
                                                    💬 "{vm.exemptionComment}"
                                                </p>
                                            )}
                                        </div>
                                    ) : vm.reason === 'Deallocated VM with attached Storage' && (
                                        <span className="text-[10px] text-rose-500 font-bold block ml-[23px]">
                                            {t("deallocated_false_savings")}
                                        </span>
                                    )}
                                </td>
                                <td>{vm.subscriptionId ? (subscriptions.find(s => s.id?.toLowerCase() === vm.subscriptionId.toLowerCase())?.name || vm.subscriptionId) : '—'}</td>
                                {viewMode === 'engineer' && (
                                    <td className="font-mono text-xs max-w-xs truncate" title={vm.id}>
                                        {vm.id}
                                    </td>
                                )}
                                <td><span className="tag grey font-mono">{vm.currentSku}</span></td>
                                <td>
                                    {vm.reason === 'Deallocated VM with attached Storage' ? (
                                        <span className="text-xs font-semibold text-gray-400">{t("vm_stopped")}</span>
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
                                            <span className={`tag font-mono ${vm.isExempted ? 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300' : vm.reason === 'Deallocated VM with attached Storage' ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'green'}`}>{vm.recommendedSku}</span>
                                        </div>
                                        {vm.hiddenCost > 0 && !vm.isExempted && (
                                            <span className="text-xs text-rose-500 font-bold ml-6" title={t("hidden_cost_tooltip")}>
                                                {t("hidden_cost_label")} {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(vm.hiddenCost)}{t("per_month")}
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="num">
                                    <div className="flex items-center justify-end gap-1.5">
                                        {vm.isExempted ? (
                                            <>
                                                <button
                                                    onClick={() => handleOpenExemptionModal(vm)}
                                                    className="font-heading font-semibold text-[11px] rounded-lg bg-surface-2 hover:bg-surface-3 text-ink border border-line p-[6px_10px] cursor-pointer active:scale-95 transition-all inline-flex items-center gap-1 shadow-xs"
                                                    title={t("btn_edit_exemption")}
                                                >
                                                    <Edit3 className="w-3.5 h-3.5 text-primary" />
                                                    {t("btn_edit_exemption")}
                                                </button>
                                                <button
                                                    onClick={() => handleRemoveExemption(vm)}
                                                    className="font-heading font-semibold text-[11px] rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 p-[6px_10px] cursor-pointer active:scale-95 transition-all inline-flex items-center gap-1 shadow-xs"
                                                    title={t("btn_remove_exemption")}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                                    {t("btn_remove_exemption")}
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                {vm.reason === 'Deallocated VM with attached Storage' ? (
                                                    <button
                                                        onClick={() => handleDeleteStoppedVm(vm)}
                                                        className="font-heading font-semibold text-[12px] rounded-[10px] bg-rose-600 text-white p-[7px_11px] cursor-pointer hover:bg-rose-700 active:scale-95 transition-all shadow-sm"
                                                    >
                                                        {t("btn_snapshot_delete")}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleDowngrade(vm)}
                                                        className="font-heading font-semibold text-[12px] rounded-[10px] bg-amber text-white p-[7px_11px] cursor-pointer hover:brightness-110 active:scale-95 transition-all shadow-sm"
                                                    >
                                                        {t("btn_downgrade")}
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleOpenExemptionModal(vm)}
                                                    className="font-heading font-semibold text-[11px] rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-line p-[7px_10px] cursor-pointer active:scale-95 transition-all inline-flex items-center gap-1 shadow-xs"
                                                    title={t("btn_exempt")}
                                                >
                                                    <Shield className="w-3.5 h-3.5 text-amber" />
                                                    {t("btn_exempt")}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
        </div>
      )}

      {/* Modal de Justificación de Exención */}
      {exemptionModalVm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-surface border border-line rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setExemptionModalVm(null)}
              className="absolute top-4 right-4 text-ink-soft hover:text-ink p-1 rounded-lg hover:bg-surface-2 cursor-pointer transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-ink">{t("modal_exemption_title")}</h3>
                <p className="text-xs text-ink-soft font-mono">{exemptionModalVm.name}</p>
              </div>
            </div>

            <p className="text-xs text-ink-soft mb-4 leading-relaxed">
              {t("modal_exemption_desc")}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-ink mb-1.5">
                  {t("field_reason")}
                </label>
                <input
                  type="text"
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  placeholder={t("field_reason_placeholder")}
                  className="w-full bg-surface-2 border border-line rounded-xl px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:border-primary transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink mb-1.5 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-primary" />
                  {t("field_comment")}
                </label>
                <textarea
                  rows={4}
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  placeholder={t("field_comment_placeholder")}
                  className="w-full bg-surface-2 border border-line rounded-xl p-3 text-sm text-ink focus:outline-none focus:border-primary transition-all resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-line">
              <button
                type="button"
                onClick={() => setExemptionModalVm(null)}
                className="px-4 py-2 text-xs font-semibold text-ink-soft hover:text-ink bg-surface-2 hover:bg-surface-3 rounded-xl border border-line cursor-pointer transition-all"
              >
                {t("btn_cancel")}
              </button>
              <button
                type="button"
                onClick={handleSaveExemption}
                disabled={savingExemption}
                className="px-5 py-2 text-xs font-bold text-white bg-primary hover:bg-primary-hover rounded-xl shadow-md cursor-pointer transition-all disabled:opacity-50 inline-flex items-center gap-2"
              >
                {savingExemption ? <Zap className="w-4 h-4 animate-bounce" /> : <ShieldCheck className="w-4 h-4" />}
                {t("btn_save_exemption")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
