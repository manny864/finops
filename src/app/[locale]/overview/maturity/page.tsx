"use client";
import MockBanner from '@/components/MockBanner';
import PageHeaderTierBadge from '@/components/dashboard/PageHeaderTierBadge';
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Target, TrendingUp, AlertTriangle, CheckCircle2, Loader2, Info, Eye, DollarSign, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isMockTenant, getMockDataForRoute } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';


export default function MaturityPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations("OverviewMaturity");
    const [loading, setLoading] = useState(false);
    const [scoreData, setScoreData] = useState<any>(null);
    const [reason, setReason] = useState<string | null>(null);
    const [showWizard, setShowWizard] = useState(false);
    const [wizardStep, setWizardStep] = useState(0);
    const [answers, setAnswers] = useState<any[]>([]);

    const questions = [
        { id: 'q1', domain: 'VisibilityAndAllocation' },
        { id: 'q2', domain: 'UsageOptimization' },
        { id: 'q3', domain: 'RateOptimization' },
        { id: 'q4', domain: 'ForecastingAndBudgeting' },
        { id: 'q5', domain: 'GovernanceAndAutomation' }
    ];

    const handleAnswer = (score: number) => {
        const newAnswers = [...answers, { questionId: questions[wizardStep].id, score }];
        setAnswers(newAnswers);
        
        if (wizardStep < questions.length - 1) {
            setWizardStep(wizardStep + 1);
        } else {
            submitAssessment(newAnswers);
        }
    };

    const submitAssessment = async (finalAnswers: any[]) => {
        setLoading(true);
        setShowWizard(false);
        try {
            const res = await fetch('/api/intelligence/maturity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId: selectedTenant.id, assessmentData: finalAnswers })
            });
            const data = await res.json();
            if (data.success) {
                // Mock mapping the answer to the existing domain structure for the radar chart
                setScoreData({
                    overallScore: data.score,
                    pillars: {
                        VisibilityAndAllocation: finalAnswers[0]?.score * 10 || 0,
                        UsageOptimization: finalAnswers[1]?.score * 10 || 0,
                        RateOptimization: finalAnswers[2]?.score * 10 || 0,
                        ForecastingAndBudgeting: finalAnswers[3]?.score * 10 || 0,
                        GovernanceAndAutomation: finalAnswers[4]?.score * 10 || 0
                    }
                });
            }
        } catch (e) {
            console.error("Error saving assessment", e);
        }
        setLoading(false);
    };

    useEffect(() => {
        if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') return;

        const fetchMaturity = async () => {
            setLoading(true);
            setScoreData(null);
            setReason(null);

            // Tenants DEMO: se construye la respuesta desde el dataset mock
            // mapeando al shape que espera el radar (pillars + overallScore).
            if (isMockTenant(selectedTenant.id)) {
                const tier = ((selectedTenant as any).tier || 'essential').toString().toLowerCase();
                const mock = getMockDataForRoute('maturity', tier);
                if (mock?.success) {
                    setScoreData({
                        overallScore: mock.score,
                        pillars: {
                            VisibilityAndAllocation: mock.breakdown?.visibility ?? mock.score,
                            UsageOptimization: mock.breakdown?.optimization ?? mock.score,
                            RateOptimization: mock.breakdown?.optimization ?? mock.score,
                            ForecastingAndBudgeting: mock.breakdown?.automation ?? mock.score,
                            GovernanceAndAutomation: mock.breakdown?.governance ?? mock.score,
                        }
                    });
                }
                setLoading(false);
                return;
            }

            try {
                const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
                const res = await fetch(`/api/intelligence/maturity?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.data) {
                    setScoreData(json.data);
                } else if (json.reason) {
                    setReason(json.reason);
                }
            } catch (e) {
                console.error(e);
            }
            setLoading(false);
        };
        fetchMaturity();
    }, [selectedTenant.id, accounts, instance]);

  const getLevel = (score: number) => {
      if (score < 40) return 1;
      if (score <= 75) return 2;
      return 3;
  };

  const getLevelName = (lvl: number) => {
      if (lvl === 1) return t('levels.crawl');
      if (lvl === 2) return t('levels.walk');
      return t('levels.run');
  };

  const getLevelColor = (lvl: number) => {
      if (lvl === 1) return 'text-amber';
      if (lvl === 2) return 'text-brand-bright';
      return 'text-green';
  };

  if (selectedTenant.id === 'default') {
      return (
          <div className="flex flex-col items-center justify-center h-96 bg-surface rounded-[14px] border border-line shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)]">
              <span className="text-4xl mb-4">🔐</span>
              <h2 className="text-xl font-bold text-ink">{t('selectTenantTitle')}</h2>
              <p className="text-sm text-ink-soft mt-2">{t('selectTenantDesc')}</p>
          </div>
      );
  }

  // Handle no-data states
  if (!loading && !scoreData && reason && !showWizard) {
      const messages: Record<string, { icon: string; title: string; desc: string }> = {
          NO_SUBSCRIPTIONS: { icon: "📭", title: t('reasons.noSubscriptions.title'), desc: t('reasons.noSubscriptions.desc') },
          MISSING_ADMIN_CONSENT: { icon: "⚠️", title: t('reasons.missingAdminConsent.title'), desc: t('reasons.missingAdminConsent.desc') },
          NO_CREDENTIAL: { icon: "🔑", title: t('reasons.noCredential.title'), desc: t('reasons.noCredential.desc') },
          AZURE_ERROR: { icon: "☁️", title: t('reasons.azureError.title'), desc: t('reasons.azureError.desc') },
      };
      const msg = messages[reason] || messages.AZURE_ERROR;
      return (
          <div className="p-6 max-w-[1320px] mx-auto animate-in fade-in flex flex-col gap-5">
              <div className="flex items-end gap-[14px] flex-wrap">
                  <div>
                      <div className="text-[23px] font-extrabold text-ink tracking-tight flex items-center gap-[11px]">
                          <span className="flex items-center justify-center text-brand-deep">
                              <Target className="w-6 h-6" />
                          </span>
                          {t('pageTitle')}
                      </div>
                      <div className="text-[13px] text-ink-soft mt-[3px]">{t('pageSubtitle')}</div>
                  </div>
              </div>
              <div className="flex flex-col items-center justify-center h-96 bg-surface rounded-[14px] border border-line shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)]">
                  <span className="text-5xl mb-4">{msg.icon}</span>
                  <h2 className="text-xl font-bold text-ink mb-2">{msg.title}</h2>
                  <p className="text-sm text-ink-soft text-center max-w-md mb-6">{msg.desc}</p>
                  <button onClick={() => setShowWizard(true)} className="px-6 py-2 bg-brand-deep text-white rounded-lg font-bold hover:bg-brand-bright transition-colors shadow-sm">
                      {t('takeAssessment')}
                  </button>
              </div>
          </div>
      );
  }

  if (showWizard) {
      return (
          <div className="p-6 max-w-[1320px] mx-auto animate-in fade-in flex flex-col items-center justify-center min-h-[60vh]">
              <div className="bg-surface border border-line rounded-[14px] p-8 w-full max-w-2xl shadow-xl">
                  <div className="mb-8">
                      <div className="flex justify-between items-center mb-2">
                          <h2 className="text-xl font-bold text-ink">{t('wizardTitle')}</h2>
                          <span className="text-sm font-bold text-brand-deep">{t('wizardStep', { current: wizardStep + 1, total: questions.length })}</span>
                      </div>
                      <div className="w-full bg-surface-2 rounded-full h-2">
                          <div className="bg-gradient-to-r from-brand-deep to-brand-bright h-2 rounded-full transition-all duration-300" style={{ width: `${((wizardStep) / questions.length) * 100}%` }}></div>
                      </div>
                  </div>
                  <h3 className="text-2xl font-semibold text-ink text-center mb-10">{t(`questions.${questions[wizardStep].id}` as any)}</h3>
                  <div className="flex flex-col gap-4">
                      <button onClick={() => handleAnswer(10)} className="w-full py-3 px-4 bg-[#EAF3FB] hover:bg-[#D5E8F8] text-brand-deep border border-[#B3D4F0] rounded-lg font-bold transition-colors">{t('answers.full')}</button>
                      <button onClick={() => handleAnswer(5)} className="w-full py-3 px-4 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg font-bold transition-colors">{t('answers.partial')}</button>
                      <button onClick={() => handleAnswer(0)} className="w-full py-3 px-4 bg-red-50 hover:bg-red-100 text-red-800 border border-red-200 rounded-lg font-bold transition-colors">{t('answers.none')}</button>
                  </div>
              </div>
          </div>
      );
  }

  // Map backend scores to the 6 domains for the radar
  const domainData = [
      { key: "Visibility", name: t('domains.visibility'), score: scoreData?.pillars?.VisibilityAndAllocation || 0 },
      { key: "RateOpt", name: t('domains.rateOpt'), score: scoreData?.pillars?.RateOptimization || 0 },
      { key: "UsageOpt", name: t('domains.usageOpt'), score: scoreData?.pillars?.UsageOptimization || 0 },
      { key: "Gov", name: t('domains.governance'), score: scoreData?.pillars?.GovernanceAndAutomation || 0 },
      { key: "Auto", name: t('domains.automation'), score: scoreData?.pillars?.ForecastingAndBudgeting || 0 }, // fallback proxy
      { key: "Culture", name: t('domains.culture'), score: scoreData?.overallScore || 0 } // fallback proxy
  ].map(d => ({ ...d, lvl: getLevel(d.score) }));

  const avg = domainData.reduce((a, d) => a + d.lvl, 0) / domainData.length;
  const overallLevelKey = avg < 1.7 ? 'crawl' : avg < 2.4 ? 'walk' : 'run';
  const overall = t(`levels.${overallLevelKey}` as any);
  const overallPillColor = overallLevelKey === 'run' ? 'bg-green-soft text-green' : overallLevelKey === 'walk' ? 'bg-[#E6F2FB] text-brand-deep' : 'bg-amber-soft text-amber';

  // Radar SVG Math
  const N = domainData.length;
  const cx = 110, cy = 110, Rmax = 82;
  const pt = (i: number, r: number) => {
      const ang = -Math.PI / 2 + i * 2 * Math.PI / N;
      return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
  };

  const rings = [1, 2, 3].map(lv => {
      const poly = domainData.map((_, i) => pt(i, Rmax * lv / 3).map(n => n.toFixed(1)).join(',')).join(' ');
      return <polygon key={lv} points={poly} fill="none" stroke="#E3EBF3" />;
  });

  const axes = domainData.map((_, i) => {
      const [x, y] = pt(i, Rmax);
      return <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="#E3EBF3" />;
  });

  const cur = domainData.map((d, i) => pt(i, Rmax * d.lvl / 3).map(n => n.toFixed(1)).join(',')).join(' ');

  const labels = domainData.map((d, i) => {
      const [x, y] = pt(i, Rmax + 16);
      return <text key={i} x={x.toFixed(1)} y={y.toFixed(1)} textAnchor="middle" fontSize="8.5" fill="#5A6B82" className="font-sans">{d.name.split(' ')[0]}</text>;
  });

  // Actionable recommendations based on lowest levels
  const lowestDomains = [...domainData].sort((a, b) => a.lvl - b.lvl).slice(0, 2);
  const crawlToWalk = `${t('levels.crawl')} → ${t('levels.walk')}`;
  const walkToRun = `${t('levels.walk')} → ${t('levels.run')}`;
  const recsMock = {
      "Auto": { title: t('recommendations.automation.title'), action: crawlToWalk, desc: t('recommendations.automation.desc'), icon: "🤖", bg: "bg-amber-soft text-amber" },
      "Gov": { title: t('recommendations.governance.title'), action: walkToRun, desc: t('recommendations.governance.desc'), icon: "🏷️", bg: "bg-[#E6F2FB] text-brand-deep" },
      "Visibility": { title: t('recommendations.visibility.title'), action: crawlToWalk, desc: t('recommendations.visibility.desc'), icon: "👁️", bg: "bg-amber-soft text-amber" },
      "RateOpt": { title: t('recommendations.rateOptimization.title'), action: crawlToWalk, desc: t('recommendations.rateOptimization.desc'), icon: "💸", bg: "bg-[#E6F2FB] text-brand-deep" },
      "UsageOpt": { title: t('recommendations.usageOptimization.title'), action: walkToRun, desc: t('recommendations.usageOptimization.desc'), icon: "📉", bg: "bg-amber-soft text-amber" },
      "Culture": { title: t('recommendations.culture.title'), action: crawlToWalk, desc: t('recommendations.culture.desc'), icon: "👥", bg: "bg-green-soft text-green" },
  };

  return (
      <div className="p-6 max-w-[1320px] mx-auto animate-in fade-in flex flex-col gap-5">
          <MockBanner />
          <div className="flex items-end gap-[14px] flex-wrap relative">
              {(loading || !scoreData) && (
                  <div className="absolute inset-0 bg-surface/60 z-50 flex flex-col items-center justify-center rounded-[14px] backdrop-blur-sm">
                      <Loader2 className="w-10 h-10 text-brand-deep animate-spin mb-4" />
                      <span className="text-[14px] font-bold text-ink">{t('processingTelemetry')}</span>
                  </div>
              )}
              
              <div>
                  <div className="text-[23px] font-extrabold text-ink tracking-tight flex items-center gap-[11px]">
                      <span className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-gradient-to-br from-brand-deep to-brand-bright text-white shadow-sm">
                          <Target className="w-5 h-5" />
                      </span>
                      {t('pageTitle')}
                  </div>
                  <div className="text-[13px] text-ink-soft mt-[3px]">{t('pageSubtitle')} <PageHeaderTierBadge tier="Essential" /></div>
              </div>
              <div className="ml-auto flex gap-[9px] items-center">
                  <button onClick={() => setShowWizard(true)} className="text-[12px] font-bold tracking-[0.4px] bg-white border border-brand text-brand hover:bg-brand-soft px-[12px] py-[6px] rounded-lg transition-colors mr-2">
                      {t('retakeAssessment')}
                  </button>
                  <span className="text-[11px] font-bold tracking-[0.4px] bg-[#E6F2FB] text-brand-deep px-[11px] py-[5px] rounded-lg">
                      📍 {selectedTenant.name}
                  </span>
                  <span className={`text-[10px] font-bold tracking-[0.5px] uppercase px-[8px] py-[3px] rounded-[6px] ${overallPillColor}`}>
                      {t('levelGlobal', { level: overall })}
                  </span>
              </div>
          </div>

          <div className={`flex flex-col gap-5 ${(loading || !scoreData) ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-[20px]">
                  {/* Radar Card */}
                  <div className="bg-surface border border-line rounded-[14px] shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)]">
                      <div className="flex items-center justify-between p-[15px_18px] border-b border-line">
                          <h3 className="text-[14px] font-bold text-ink flex items-center gap-[9px]">
                              🎯 {t('radarTitle')}
                          </h3>
                      </div>
                      <div className="p-[16px_18px] grid place-items-center">
                          <svg viewBox="0 0 220 220" width="260" height="260">
                              <defs>
                                  <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
                                      <stop offset="0" stopColor="#0054A6" stopOpacity=".5" />
                                      <stop offset="1" stopColor="#00AEEF" stopOpacity=".5" />
                                  </linearGradient>
                              </defs>
                              {rings}
                              {axes}
                              <polygon points={cur} fill="url(#rg)" stroke="#0054A6" strokeWidth="2" className="transition-all duration-1000" />
                              {labels}
                          </svg>
                      </div>
                  </div>

                  {/* Level per capability Card */}
                  <div className="bg-surface border border-line rounded-[14px] shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)]">
                      <div className="flex items-center justify-between p-[15px_18px] border-b border-line">
                          <h3 className="text-[14px] font-bold text-ink flex items-center gap-[9px]">
                              📋 {t('levelPerCapability')}
                          </h3>
                      </div>
                      <div className="flex flex-col gap-[14px] p-[18px]">
                          {domainData.map(d => (
                              <div key={d.key} className="grid grid-cols-[160px_1fr_80px] items-center gap-[14px]">
                                  <span className="font-bold text-[13px] text-ink truncate">{d.name}</span>
                                  <div className="flex gap-[6px]">
                                      {[1, 2, 3].map(s => (
                                          <div key={s} className={`flex-1 h-[9px] rounded-full border ${s <= d.lvl ? 'bg-gradient-to-r from-brand-deep to-brand-bright border-transparent' : 'bg-surface-2 border-line'}`}></div>
                                      ))}
                                  </div>
                                  <span className={`text-[11.5px] font-bold text-right ${getLevelColor(d.lvl)}`}>
                                      {getLevelName(d.lvl)}
                                  </span>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>

              {/* Actionables */}
              <div className="bg-surface border border-line rounded-[14px] shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)]">
                  <div className="flex items-center justify-between p-[15px_18px] border-b border-line">
                      <h3 className="text-[14px] font-bold text-ink flex items-center gap-[9px]">
                          🚀 {t('levelUpTitle')}
                      </h3>
                  </div>
                  <div className="flex flex-col">
                      {lowestDomains.map((domain, idx) => {
                          const r = recsMock[domain.key as keyof typeof recsMock];
                          if (!r) return null;
                          return (
                              <div key={idx} className="grid grid-cols-[40px_1fr_auto] gap-[14px] items-center p-[14px_18px] border-b border-line hover:bg-surface-2 transition-colors last:border-0">
                                  <div className={`w-[40px] h-[40px] rounded-[10px] grid place-items-center text-[18px] ${r.bg}`}>
                                      {r.icon}
                                  </div>
                                  <div>
                                      <div className="font-bold text-[13.5px] text-ink">
                                          {r.title} <span className="font-semibold text-brand-deep bg-[#EAF3FB] p-[1px_7px] rounded-[6px] text-[12px] ml-[6px]">{r.action}</span>
                                      </div>
                                      <div className="text-[12px] text-ink-soft mt-[3px] leading-[1.5]">
                                          {r.desc}
                                      </div>
                                  </div>
                              </div>
                          );
                      })}
                  </div>
              </div>
          </div>
      </div>
  );
}
