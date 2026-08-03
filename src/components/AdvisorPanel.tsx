"use client";
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from './TenantProvider';
import { useSubscription } from './SubscriptionProvider';
import { useLocale, useTranslations } from 'next-intl';
import RoleAssignmentBanner from './RoleAssignmentBanner';
import {
  Lightbulb, X, DollarSign, ShieldCheck, Globe, Medal, BarChart3,
  Layers, ChevronLeft, ChevronRight, Leaf, Download, Maximize2, Minimize2,
  MapPin, Trophy,
} from 'lucide-react';
import { translateAdvisorText } from '@/lib/advisorI18n';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import {
  ADVISOR_CATEGORIES, impactBadgeClasses, normalizeImpact, parseAzureNumber,
  type AdvisorCategory, type AdvisorModel, type AdvisorRecommendation,
  type AdvisorLifecycleRow, type AdvisorCarbonRow, type AdvisorDynamicRow,
} from '@/lib/advisorModel';

const PAGE_SIZE = 8;

function fallbackRecommendationLabel(locale: string): string {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith('pt')) return 'Recomendação';
  if (normalized.startsWith('en')) return 'Recommendation';
  return 'Recomendación';
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización DINÁMICA de datos reales de Azure: se agrupan por
// recommendationTypeId y las columnas del modal se derivan de los
// extendedProperties que Azure realmente devolvió (varían por tipo). El estado
// (Active/Postponed/Dismissed) viene de la Suppressions API (_state).
// ─────────────────────────────────────────────────────────────────────────────

// Claves de extendedProperties que se muestran como columna "Ahorro" (no como
// columna propia) o que son ruido y se ocultan.
const SAVINGS_KEYS = new Set(['savingsamount', 'annualsavingsamount', 'costsavings']);
const HIDE_EXT_KEYS = new Set(['recommendationcontrol', 'mapregionsavings', 'etag', 'subid']);

const humanizeKey = (k: string): string =>
  k.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
   .replace(/[_-]+/g, ' ')
   .replace(/\b\w/g, c => c.toUpperCase())
   .trim();

const isCarbonKey = (k: string) => /carbon|emission|co2/i.test(k);

// Extrae la reducción de carbono ANUAL desde extendedProperties. Azure trae
// campos como "PotentialMonthlyCarbonSavings" / "...CarbonEmissions" — SIN
// variante anual (a diferencia de savingsAmount/annualSavingsAmount). El
// nombre del campo dice "Monthly" explícitamente: usarlo tal cual como si
// fuera anual subestimaba ~12x la reducción real (0.32kg en vez de ~3.8kg).
// Se prioriza "savings" sobre "emissions" (reducción neta, no emisión bruta),
// y se multiplica x12 cuando el campo es mensual.
function extractAnnualCarbon(ext: Record<string, any>): number {
  let best: { value: number; isSavings: boolean } | null = null;
  for (const [ek, ev] of Object.entries(ext)) {
    if (!isCarbonKey(ek)) continue;
    const raw = parseFloat(String(ev));
    if (!Number.isFinite(raw)) continue;
    const isSavings = /saving/i.test(ek);
    const isMonthly = /month/i.test(ek);
    const annual = isMonthly ? raw * 12 : raw;
    if (!best || (isSavings && !best.isSavings)) {
      best = { value: annual, isSavings };
    }
  }
  return best?.value || 0;
}

