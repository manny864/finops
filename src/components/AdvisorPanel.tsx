"use client";
import React, { useEffect, useState, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from './TenantProvider';
import { useLocale, useTranslations } from 'next-intl';
import RoleAssignmentBanner from './RoleAssignmentBanner';
import { Info, Lightbulb, X } from 'lucide-react';

export default function AdvisorPanel() {
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const locale = useLocale();
  const t = useTranslations('advisor');
  const tCommon = useTranslations('Common');
  const [data, setData] = useState<any>(null);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSub, setSelectedSub] = useState<string>("all");

  useEffect(() => {
    if (accounts.length === 0 || selectedTenant.id === 'default') {
      setLoading(false);
      return;
    }

    const fetchAdvisor = async () => {
      try {
        setLoading(true);
        const account = accounts[0];
        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: account
        });
        
        const res = await fetch(`/api/advisor?tenantId=${selectedTenant.id}`, {
            headers: { 'Authorization': `Bearer ${tokenResponse.idToken}`, 'Accept-Language': locale }
        });
        
        const json = await res.json();
        if (!res.ok || json.error) {
            setError(json.error === 'MISSING_RBAC_ROLE' ? 'MISSING_RBAC_ROLE' : (json.error || "Error de servidor."));
            setLoading(false);
            return;
        }

        setData(json.recommendations);
        setSubscriptions(json.subscriptions || []);
        setScores(json.scores || {});
        setError(null);
      } catch (err) {
        console.error(err);
        setError("Fallo de red o credenciales.");
      } finally {
        setLoading(false);
      }
    };
    fetchAdvisor();
  }, [accounts, instance, selectedTenant]);

  const filteredData = useMemo(() => {
      if (!data) return {};
      if (selectedSub === "all") return data;
      
      const filtered: Record<string, any[]> = {};
      Object.keys(data).forEach(cat => {
          filtered[cat] = data[cat].filter((r: any) => r.subscriptionId === selectedSub);
      });
      return filtered;
  }, [data, selectedSub]);

  const globalMetrics = useMemo(() => {
      let totalRecs = 0;
      if (filteredData) {
          Object.keys(filteredData).forEach(cat => {
              totalRecs += filteredData[cat].length;
          });
      }
      
      let avgScoreStr = "N/A";
      if (Object.keys(scores).length > 0) {
          if (selectedSub === "all") {
              const vals = Object.values(scores);
              const avg = vals.reduce((a,b) => a+b, 0) / vals.length;
              avgScoreStr = `${avg.toFixed(1)}%`;
          } else if (scores[selectedSub] !== undefined) {
              avgScoreStr = `${scores[selectedSub].toFixed(1)}%`;
          }
      }

      return { totalRecs, avgScoreStr };
  }, [filteredData, scores, selectedSub]);

  const handleCsvExport = async () => {
      try {
          const account = accounts[0];
          const tokenResponse = await instance.acquireTokenSilent({
              scopes: ["User.Read"],
              account: account
          });
          const headers = { 'Authorization': `Bearer ${tokenResponse.idToken}` };
          
          let auditUrl = `/api/audit/full?tenantId=${selectedTenant.id}`;
          if (selectedSub !== "all") auditUrl += `&subscriptionId=${selectedSub}`;

          const auditRes = await fetch(auditUrl, { headers });
          const auditJson = await auditRes.json();
          const auditData = auditJson.auditResults || {};
          
          let rows: any[] = [];
          
          const auditKeys = Object.keys(auditData);
          auditKeys.forEach(k => {
              auditData[k].forEach((item: any) => {
                  rows.push({
                      Origen: "Auditoría FinOps",
                      Categoria: "Zombie Resource",
                      Recurso: item.name || item.id,
                      Suscripcion: item.subscriptionId || "N/A",
                      Detalle: item.type || k,
                      AhorroPotencial: item.diskSizeGB ? item.diskSizeGB * 0.15 : (item.sizeGB ? item.sizeGB * 0.05 : 0)
                  });
              });
          });

          if (filteredData) {
              Object.keys(filteredData).forEach(cat => {
                  filteredData[cat].forEach((rec: any) => {
                      rows.push({
                          Origen: "Azure Advisor",
                          Categoria: cat,
                          Recurso: rec.impactedField || rec.id,
                          Suscripcion: rec.subscriptionId || "N/A",
                          Detalle: rec.shortDescription?.problem || "Recomendación de Azure",
                          AhorroPotencial: rec.extendedProperties?.savingsAmount || 0
                      });
                  });
              });
          }

          if (rows.length === 0) {
              alert("No hay datos para exportar.");
              return;
          }

          const headersCsv = ["Origen", "Categoria", "Recurso", "Suscripcion", "Detalle", "AhorroPotencial"];
          const csvContent = [
              headersCsv.join(","),
              ...rows.map(r => headersCsv.map(h => `"${(r[h] || "").toString().replace(/"/g, '""')}"`).join(","))
          ].join("\n");

          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.setAttribute("href", url);
          link.setAttribute("download", "Reporte_Mejoras_FinOps.csv");
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

      } catch (err) {
          console.error("Error exporting CSV:", err);
          alert("Error al exportar CSV.");
      }
  };

  const categories = [
      { id: "Cost", name: t('cost_label'), note: t('cost_note'), tooltip: t('costTooltip'), color: "text-brand-deep", icon: "💰" },
      { id: "Security", name: t('security_label'), note: t('security_note'), tooltip: t('securityTooltip'), color: "text-danger", icon: "🛡️" },
      { id: "HighAvailability", name: t('reliability_label'), note: t('reliability_note'), tooltip: t('reliabilityTooltip'), color: "text-green", icon: "♻️" },
      { id: "Performance", name: t('performance_label'), note: t('performance_note'), tooltip: t('performanceTooltip'), color: "text-amber", icon: "⚡" },
      { id: "OperationalExcellence", name: t('operational_label'), note: t('operational_note'), tooltip: t('operationalExcellenceTooltip'), color: "text-purple", icon: "⚙️" }
  ];

  if (accounts.length === 0 || selectedTenant.id === 'default') {
      return <div className="p-8 text-center text-ink-soft">{tCommon('loading')}</div>;
  }

  return (
    <div className="animate-in fade-in flex flex-col gap-5">
        <div className="flex items-end gap-[14px] flex-wrap">
            <div>
                <div className="text-[23px] font-extrabold text-ink tracking-tight flex items-center gap-[11px]">
                    <span className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-gradient-to-br from-brand-deep to-brand-bright text-white shadow-sm">
                        <Lightbulb className="w-5 h-5" />
                    </span>
                    {t('title')}
                </div>
                <div className="text-[13px] text-ink-soft mt-[3px]">{t('subtitle')}</div>
            </div>
            
            <div className="ml-auto flex gap-[9px] items-center flex-wrap">
                <span className="text-[11px] font-bold tracking-[0.4px] bg-[#E6F2FB] text-brand-deep px-[11px] py-[5px] rounded-lg">
                    📍 {selectedTenant.name}
                </span>
                <div className="flex items-center gap-[9px] bg-surface border border-line-strong rounded-[10px] p-[6px_9px_6px_12px] shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)]">
                    <label className="text-[10px] tracking-[1px] uppercase text-grey font-bold">Alcance</label>
                    <select
                        value={selectedSub}
                        onChange={(e) => { setSelectedSub(e.target.value); setSelectedCategory(null); }}
                        className="border-0 bg-transparent font-heading font-bold text-[13px] text-brand-deep cursor-pointer focus:outline-none p-0 m-0 w-32 md:w-auto truncate"
                    >
                        <option value="all">{t('all_subs')}</option>
                        {subscriptions.map(s => (
                            <option key={s.id} value={s.id}>{s.name || s.id}</option>
                        ))}
                    </select>
                </div>

                <button onClick={handleCsvExport} className="font-heading font-semibold text-[13px] rounded-[10px] border border-line-strong p-[7px_14px] cursor-pointer transition-colors inline-flex items-center gap-[7px] whitespace-nowrap bg-surface text-ink-soft hover:border-brand-bright hover:text-brand-deep active:scale-95">
                    ⬇️ {t('export_csv')}
                </button>
            </div>
        </div>

        {error === 'MISSING_RBAC_ROLE' ? <RoleAssignmentBanner /> : error ? <div className="text-danger p-4 bg-danger-soft rounded-lg">{error}</div> : loading ? <div className="animate-pulse p-8 text-center">{tCommon('loading')}</div> : (
            <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-[14px]">
                {categories.map(cat => {
                    const items = filteredData?.[cat.id] || [];
                    const count = items.length;
                    let displayVal: string | number = count;
                    if (cat.id === "Cost") {
                        const savings = items.reduce((acc: number, r: any) => acc + parseFloat(r.extendedProperties?.savingsAmount || '0'), 0);
                        if (savings > 0) {
                            displayVal = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(savings);
                        }
                    }

                    return (
                        <div key={cat.id} 
                             onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                             className={`bg-surface border ${selectedCategory === cat.id ? 'border-brand-bright' : 'border-line'} rounded-[14px] p-[15px_16px] shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)] relative group cursor-pointer transition-all hover:-translate-y-0.5`}
                        >
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-bright rounded-l-[14px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                            {selectedCategory === cat.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-bright rounded-l-[14px] opacity-100"></div>}
                            
                            <div className="text-[10px] tracking-[0.6px] uppercase text-grey font-bold flex items-center justify-between">
                                <span>{cat.icon} {cat.name}</span>
                                <div className="relative group/tooltip ml-2 flex items-center z-10">
                                    <Info className="w-3 h-3 text-grey cursor-help" />
                                    <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-gray-800 text-xs text-white rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-20 font-normal normal-case tracking-normal">
                                        {cat.tooltip}
                                        <div className="absolute top-full right-2 border-4 border-transparent border-t-gray-800"></div>
                                    </div>
                                </div>
                            </div>
                            <div className={`font-heading font-extrabold text-[21px] mt-[9px] tracking-tight ${cat.color}`}>
                                {displayVal}
                            </div>
                            <div className="text-[11px] font-semibold mt-[5px] text-ink-soft">
                                {displayVal !== count && cat.id === "Cost" ? t('cost_note') : `${count} ${cat.note}`}
                            </div>
                        </div>
                    );
                })}
            </div>
            
            {!selectedCategory && (
                <div className="mt-6 flex flex-col gap-6 animate-in fade-in">
                    <div className="bg-surface border border-line rounded-[14px] shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)] overflow-hidden">
                        <div className="flex items-center justify-between p-[15px_18px] border-b border-line bg-surface">
                            <h3 className="text-[14px] font-bold text-ink flex items-center gap-[9px]">
                                💰 {t('table_cost_title')}
                            </h3>
                        </div>
                        <div className="flex flex-col">
                            {(() => {
                                const topCostRecs = (filteredData["Cost"] || [])
                                    .sort((a: any, b: any) => parseFloat(b.extendedProperties?.savingsAmount || '0') - parseFloat(a.extendedProperties?.savingsAmount || '0'))
                                    .slice(0, 4);
                                
                                if (topCostRecs.length === 0) return <div className="p-[34px] text-center text-grey text-[13px]">{t('no_recs')} 🎉</div>;
                                
                                return topCostRecs.map((rec: any, idx: number) => {
                                    const sol = (rec.shortDescription?.solution || '').toLowerCase();
                                    const isRes = sol.includes('reserved') || sol.includes('savings');
                                    const isPower = sol.includes('power') || sol.includes('apagado');
                                    const iconInfo = isRes ? { i: '🏷️', c: 'bg-amber-soft text-amber' } : isPower ? { i: '🌙', c: 'bg-amber-soft text-amber' } : { i: '📐', c: 'bg-[#E6F2FB] text-brand-deep' };

                                    return (
                                        <div key={idx} className="grid grid-cols-[40px_1fr_auto] gap-[14px] items-center p-[14px_18px] border-b border-line hover:bg-surface-2 transition-colors last:border-b-0">
                                            <div className={`w-[40px] h-[40px] rounded-[10px] grid place-items-center text-[18px] ${iconInfo.c}`}>
                                                {iconInfo.i}
                                            </div>
                                            <div>
                                                <div className="font-bold text-[13.5px] text-ink">
                                                    {rec.shortDescription?.problem || 'Recomendación de Costo'}
                                                    <span className="font-semibold text-brand-deep bg-[#EAF3FB] p-[1px_7px] rounded-[6px] text-[12px] ml-[6px]">
                                                        {rec.impactedField || 'Recurso'}
                                                    </span>
                                                </div>
                                                <div className="text-[12px] text-ink-soft mt-[3px] leading-relaxed">
                                                    {rec.shortDescription?.solution} · <b className="text-ink">{subscriptions.find(s => s.id === rec.subscriptionId)?.name || rec.subscriptionId}</b>
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col items-end gap-[7px]">
                                                <div className="font-heading font-extrabold text-[15px] text-green">
                                                    {new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(parseFloat(rec.extendedProperties?.savingsAmount || '0'))}
                                                    <span className="text-[10.5px] text-grey font-semibold"> /mes</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>

                    <div className="bg-surface border border-line rounded-[14px] shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)] overflow-hidden">
                        <div className="flex items-center justify-between p-[15px_18px] border-b border-line bg-surface">
                            <h3 className="text-[14px] font-bold text-ink flex items-center gap-[9px]">
                                🛡️ {t('table_other_title')}
                            </h3>
                            <span className="text-[11.5px] text-grey">informativo</span>
                        </div>
                        <div className="flex flex-col">
                            {(() => {
                                const otherRecs = [];
                                if (filteredData["Security"]?.[0]) otherRecs.push({ ...filteredData["Security"][0], _cat: t('security_label'), _icon: '🛡️', _bg: 'bg-danger-soft', _color: 'text-danger' });
                                if (filteredData["HighAvailability"]?.[0]) otherRecs.push({ ...filteredData["HighAvailability"][0], _cat: t('reliability_label'), _icon: '♻️', _bg: 'bg-green-soft', _color: 'text-green' });
                                if (filteredData["Performance"]?.[0]) otherRecs.push({ ...filteredData["Performance"][0], _cat: t('performance_label'), _icon: '⚡', _bg: 'bg-amber-soft', _color: 'text-amber' });

                                if (otherRecs.length === 0) return <div className="p-[34px] text-center text-grey text-[13px]">{t('no_recs')} 🎉</div>;

                                return otherRecs.map((rec: any, idx: number) => (
                                    <div key={idx} className="grid grid-cols-[40px_1fr_auto] gap-[14px] items-center p-[14px_18px] border-b border-line hover:bg-surface-2 transition-colors last:border-b-0">
                                        <div className={`w-[40px] h-[40px] rounded-[10px] grid place-items-center text-[18px] ${rec._bg} ${rec._color}`}>
                                            {rec._icon}
                                        </div>
                                        <div>
                                            <div className="font-bold text-[13.5px] text-ink">
                                                {rec._cat}
                                            </div>
                                            <div className="text-[12px] text-ink-soft mt-[3px] leading-relaxed">
                                                {rec.shortDescription?.problem || rec.shortDescription?.solution} · <b className="text-ink">{subscriptions.find(s => s.id === rec.subscriptionId)?.name || rec.subscriptionId}</b>
                                            </div>
                                        </div>
                                        <div className="text-right flex flex-col items-end gap-[7px]">
                                            <span className="text-[10px] font-bold tracking-[0.5px] uppercase py-[3px] px-[8px] rounded-[6px] bg-[#EEF1F5] text-grey">
                                                REVISAR
                                            </span>
                                        </div>
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {selectedCategory && (
                <div className="bg-surface border border-line rounded-[14px] shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)] animate-in fade-in slide-in-from-bottom-4 mt-2 overflow-hidden">
                    <div className="flex items-center justify-between p-[15px_18px] border-b border-line bg-surface">
                        <h3 className="text-[14px] font-bold text-ink flex items-center gap-[9px]">
                            {categories.find(c => c.id === selectedCategory)?.icon} {t('recs_of', { category: categories.find(c => c.id === selectedCategory)?.name || '' })}
                        </h3>
                        <button onClick={() => setSelectedCategory(null)} className="text-grey hover:text-ink transition-colors bg-surface-2 p-1.5 rounded-md border border-line">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    
                    {filteredData[selectedCategory]?.length === 0 ? (
                        <div className="p-[34px] text-center text-grey text-[13px]">
                            {t('no_recs')} 🎉
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                                <thead className="bg-surface-2">
                                    <tr>
                                        <th className="text-left text-[10.5px] tracking-[0.5px] uppercase text-grey font-bold p-[11px_16px] border-b border-line">{t('col_resource')}</th>
                                        <th className="text-left text-[10.5px] tracking-[0.5px] uppercase text-grey font-bold p-[11px_16px] border-b border-line">{t('col_sub')}</th>
                                        <th className="text-left text-[10.5px] tracking-[0.5px] uppercase text-grey font-bold p-[11px_16px] border-b border-line">{t('col_problem')}</th>
                                        <th className="text-left text-[10.5px] tracking-[0.5px] uppercase text-grey font-bold p-[11px_16px] border-b border-line">{t('col_solution')}</th>
                                        <th className="p-[11px_16px] border-b border-line"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredData[selectedCategory]?.map((rec: any, idx: number) => (
                                        <tr key={idx} className="hover:bg-surface-2 transition-colors border-b border-line last:border-0 group">
                                            <td className="p-[13px_16px] text-[13px] text-ink font-bold">
                                                {rec.impactedField || 'Desconocido'}
                                                {parseFloat(rec.extendedProperties?.savingsAmount || '0') > 0 && selectedCategory === 'Cost' && (
                                                    <span className="font-semibold text-brand-deep bg-[#EAF3FB] p-[1px_7px] rounded-[6px] text-[12px] ml-[6px]">
                                                        {new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(parseFloat(rec.extendedProperties.savingsAmount))} /mes
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-[13px_16px] text-[13px] text-ink truncate max-w-[150px]">
                                                {subscriptions.find(s => s.id === rec.subscriptionId)?.name || rec.subscriptionId}
                                            </td>
                                            <td className="p-[13px_16px] text-[13px] text-ink-soft">
                                                {rec.shortDescription?.problem || 'N/A'}
                                            </td>
                                            <td className="p-[13px_16px] text-[13px] text-ink-soft">
                                                {rec.shortDescription?.solution || rec.recommendationType?.name || rec.impact || 'Consulte el Portal'}
                                            </td>
                                            <td className="p-[13px_16px] text-right">
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
            </>
        )}
    </div>
  );
}