function normalizeGroup(
  raw: any[],
  category: AdvisorCategory,
  locale: string,
  subMap: Record<string, string>
): AdvisorRecommendation[] {
  if (!raw || raw.length === 0) return [];
  // Mock / ya normalizado.
  if (raw[0] && typeof raw[0].recommendation === 'string' && raw[0].impact) {
    return raw as AdvisorRecommendation[];
  }

  // Real Azure: agrupar por recommendationTypeId (la clave real del portal).
  type Bucket = { rec: AdvisorRecommendation; extKeys: Set<string>; savingsSum: number; carbonSum: number };
  const groups = new Map<string, Bucket>();

  for (const r of raw) {
    const ext: Record<string, any> = r.extendedProperties || {};
    // Las recomendaciones de reserva/savings-plan generan una recomendación
    // distinta POR CADA combinación de término y período de retrospectiva
    // (p.ej. 1año/7d, 3años/30d…). Azure Portal muestra un filtro
    // "Commitments" y solo cuenta la combinación seleccionada — si sumamos
    // todas las combinaciones bajo el mismo recommendationTypeId, "recursos
    // activos" se infla (31 en vez de los 3-5 que Azure muestra para una
    // combinación). Por eso el término/lookback forma parte de la clave de
    // agrupación: cada combinación es su propia fila, igual que al cambiar el
    // filtro de Commitments en el portal.
    const commitment = ext.term && ext.lookbackPeriod ? `${ext.term}/${ext.lookbackPeriod}` : '';
    const key = (r.recommendationTypeId || r.shortDescription?.problem || r.id || 'unknown') + (commitment ? `::${commitment}` : '');
    const problem = translateAdvisorText(r.shortDescription?.problem, locale, 'problem') || fallbackRecommendationLabel(locale);
    const solution = translateAdvisorText(r.shortDescription?.solution, locale, 'solution') || '';
    const subId = r.subscriptionId || 'N/A';
    const subName = subMap[subId] || subId;

    // Ahorro y carbono desde extendedProperties (dinámico).
    let savings = 0;
    for (const [ek, ev] of Object.entries(ext)) {
      const lk = ek.toLowerCase();
      if (lk === 'annualsavingsamount' || lk === 'savingsamount' || lk === 'costsavings') {
        savings = parseAzureNumber(ev) || savings;
      }
    }
    const carbon = extractAnnualCarbon(ext);

    // "P3Y" -> "3 años", "P1Y" -> "1 año"; lookback en días.
    const commitmentLabel = commitment
      ? ` (${(ext.term || '').replace(/^P(\d+)Y$/, '$1a')}/${ext.lookbackPeriod}d)`
      : '';

    if (!groups.has(key)) {
      groups.set(key, {
        rec: {
          id: String(key),
          category,
          subscriptionId: subId,
          recommendation: problem + commitmentLabel,
          impact: normalizeImpact(r.impact),
          activeResources: 0,
          completionProgress: 0,
          potentialSavings: 0,
          recommendedAction: solution,
          lastRefreshed: r.lastUpdated ? String(r.lastUpdated).slice(0, 10) : undefined,
          isCarbon: false,
          detailDescription: solution,
          yearlySavingsDiscounted: 0,
          dynamicColumns: [],
          lifecycle: { active: [], completed: [], postponed: [], dismissed: [] },
        },
        extKeys: new Set<string>(),
        savingsSum: 0,
        carbonSum: 0,
      });
    }
    const b = groups.get(key)!;
    const g = b.rec;

    // Celdas dinámicas para el modal (todas las extendedProperties útiles).
    const cells: Record<string, string> = {};
    for (const [ek, ev] of Object.entries(ext)) {
      const lk = ek.toLowerCase();
      if (SAVINGS_KEYS.has(lk) || HIDE_EXT_KEYS.has(lk) || isCarbonKey(ek)) continue;
      const label = humanizeKey(ek);
      cells[label] = String(ev ?? '');
      b.extKeys.add(label);
    }

    const state: 'active' | 'postponed' | 'dismissed' = r._state === 'postponed' || r._state === 'dismissed' ? r._state : 'active';
    const row: AdvisorDynamicRow = {
      subscription: subName,
      resource: r.impactedValue || r.impactedField || undefined,
      cells,
      potentialYearlySavings: savings,
      carbon: carbon || undefined,
      until: r._suppressedUntil ? String(r._suppressedUntil).slice(0, 10) : undefined,
      on: r._suppressedOn ? String(r._suppressedOn).slice(0, 10) : undefined,
    };
    (g.lifecycle![state] as AdvisorDynamicRow[]).push(row);

    // KPIs de la fila de categoría: solo cuentan las activas.
    if (state === 'active') {
      g.activeResources += 1;
      b.savingsSum += savings;
      b.carbonSum += carbon;
    }
  }

  // Finalizar: fijar columnas dinámicas, totales y flags de carbono.
  const out: AdvisorRecommendation[] = [];
  for (const b of groups.values()) {
    const g = b.rec;
    g.dynamicColumns = Array.from(b.extKeys);
    g.potentialSavings = Number(b.savingsSum.toFixed(2));
    g.yearlySavingsDiscounted = g.potentialSavings;
    if (b.carbonSum > 0) {
      g.potentialCarbon = Number(b.carbonSum.toFixed(2));
      g.yearlyCarbon = g.potentialCarbon;
    }
    out.push(g);
  }
  return out;
}

export default function AdvisorPanel() {
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const locale = useLocale();
  const t = useTranslations('advisor');
  const tCommon = useTranslations('Common');
  const [raw, setRaw] = useState<AdvisorModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<AdvisorCategory>('Cost');
  const [selectedSub, setSelectedSub] = useState<string>('all');
  const { selectedSubscription, setSelectedSubscription } = useSubscription();
  const [page, setPage] = useState(0);
  const [modalRec, setModalRec] = useState<AdvisorRecommendation | null>(null);
  const [modalTab, setModalTab] = useState<'active' | 'completed' | 'postponed' | 'dismissed'>('active');

  useEffect(() => {
    if (selectedSubscription) {
      setSelectedSub(selectedSubscription.toLowerCase() === 'all' ? 'all' : selectedSubscription);
    }
  }, [selectedSubscription]);

  useEffect(() => { setPage(0); }, [selectedCategory, selectedSub]);

  useEffect(() => {
    if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') {
      setLoading(false);
      return;
    }
    const fetchAdvisor = async () => {
      try {
        setLoading(true);
        const idToken = accounts.length ? await getFreshIdToken(instance, accounts[0]) : '';
        const res = await fetch(`/api/advisor?tenantId=${selectedTenant.id}&locale=${encodeURIComponent(locale)}`, {
          headers: { 'Authorization': `Bearer ${idToken}`, 'Accept-Language': locale },
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          setError(json.error === 'MISSING_RBAC_ROLE' ? 'MISSING_RBAC_ROLE' : (json.error || 'Error de servidor.'));
          setLoading(false);
          return;
        }
        setRaw({
          recommendations: json.recommendations || {},
          subscriptions: json.subscriptions || [],
          scores: json.scores || {},
          scoreUnits: json.scoreUnits || {},
          resourceTotals: json.resourceTotals || {},
        });
        setError(null);
      } catch (err) {
        console.error(err);
        setError('Fallo de red o credenciales.');
      } finally {
        setLoading(false);
      }
    };
    fetchAdvisor();
  }, [accounts, instance, selectedTenant, locale]);

  const subMap = useMemo(() => {
    const m: Record<string, string> = {};
    (raw?.subscriptions || []).forEach(s => { m[s.id] = s.name; });
    return m;
  }, [raw]);

  // Modelo normalizado y filtrado por suscripción.
  const model = useMemo(() => {
    const out: Record<AdvisorCategory, AdvisorRecommendation[]> = {
      Cost: [], Security: [], HighAvailability: [], Performance: [], OperationalExcellence: [],
    };
    if (!raw) return out;
    for (const cat of ADVISOR_CATEGORIES) {
      let recs = normalizeGroup((raw.recommendations as any)[cat] || [], cat, locale, subMap);
      if (selectedSub !== 'all') recs = recs.filter(r => r.subscriptionId === selectedSub);
      out[cat] = recs;
    }
    return out;
  }, [raw, selectedSub, locale, subMap]);

  const fmtUsd = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  // <10kg con 0 decimales redondeaba valores reales pequeños (p.ej. 0.3kg) a
  // "0 kg CO₂e", indistinguible de "sin datos" — con decimales queda claro
  // que es un valor real, chico, no un placeholder en cero.
  const fmtCarbon = (n: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: (n || 0) < 10 ? 2 : 0 }).format(n || 0)} kg CO₂e`;

  // Exporta a CSV todas las recomendaciones (todas las categorías) del alcance actual.
  const handleExport = () => {
    const cols = [
      t('col_recommendation'), t('col_impact'), t('col_active_resources'), t('col_completion'),
      t('col_potential_saving'), t('col_carbon'), t('col_subscription'), t('col_recommended_actions'),
    ];
    const rows: string[][] = [];
    for (const cat of ADVISOR_CATEGORIES) {
      for (const r of model[cat]) {
        rows.push([
          categoryMeta[cat].label,
          r.recommendation,
          t(`impact_${r.impact.toLowerCase()}`),
          String(r.activeResources),
          `${Math.round(r.completionProgress)}%`,
          r.potentialSavings ? String(r.potentialSavings) : '',
          r.potentialCarbon ? String(r.potentialCarbon) : '',
          subMap[r.subscriptionId] || r.subscriptionId,
          r.recommendedAction || '',
        ]);
      }
    }
    if (rows.length === 0) return;
    const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
    const csv = [[t('col_impact') === 'Impacto' ? 'Categoría' : 'Category', ...cols].map(esc).join(','),
      ...rows.map(r => r.map(esc).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `azure-advisor-${selectedTenant.id}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // Score por categoría (exacto para una suscripción; promedio para "all").
  const catScore = (cat: AdvisorCategory | 'Advisor'): number | null => {
    const scores = raw?.scores || {};
    if (Object.keys(scores).length === 0) return null;
    if (selectedSub !== 'all') {
      const v = (scores[selectedSub] as any)?.[cat];
      return typeof v === 'number' ? v : null;
    }
    // "Todas": media PONDERADA por consumptionUnits (como Azure). Si no hay
    // pesos disponibles (p.ej. mock), cae a media simple.
    const units = raw?.scoreUnits || {};
    const entries = Object.entries(scores)
      .map(([sid, s]) => ({ v: (s as any)[cat] as number, w: Number((units[sid] as any)?.[cat] ?? 0) }))
      .filter(e => typeof e.v === 'number');
    if (entries.length === 0) return null;
    const totalW = entries.reduce((a, e) => a + (e.w || 0), 0);
    if (totalW > 0) return entries.reduce((a, e) => a + e.v * (e.w || 0), 0) / totalW;
    return entries.reduce((a, e) => a + e.v, 0) / entries.length;
  };

  const totalResourcesFor = (cat: AdvisorCategory): number => {
    const rt = raw?.resourceTotals || {};
    if (selectedSub !== 'all') return Number((rt[selectedSub] as any)?.[cat] || 0);
    return Object.values(rt).reduce((sum, m) => sum + Number((m as any)?.[cat] || 0), 0);
  };

  const advisorScore = catScore('Advisor');
  const scoreBadgeColor = (v: number | null) => {
    if (v === null || isNaN(v)) return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
    if (v >= 80) return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900';
    if (v >= 50) return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900';
    return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900';
  };

  const categoryMeta: Record<AdvisorCategory, { label: string; icon: React.ReactNode; color: string }> = {
    Cost: { label: t('cost_label'), icon: <DollarSign className="w-4 h-4" />, color: 'text-brand-deep' },
    Security: { label: t('security_label'), icon: <ShieldCheck className="w-4 h-4" />, color: 'text-rose-600' },
    HighAvailability: { label: t('reliability_label'), icon: <Globe className="w-4 h-4" />, color: 'text-green-600' },
    Performance: { label: t('performance_label'), icon: <BarChart3 className="w-4 h-4" />, color: 'text-amber-600' },
    OperationalExcellence: { label: t('operational_label'), icon: <Medal className="w-4 h-4" />, color: 'text-purple-600' },
  };

  if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') {
    return <div className="p-8 text-center text-ink-soft">{tCommon('loading')}</div>;
  }

  const recs = model[selectedCategory];
  const pageCount = Math.max(1, Math.ceil(recs.length / PAGE_SIZE));
  const pageRecs = recs.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const activeResources = recs.reduce((s, r) => s + (r.activeResources || 0), 0);
  const totalRes = totalResourcesFor(selectedCategory);
  const resPct = totalRes > 0 ? Math.round((activeResources / totalRes) * 100) : 0;
  const totalSavings = recs.reduce((s, r) => s + (r.potentialSavings || 0), 0);

  const ImpactBadge = ({ impact }: { impact: AdvisorRecommendation['impact'] }) => (
    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border ${impactBadgeClasses(impact)}`}>
      {t(`impact_${impact.toLowerCase()}`)}
    </span>
  );

  const Progress = ({ value }: { value: number }) => (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden">
        <div className="h-full bg-brand-bright rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="text-[11px] text-ink-soft tabular-nums w-8 text-right">{Math.round(value)}%</span>
    </div>
  );

  const Th = ({ children }: { children: React.ReactNode }) => (
    <th className="text-left text-[10.5px] tracking-[0.5px] uppercase text-grey font-bold p-[10px_14px] border-b border-line whitespace-nowrap">{children}</th>
  );
  const Td = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <td className={`p-[11px_14px] text-[12.5px] text-ink align-top ${className}`}>{children}</td>
  );

  // KPI card. `emphasis` agranda aún más el valor principal (usado para el
  // monto de ahorro en USD, que debe pesar más visualmente que un conteo).
  const Kpi = ({ icon, label, value, sub, color, emphasis }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; color: string; emphasis?: boolean }) => (
    <div className="bg-surface border border-line rounded-[16px] p-[20px_22px] shadow-[0_1px_2px_rgba(16,40,73,0.06),0_8px_24px_rgba(16,40,73,0.07)] flex items-center gap-4">
      <div className={`w-14 h-14 shrink-0 rounded-[12px] grid place-items-center ${color}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] tracking-[0.6px] uppercase text-grey font-bold">{label}</div>
        <div className={`font-heading font-extrabold tracking-tight leading-tight ${emphasis ? 'text-[32px]' : 'text-[24px]'} text-ink`}>{value}</div>
        {sub && <div className="text-[12.5px] text-ink-soft mt-1">{sub}</div>}
      </div>
    </div>
  );

  const isCost = selectedCategory === 'Cost';

  return (
    <div className="animate-in fade-in flex flex-col gap-5">
      {/* Header */}
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
          <span className="text-[11px] font-bold tracking-[0.4px] bg-[#E6F2FB] dark:bg-slate-800 text-brand-deep dark:text-slate-200 px-[11px] py-[5px] rounded-lg inline-flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" /> {selectedTenant.name}
          </span>
          <span className={`text-[11px] font-bold tracking-[0.4px] px-[11px] py-[5px] rounded-lg border inline-flex items-center gap-1.5 ${scoreBadgeColor(advisorScore)}`}>
            <Trophy className="w-3.5 h-3.5" /> {t('advisor_score')}: {advisorScore !== null ? `${advisorScore.toFixed(1)}%` : 'N/A'}
          </span>
          <div className="flex items-center gap-[9px] bg-surface border border-line-strong rounded-[10px] p-[6px_9px_6px_12px] shadow-sm">
            <label className="text-[10px] tracking-[1px] uppercase text-grey font-bold">{t('scope')}</label>
            <select
              value={selectedSub}
              onChange={(e) => { const val = e.target.value; setSelectedSub(val); setSelectedSubscription(val === 'all' ? 'All' : val); }}
              className="border-0 bg-transparent font-heading font-bold text-[13px] text-brand-deep cursor-pointer focus:outline-none p-0 m-0 w-32 md:w-auto truncate dark:text-white"
            >
              <option value="all">{t('all_subs')}</option>
              {(raw?.subscriptions || []).map(s => (<option key={s.id} value={s.id}>{s.name || s.id}</option>))}
            </select>
          </div>
          <button onClick={handleExport} className="font-heading font-semibold text-[13px] rounded-[10px] border border-line-strong p-[7px_14px] cursor-pointer transition-colors inline-flex items-center gap-[7px] whitespace-nowrap bg-surface text-ink-soft hover:border-brand-bright hover:text-brand-deep active:scale-95">
            <Download className="w-4 h-4" /> {t('export_csv')}
          </button>
        </div>
      </div>

      {error === 'MISSING_RBAC_ROLE' ? <RoleAssignmentBanner /> : error ? (
        <div className="text-danger p-4 bg-danger-soft rounded-lg">{error}</div>
      ) : loading ? (
        <div className="animate-pulse p-8 text-center">{tCommon('loading')}</div>
      ) : (
        <>
          {/* Category tab bar */}
          <div className="flex gap-2 flex-wrap">
            {ADVISOR_CATEGORIES.map(cat => {
              const meta = categoryMeta[cat];
              const cs = catScore(cat);
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-[10px] border text-[13px] font-bold transition-all ${active ? 'border-brand-bright bg-[#E6F2FB] dark:bg-slate-800 text-brand-deep dark:text-white' : 'border-line bg-surface text-ink-soft hover:border-line-strong'}`}
                >
                  <span className={meta.color}>{meta.icon}</span>
                  {meta.label}
                  <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-surface-2 text-grey">{model[cat].length}</span>
                  {cs !== null && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${scoreBadgeColor(cs)}`}>{cs.toFixed(0)}%</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* KPIs de la categoría. En Costos, el monto de ahorro en USD es el
              dato que más importa al negocio — se muestra como valor
              principal (grande, verde) y la cantidad de recomendaciones pasa
              a texto secundario, en vez de al revés. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[16px]">
            {isCost && totalSavings > 0 ? (
              <Kpi
                icon={categoryMeta[selectedCategory].icon}
                color="bg-green-50 dark:bg-green-950/40 text-green-600"
                label={t('potential_savings_year')}
                value={<span className="text-green-600">{fmtUsd(totalSavings)}</span>}
                sub={`${recs.length} ${t('active_recommendations').toLowerCase()}`}
                emphasis
              />
            ) : (
              <Kpi
                icon={categoryMeta[selectedCategory].icon}
                color={`bg-surface-2 ${categoryMeta[selectedCategory].color}`}
                label={t('active_recommendations')}
                value={recs.length}
              />
            )}
            <Kpi
              icon={<Layers className="w-5 h-5" />}
              color="bg-surface-2 text-brand-deep"
              label={t('active_resources')}
              value={totalRes > 0
                ? <span>{activeResources} <span className="text-[13px] text-grey font-bold">/ {totalRes}</span></span>
                : <span>{activeResources}</span>}
              sub={totalRes > 0 ? t('affected_pct', { pct: resPct }) : undefined}
            />
          </div>

          {/* Tabla de la categoría */}
          <div className="bg-surface border border-line rounded-[14px] shadow-sm overflow-hidden">
            {recs.length === 0 ? (
              <div className="p-[34px] text-center text-grey text-[13px]">{t('no_recs')} 🎉</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-surface-2">
                      <tr>
                        <Th>{t('col_recommendation')}</Th>
                        <Th>{t('col_impact')}</Th>
                        <Th>{t('col_active_resources')}</Th>
                        {isCost && <Th>{t('col_completion')}</Th>}
                        {selectedCategory === 'HighAvailability' && <Th>{t('col_completion')}</Th>}
                        {(selectedCategory === 'Performance' || selectedCategory === 'OperationalExcellence') && <Th>{t('col_completion')}</Th>}
                        {selectedCategory === 'Security' && <Th>{t('col_last_refreshed')}</Th>}
                        {isCost && <Th>{t('col_potential_saving')}</Th>}
                        {isCost && <Th>{t('col_carbon')}</Th>}
                        {selectedCategory === 'HighAvailability' && <Th>{t('col_cost_implications')}</Th>}
                        {(isCost || selectedCategory === 'HighAvailability' || selectedCategory === 'Performance' || selectedCategory === 'OperationalExcellence') && <Th>{t('col_recommended_actions')}</Th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRecs.map((rec) => (
                        <tr key={rec.id} className="hover:bg-surface-2 transition-colors border-b border-line last:border-0">
                          <Td className="font-bold max-w-[340px]">{rec.recommendation}</Td>
                          <Td><ImpactBadge impact={rec.impact} /></Td>
                          <Td className="tabular-nums">{rec.activeResources}</Td>
                          {(isCost || selectedCategory === 'HighAvailability' || selectedCategory === 'Performance' || selectedCategory === 'OperationalExcellence') && (
                            <Td><Progress value={rec.completionProgress} /></Td>
                          )}
                          {selectedCategory === 'Security' && (
                            <Td className="text-ink-soft whitespace-nowrap">{rec.lastRefreshed || '—'}</Td>
                          )}
                          {isCost && <Td className="font-bold text-green-600 whitespace-nowrap">{rec.potentialSavings ? fmtUsd(rec.potentialSavings) : '—'}</Td>}
                          {isCost && <Td className="text-ink-soft whitespace-nowrap">{rec.potentialCarbon ? <span className="inline-flex items-center gap-1"><Leaf className="w-3.5 h-3.5 text-emerald-500" />{fmtCarbon(rec.potentialCarbon)}</span> : '—'}</Td>}
                          {selectedCategory === 'HighAvailability' && <Td className="text-ink-soft">{rec.costImplication || '—'}</Td>}
                          {isCost ? (
                            <Td>
                              <button onClick={() => { setModalRec(rec); setModalTab('active'); }} className="text-brand-deep font-semibold hover:underline whitespace-nowrap">
                                {t('view_details')}
                              </button>
                            </Td>
                          ) : (selectedCategory === 'HighAvailability' || selectedCategory === 'Performance' || selectedCategory === 'OperationalExcellence') ? (
                            <Td className="text-ink-soft max-w-[320px]">{rec.recommendedAction || '—'}</Td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Paginación */}
                {pageCount > 1 && (
                  <div className="flex items-center justify-between p-[10px_16px] border-t border-line text-[12px] text-ink-soft">
                    <span>{t('page_of', { page: page + 1, total: pageCount })}</span>
                    <div className="flex gap-2">
                      <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="p-1.5 rounded-md border border-line disabled:opacity-40 hover:border-line-strong"><ChevronLeft className="w-4 h-4" /></button>
                      <button disabled={page >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} className="p-1.5 rounded-md border border-line disabled:opacity-40 hover:border-line-strong"><ChevronRight className="w-4 h-4" /></button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {modalRec && (
        <RecDetailModal rec={modalRec} tab={modalTab} setTab={setModalTab} onClose={() => setModalRec(null)} fmtUsd={fmtUsd} fmtCarbon={fmtCarbon} />
      )}
    </div>
  );
}

// Columna de tabla redimensionable a mano (drag del borde derecho). Debe vivir
// a nivel de módulo (no definida inline dentro del render del modal): usa
// useRef, y un componente redefinido en cada render pierde su identidad para
// React y se remonta constantemente, reseteando el ancho arrastrado.
function ResizableTh({ children, minWidth = 90 }: { children: React.ReactNode; minWidth?: number }) {
  const thRef = useRef<HTMLTableCellElement>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const th = thRef.current;
    if (!th) return;
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent) => {
      th.style.width = `${Math.max(minWidth, startWidth + (ev.clientX - startX))}px`;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return (
    <th
      ref={thRef}
      style={{ minWidth }}
      className="sticky top-0 z-10 bg-surface-2 relative text-left text-[10.5px] tracking-[0.5px] uppercase text-grey font-bold p-[9px_16px_9px_12px] border-b border-line whitespace-nowrap select-none"
    >
      {children}
      <span
        onMouseDown={onMouseDown}
        title="Arrastrar para ajustar ancho"
        className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-brand-bright/50 active:bg-brand-bright"
      />
    </th>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal de detalle de recomendación de Costo, con 4 pestañas.
// ─────────────────────────────────────────────────────────────────────────────
function RecDetailModal({
  rec, tab, setTab, onClose, fmtUsd, fmtCarbon,
}: {
  rec: AdvisorRecommendation;
  tab: 'active' | 'completed' | 'postponed' | 'dismissed';
  setTab: (t: 'active' | 'completed' | 'postponed' | 'dismissed') => void;
  onClose: () => void;
  fmtUsd: (n: number) => string;
  fmtCarbon: (n: number) => string;
}) {
  const t = useTranslations('advisor');
  const [expanded, setExpanded] = useState(false);
  const lc = rec.lifecycle || { active: [], completed: [], postponed: [], dismissed: [] };
  const counts = {
    active: lc.active.length, completed: lc.completed.length, postponed: lc.postponed.length, dismissed: lc.dismissed.length,
  };
  const rows = lc[tab];
  const isCarbon = !!rec.isCarbon;
  // Datos reales → columnas dinámicas desde extendedProperties.
  const isDynamic = Array.isArray(rec.dynamicColumns);
  const dynCols = rec.dynamicColumns || [];
  const dynHasCarbon = isDynamic && (['active', 'postponed', 'dismissed', 'completed'] as const)
    .some(k => (lc[k] as AdvisorDynamicRow[]).some(r => (r as AdvisorDynamicRow).carbon));

  const tabs: Array<{ id: typeof tab; label: string }> = [
    { id: 'active', label: t('tab_active') },
    { id: 'completed', label: t('tab_completed') },
    { id: 'postponed', label: t('tab_postponed') },
    { id: 'dismissed', label: t('tab_dismissed') },
  ];

  // Th del modal = ResizableTh (nivel de módulo, ver arriba) para que el
  // usuario pueda arrastrar y ajustar el ancho de cada columna a mano.
  const Th = ResizableTh;
  // whitespace-normal (no nowrap): con columnas redimensionables el texto
  // debe poder envolver dentro del ancho elegido, en vez de desbordar y
  // solaparse con la columna vecina.
  const Td = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <td className={`p-[10px_12px] text-[12px] text-ink align-top whitespace-normal break-words ${className}`}>{children}</td>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{
          width: expanded ? '96vw' : 'auto',
          height: expanded ? '92vh' : 'auto',
          maxWidth: '96vw',
          maxHeight: '92vh',
          minWidth: '340px',
          minHeight: '240px',
          resize: 'both',
        }}
      >
        {/* Header */}
        <div className="p-5 border-b border-line flex items-start gap-4 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-bold text-ink mb-1">{t('rec_details_title')}</h3>
            <p className="text-[12.5px] text-ink-soft leading-relaxed max-w-2xl">{rec.detailDescription || t('rec_details_desc_default')}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] text-grey font-semibold max-w-[200px]">{t('potential_yearly_savings_discounted')}</div>
            <div className="text-[22px] font-extrabold text-green-600 tabular-nums">{fmtUsd(rec.yearlySavingsDiscounted || rec.potentialSavings || 0)}</div>
            {rec.yearlyCarbon ? (
              <>
                <div className="text-[11px] text-grey font-semibold mt-1">{t('potential_yearly_carbon')}</div>
                <div className="text-[15px] font-bold text-emerald-600 inline-flex items-center gap-1 justify-end"><Leaf className="w-3.5 h-3.5" />{fmtCarbon(rec.yearlyCarbon)}</div>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setExpanded(v => !v)} title={expanded ? t('restore') : t('maximize')} className="text-grey hover:text-ink transition-colors bg-surface-2 p-1.5 rounded-md border border-line">
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="text-grey hover:text-ink transition-colors bg-surface-2 p-1.5 rounded-md border border-line"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 border-b border-line shrink-0">
          {tabs.map(tb => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`px-3.5 py-2 text-[13px] font-bold rounded-t-lg border-b-2 transition-colors flex items-center gap-2 ${tab === tb.id ? 'border-brand-bright text-brand-deep' : 'border-transparent text-ink-soft hover:text-ink'}`}
            >
              {tb.label}
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-surface-2 text-grey">{counts[tb.id]}</span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-auto p-1 flex-1 min-h-0">
          {rows.length === 0 ? (
            <div className="p-10 text-center text-grey text-[13px]">{t('no_items')}</div>
          ) : (
            <table className="w-full border-collapse table-fixed">
              <thead>
                <tr>
                  {isDynamic ? (
                    <>
                      <Th>{t('col_subscription')}</Th>
                      <Th>{t('col_resource')}</Th>
                      {dynCols.map(c => <Th key={c}>{c}</Th>)}
                      <Th>{t('col_potential_yearly_savings')}</Th>
                      {dynHasCarbon && <Th>{t('col_carbon')}</Th>}
                      {tab === 'postponed' && (<><Th>{t('col_postponed_until')}</Th><Th>{t('col_postponed_on')}</Th></>)}
                      {tab === 'dismissed' && <Th>{t('col_dismissed_on')}</Th>}
                    </>
                  ) : isCarbon ? (
                    <>
                      <Th>{t('col_virtual_machine')}</Th>
                      <Th>{t('col_recommended_actions')}</Th>
                      <Th>{t('col_savings_retail')}</Th>
                      <Th>{t('col_savings_discounted')}</Th>
                      <Th>{t('col_carbon')}</Th>
                      <Th>{t('col_subscription')}</Th>
                      <Th>{t('col_recommendation_rule')}</Th>
                      <Th>{t('col_additional_details')}</Th>
                    </>
                  ) : (
                    <>
                      <Th>{t('col_subscription')}</Th>
                      <Th>{t('col_recommended_quantity')}</Th>
                      <Th>{t('col_recommended_actions')}</Th>
                      <Th>{t('col_potential_yearly_savings')}</Th>
                      <Th>{t('col_term')}</Th>
                      <Th>{t('col_lookback')}</Th>
                      <Th>{t('col_created')}</Th>
                      {tab === 'active' && <Th>{t('col_last_updates')}</Th>}
                      {tab === 'completed' && (<><Th>{t('col_completion_details')}</Th><Th>{t('col_completed_on')}</Th></>)}
                      {tab === 'postponed' && (<><Th>{t('col_postponed_until')}</Th><Th>{t('col_postponed_on')}</Th></>)}
                      {tab === 'dismissed' && (<><Th>{t('col_dismissal_reason')}</Th><Th>{t('col_dismissed_on')}</Th></>)}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  if (isDynamic) {
                    const d = r as AdvisorDynamicRow;
                    return (
                      <tr key={i} className="border-b border-line last:border-0 hover:bg-surface-2">
                        <Td className="font-bold">{d.subscription}</Td>
                        <Td className="text-ink-soft whitespace-normal max-w-[220px] break-all">{d.resource || '—'}</Td>
                        {dynCols.map(c => <Td key={c} className="whitespace-normal max-w-[220px]">{d.cells?.[c] || '—'}</Td>)}
                        <Td className="tabular-nums font-bold text-green-600">{d.potentialYearlySavings ? fmtUsd(d.potentialYearlySavings) : '—'}</Td>
                        {dynHasCarbon && <Td className="tabular-nums text-emerald-600">{d.carbon ? fmtCarbon(d.carbon) : '—'}</Td>}
                        {tab === 'postponed' && (<><Td>{d.until || '—'}</Td><Td>{d.on || '—'}</Td></>)}
                        {tab === 'dismissed' && <Td>{d.on || '—'}</Td>}
                      </tr>
                    );
                  }
                  if (isCarbon) {
                    const c = r as AdvisorCarbonRow;
                    return (
                      <tr key={i} className="border-b border-line last:border-0 hover:bg-surface-2">
                        <Td className="font-bold">{c.virtualMachine}</Td>
                        <Td>{c.recommendedAction}</Td>
                        <Td className="tabular-nums">{fmtUsd(c.savingsRetail)}</Td>
                        <Td className="tabular-nums font-bold text-green-600">{fmtUsd(c.savingsDiscounted)}</Td>
                        <Td className="tabular-nums text-emerald-600">{fmtCarbon(c.carbonReduction)}</Td>
                        <Td>{c.subscription}</Td>
                        <Td className="text-ink-soft">{c.recommendationRule}</Td>
                        <Td className="text-ink-soft whitespace-normal max-w-[220px]">{c.additionalDetails}</Td>
                      </tr>
                    );
                  }
                  const s = r as AdvisorLifecycleRow;
                  return (
                    <tr key={i} className="border-b border-line last:border-0 hover:bg-surface-2">
                      <Td className="font-bold">{s.subscription}</Td>
                      <Td className="tabular-nums">{s.recommendedQuantity || '—'}</Td>
                      <Td>{s.recommendedAction}</Td>
                      <Td className="tabular-nums font-bold text-green-600">{fmtUsd(s.potentialYearlySavings)}</Td>
                      <Td>{s.term || '—'}</Td>
                      <Td>{s.lookBackPeriod || '—'}</Td>
                      <Td>{s.created || '—'}</Td>
                      {tab === 'active' && <Td>{s.lastUpdated || '—'}</Td>}
                      {tab === 'completed' && (<><Td className="text-ink-soft whitespace-normal max-w-[200px]">{s.completionDetails || '—'}</Td><Td>{s.completedOn || '—'}</Td></>)}
                      {tab === 'postponed' && (<><Td>{s.postponedUntil || '—'}</Td><Td>{s.postponedOn || '—'}</Td></>)}
                      {tab === 'dismissed' && (<><Td className="text-ink-soft whitespace-normal max-w-[200px]">{s.dismissalReason || '—'}</Td><Td>{s.dismissedOn || '—'}</Td></>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
