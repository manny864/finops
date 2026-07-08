"use client";
import { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { TabContext } from '@/components/ClientShell';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import ZombieResourcesTable from "@/components/ZombieResourcesTable";
import TagManager from "@/components/TagManager";
import CostPieChart from "@/components/CostPieChart";
import AdvisorPanel from "@/components/AdvisorPanel";
import PowerSchedules from "@/components/dashboard/PowerSchedules";
import BudgetBurnChart from "@/components/dashboard/BudgetBurnChart";
import RightsizingBlade from "@/components/dashboard/RightsizingBlade";
import ExpiredSandboxTable from "@/components/dashboard/ExpiredSandboxTable";
import ExecutiveSummaryCard from "@/components/dashboard/ExecutiveSummaryCard";
import HABreakdownCard from "@/components/dashboard/HABreakdownCard";
import AksChargebackCard from "@/components/dashboard/AksChargebackCard";
import CostProjectionCard from "@/components/dashboard/CostProjectionCard";
import { useActionLogStore } from "@/store/actionLogStore";
import { Leaf } from "lucide-react";
import { useTranslations } from 'next-intl';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { isMockTenant } from '@/lib/mockData';
import FeatureGuard from '@/components/FeatureGuard';
import { getFreshIdToken } from '@/lib/msalToken';
import MockBanner from '@/components/MockBanner';
import HistoryButton from '@/components/history/HistoryButton';
import MyPinnedWidgets from '@/components/dashboard/MyPinnedWidgets';
import { useCurrency } from '@/components/CurrencyProvider';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';


const ResponsiveGridLayout = WidthProvider(Responsive);

export default function Home() {
  const router = useRouter();
  const { locale } = useParams();
  const onboardingRedirectRef = useRef(false);
  
  const { activeTab, setActiveTab } = useContext(TabContext);
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const { selectedSubscription } = useSubscription();
  const { format } = useCurrency();
  
  const [dashboardData, setDashboardData] = useState<any[]>([]);
  const totalSavings = dashboardData.reduce((sum, item) => sum + (item.potentialSavings || 0), 0);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [complianceScore, setComplianceScore] = useState<number | null>(null);
  const [advisorSavings, setAdvisorSavings] = useState<number>(0);
  const [actualCost, setActualCost] = useState<number>(0);
  const [projectedCost, setProjectedCost] = useState<number>(0);
  const [zombieCount, setZombieCount] = useState<number>(0);
  const [histogramMonths, setHistogramMonths] = useState<number>(1);
  const [billingHistogram, setBillingHistogram] = useState<Array<{ date: string; cost: number }>>([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [summaryDegraded, setSummaryDegraded] = useState<string | null>(null);
  const [auditNoPerms, setAuditNoPerms] = useState(false);
  const [azureNoAccess, setAzureNoAccess] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [chartsMounted, setChartsMounted] = useState(false);
  const { addAction } = useActionLogStore();

  const calculateCO2Savings = (wastedUsd: number) => {
      // Proxy: $100 waste removed = 15 kg CO2 saved
      return ((wastedUsd / 100) * 15).toFixed(1);
  };

  // Auto-redirect to onboarding if tenant not onboarded
  useEffect(() => {
    if (onboardingRedirectRef.current) return;
    if (!selectedTenant || selectedTenant.id === 'default' || accounts.length === 0) return;
    // Tenants demo/mock (incluido cuando un SUPERADMIN navega a uno) nunca
    // deben pasar por el wizard de onboarding real: no tienen fila en la DB,
    // por lo que `/api/onboarding/progress` respondía is_onboarded=false y
    // esto redirigía de vuelta a /onboarding en loop justo después de que el
    // wizard llamara a router.push(`/${locale}`) al finalizar.
    if (isMockTenant(selectedTenant.id)) return;
    
    const checkOnboarding = async () => {
      try {
        const token = await getFreshIdToken(instance, accounts[0]).catch(() => '');
        const response = await fetch('/api/onboarding/progress', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        if (response.ok) {
          const data = await response.json();
          // El funnel de onboarding sólo aplica a entornos recién creados que
          // aún NO tienen credenciales Azure (client_id + secret). Si el entorno
          // ya está configurado, no lo forzamos al wizard aunque is_onboarded
          // sea false (p.ej. onboarding técnico hecho pero flag no seteado).
          const hasCredentials = !!(selectedTenant.client_id && selectedTenant.has_client_secret);
          if (!selectedTenant.is_onboarded && !hasCredentials) {
            onboardingRedirectRef.current = true;
            router.push(`/${locale}/onboarding`);
          }
        }
      } catch (error) {
        console.error('[Home] Failed to check onboarding:', error);
      }
    };
    
    checkOnboarding();
  }, [selectedTenant?.id, accounts.length]);

  useEffect(() => {
      if (activeTab !== 'dashboard' || (accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') return;
      
      const fetchData = async () => {
          setLoading(true);
          setBillingLoading(true);
          try {
              const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
              const summarySubscription = selectedSubscription && selectedSubscription.toLowerCase() !== 'all'
                  ? selectedSubscription
                  : 'All';
              const anomalySubscription = summarySubscription;
              const headers = { 'Authorization': `Bearer ${tokenResponse.idToken}` };

              // Disparamos los 3 endpoints en PARALELO. Antes era serie:
              //   summary (18s) → tags → anomalies. Ahora el wall-clock es max(3) en lugar de sum(3).
              // bust=1 on explicit retries (retryKey > 0) forces Redis cache invalidation for the tenant.
              const bustParam = retryKey > 0 ? '&bust=1' : '';
              const summaryP = fetch(`/api/dashboard/summary?tenantId=${selectedTenant.id}&subscriptionId=${summarySubscription}&months=13${bustParam}`, { headers })
                  .then(async r => {
                      if (!r.ok) {
                          console.warn('[Dashboard] summary returned', r.status, await r.text().catch(() => ''));
                          setSummaryFailed(true);
                          return {};
                      }
                      return r.json();
                  })
                  .catch(e => { console.error('[Dashboard] summary fetch error:', e); setSummaryFailed(true); return {}; });
              const tagsP = fetch(`/api/tags?tenantId=${selectedTenant.id}`, { headers })
                  .then(r => r.ok ? r.json() : { policies: [] })
                  .catch(() => ({ policies: [] }));
              const anomaliesP = fetch(`/api/intelligence/anomalies?tenantId=${selectedTenant.id}&subscriptionId=${anomalySubscription}`, { headers })
                  .then(r => r.ok ? r.json() : null)
                  .catch(() => null);

              // Renderizamos summary cuanto antes (los costos/histograma no esperan a tags/anomalies).
              const summaryJson: any = await summaryP;

              // Log full response for diagnostics (dev-friendly)
              if (summaryJson.degraded) {
                  console.warn('[Dashboard] summary degraded:', summaryJson.degradedReason, '| actualCost:', summaryJson.actualCost, '| degraded:', summaryJson.degraded);
              }

              setSummaryDegraded(summaryJson.degraded ? (summaryJson.degradedReason || 'unknown') : null);
              setAuditNoPerms(!!summaryJson.auditNoPermissions);
              setAzureNoAccess(!!summaryJson.azureNoAccess);
              if (summaryJson.dashboardData) {
                  setDashboardData(summaryJson.dashboardData);
              } else {
                  setDashboardData([]);
              }
              setActualCost(Number(summaryJson.actualCost || 0));
              setProjectedCost(Number(summaryJson.projectedCost || 0));
              setZombieCount(Number(summaryJson.zombieCount || 0));
              setBillingHistogram(Array.isArray(summaryJson.histogram) ? summaryJson.histogram : []);
              setAdvisorSavings(Number(summaryJson.totalSavings || 0));
              setBillingLoading(false);
              setLoading(false);

              // Si el backend ya provee un complianceScore (p.ej. modo demo, o un
              // futuro cálculo server-side), usarlo directo y saltar el cómputo
              // por-recurso (que sobre recursos zombie sin tags da ~0%).
              if (typeof summaryJson.complianceScore === 'number') {
                  setComplianceScore(summaryJson.complianceScore);
              } else if (summaryJson.auditResults) {
                  const polJson: any = await tagsP;
                  const policies = polJson.policies || [];

                  if (policies.length === 0) {
                      setComplianceScore(-1); // -1 means Not Configured
                  } else {
                      const allItems = Object.values(summaryJson.auditResults).flat();
                      const requiredKeys = policies.filter((p:any) => p.required).map((p:any) => p.tag_key.toLowerCase());
                      let compliantCount = 0;
                      allItems.forEach((item: any) => {
                          const itemTags = item.tags || {};
                          const itemTagKeys = Object.keys(itemTags).map(k => k.toLowerCase());
                          const missingTags = requiredKeys.filter((reqKey:any) => !itemTagKeys.includes(reqKey));
                          if (missingTags.length === 0) compliantCount++;
                      });
                      setComplianceScore(allItems.length > 0 ? Math.round((compliantCount / allItems.length) * 100) : 100);
                  }
              }

              const anomalyJson: any = await anomaliesP;
              if (anomalyJson?.isAnomaly) {
                  addAction({
                      message: `Pico inusual de costos detectado (${anomalyJson.percentageIncrease.toFixed(1)}%). Revisa el grupo de recursos: ${anomalyJson.affectedResourceGroup}`,
                      status: 'error'
                  });
              }
          } catch (e: any) {
              console.error('[Dashboard] fetchData failed:', e?.message || e);
              setSummaryFailed(true);
              if (e instanceof InteractionRequiredAuthError) {
                  // Token expired / revoked — redirect to interactive login
                  instance.loginRedirect({ scopes: ['User.Read'] }).catch(() => {});
              }
          }
          setBillingLoading(false);
          setLoading(false);
      };
      setSummaryFailed(false);
      setSummaryDegraded(null);
      setAuditNoPerms(false);
      setAzureNoAccess(false);
      fetchData();
  }, [activeTab, selectedTenant, selectedSubscription, accounts, instance, retryKey]);

  const filteredHistogramData = (() => {
      if (billingHistogram.length === 0) return [];
      const latest = new Date(`${billingHistogram[billingHistogram.length - 1].date}T00:00:00`);
      if (Number.isNaN(latest.getTime())) return billingHistogram;
      const start = new Date(latest);
      start.setMonth(start.getMonth() - histogramMonths + 1);
      start.setDate(1);
      return billingHistogram.filter(point => {
          const d = new Date(`${point.date}T00:00:00`);
          return !Number.isNaN(d.getTime()) && d >= start && d <= latest;
      });
  })();

  const formatHistogramDate = (value: unknown) => {
      const raw = String(value || '').trim();
      if (!raw) return '--/--';
      const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (compact) {
          return `${compact[3]}/${compact[2]}`;
      }
      const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dashed) {
          return `${dashed[3]}/${dashed[2]}`;
      }
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
          const d = String(parsed.getUTCDate()).padStart(2, '0');
          const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
          return `${d}/${m}`;
      }
      return '--/--';
  };

  const t = useTranslations('Dashboard');
  const tCommon = useTranslations('Common');

  const [layouts, setLayouts] = useState<any>(null);
  useEffect(() => {
    setChartsMounted(true);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('finops_dashboard_layout_v2');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Migración: agregar widgets nuevos si el layout guardado no los incluye
        const newKeys: Record<string, any> = {
          ha: { i: 'ha', x: 0, y: 14, w: 6, h: 4 },
          aks: { i: 'aks', x: 6, y: 14, w: 6, h: 4 },
          projection: { i: 'projection', x: 0, y: 18, w: 12, h: 6 },
        };
        Object.keys(parsed).forEach((bp: string) => {
          const existing = new Set((parsed[bp] || []).map((l: any) => l.i));
          Object.keys(newKeys).forEach(k => { if (!existing.has(k)) parsed[bp].push(newKeys[k]); });
        });
        setLayouts(parsed);
      } catch (e) {}
    } else {
      setLayouts({
        lg: [
          { i: 'exec', x: 0, y: 0, w: 12, h: 2 },
          { i: 'pie', x: 0, y: 2, w: 6, h: 4 },
          { i: 'gov', x: 6, y: 2, w: 6, h: 4 },
          { i: 'burn', x: 0, y: 6, w: 6, h: 4 },
          { i: 'power', x: 6, y: 6, w: 6, h: 4 },
          { i: 'right', x: 0, y: 10, w: 6, h: 4 },
          { i: 'sandbox', x: 6, y: 10, w: 6, h: 4 },
          { i: 'ha', x: 0, y: 14, w: 6, h: 4 },
          { i: 'aks', x: 6, y: 14, w: 6, h: 4 },
          { i: 'projection', x: 0, y: 18, w: 12, h: 6 }
        ]
      });
    }
  }, []);

  const onLayoutChange = (layout: any, allLayouts: any) => {
    setLayouts(allLayouts);
    localStorage.setItem('finops_dashboard_layout_v2', JSON.stringify(allLayouts));
  };

  const handleBudgetResize = useCallback((newH: number) => {
    setLayouts((prev: any) => {
      if (!prev || !prev.lg) return prev;
      let changed = false;
      const nextLayouts = { ...prev };
      Object.keys(nextLayouts).forEach(bp => {
        nextLayouts[bp] = nextLayouts[bp].map((l: any) => {
          if (l.i === 'burn' && l.h !== newH) {
            changed = true;
            return { ...l, h: newH };
          }
          return l;
        });
      });
      if (!changed) return prev;
      return nextLayouts;
    });
  }, []);

  if (activeTab === 'audit') {
      return (
          <div className="content animate-in fade-in duration-300">
              <div className="vhead">
                  <div className="title">
                      <h1>Auditoría Completa FinOps</h1>
                      <p>Motor Omni-Scan: Detección y Remediación de 25 tipos de recursos huérfanos.</p>
                  </div>
              </div>
              <ZombieResourcesTable />
          </div>
      );
  }

  
  if (activeTab === 'advisor') {
      return (
          <div className="content animate-in fade-in duration-300">
              <AdvisorPanel />
          </div>
      );
  }
  if (activeTab === 'tags') {
      return <div className="content"><TagManager /></div>;
  }

  if (activeTab === 'powerbi' || activeTab === 'config') {
      return (
          <div className="content">
              <div className="card h-96 flex flex-col items-center justify-center animate-in fade-in">
                  <span className="text-6xl mb-4">🚧</span>
                  <h2 className="text-xl font-bold text-[var(--brand-deep)]">Módulo en Construcción</h2>
                  <p className="text-sm text-gray-500 mt-2">La sección de {activeTab === 'powerbi' ? 'Reportes Power BI' : 'Configuración'} estará disponible en la próxima fase.</p>
              </div>
          </div>
      );
  }

  if (!layouts) return null; // Avoid hydration mismatch

  return (
    <div className="content animate-in fade-in duration-500">
      <MockBanner />
      <MyPinnedWidgets />
      {summaryFailed && !loading && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
          <span className="text-lg">⚠️</span>
          <span className="flex-1">No se pudieron cargar los datos del dashboard. Verifica tu sesión o la conectividad con Azure.</span>
          <button
            onClick={() => { setSummaryFailed(false); setSummaryDegraded(null); setRetryKey(k => k + 1); }}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-600"
          >
            Reintentar
          </button>
        </div>
      )}
      {(summaryDegraded || auditNoPerms) && !loading && !summaryFailed && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-700/40 dark:bg-yellow-900/20 dark:text-yellow-200">
          <span className="text-lg">{auditNoPerms && !summaryDegraded ? '⚙️' : '🔶'}</span>
          <span className="flex-1">
            {auditNoPerms && !summaryDegraded ? (
              <>
                <strong>Auditoría no configurada</strong> — El Service Principal aún no tiene permisos de Lector en Azure.
                {' '}Los costos se muestran desde el historial sincronizado. <a href="#" onClick={e => { e.preventDefault(); setActiveTab('config'); }} className="underline">Completar onboarding →</a>
              </>
            ) : (
              <>
                <strong>Modo degradado</strong> — {summaryDegraded === 'audit+forecast' ? 'Auditoría Azure y Forecast fallaron' : summaryDegraded === 'audit' ? 'Auditoría Azure no disponible' : summaryDegraded === 'forecast' ? 'Forecast de costos no disponible' : 'Algunos datos de Azure no están disponibles'}.
                {' '}Los valores mostrados son parciales o de caché. Verifica permisos del Service Principal en Azure.
              </>
            )}
          </span>
          <button
            onClick={() => { setSummaryDegraded(null); setAuditNoPerms(false); setAzureNoAccess(false); setRetryKey(k => k + 1); }}
            className="shrink-0 rounded-md border border-yellow-300 bg-white px-3 py-1 text-xs font-semibold text-yellow-700 hover:bg-yellow-50 dark:bg-yellow-900/30"
          >
            Reintentar
          </button>
        </div>
      )}
      {azureNoAccess && !loading && !summaryFailed && (
        <div className="mb-3 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-700/40 dark:bg-blue-900/20 dark:text-blue-200">
          <span className="text-lg mt-0.5">💡</span>
          <span className="flex-1">
            <strong>Sin datos de costos Azure.</strong>{' '}
            El Service Principal no tiene el rol{' '}
            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded text-xs font-mono">Cost Management Reader</code>{' '}
            asignado en tus suscripciones.{' '}
            Ve a{' '}
            <a href={`/${locale}/admin/onboarding`} className="underline font-semibold hover:text-blue-600">
              Admin → Onboarding
            </a>
            , genera el script PowerShell y ejecútalo en Azure para asignar los roles.
            Luego haz clic en <strong>Reintentar</strong>.
          </span>
          <button
            onClick={() => { setAzureNoAccess(false); setRetryKey(k => k + 1); }}
            className="shrink-0 rounded-md border border-blue-300 bg-white px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:bg-blue-900/30"
          >
            Reintentar
          </button>
        </div>
      )}
      <div className="vhead">
        <div className="title">
          <h1 className="text-gray-900 dark:text-white">{t('title')}</h1>
          <p>{t('subtitle')} <span className="text-xs text-brand/60 ml-2">({t('drag_hint')})</span></p>
          <div className="mt-2"><HistoryButton domain="dashboard_summary" title={t('title')} /></div>
        </div>
        
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            <div className="bg-sky-50 border border-sky-200 rounded-xl px-5 py-3 flex flex-col items-start sm:items-end shadow-sm w-full min-w-0">
                <span className="text-[10px] font-bold text-sky-700 uppercase tracking-widest mb-1">Costo Actual</span>
                <span className="text-2xl lg:text-3xl font-extrabold text-sky-600 w-full text-left sm:text-right truncate tabular-nums leading-tight">
                    {loading ? <span className="animate-pulse">…</span> : summaryFailed ? <span className="text-xl text-sky-400">—</span> : format(actualCost)}
                </span>
                <span className="text-[10px] text-sky-600 mt-1">acumulado del mes</span>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-xl px-5 py-3 flex flex-col items-start sm:items-end shadow-sm w-full min-w-0">
                <span className="text-[10px] font-bold text-purple-700 uppercase tracking-widest mb-1">Costo Proyectado</span>
                <span className="text-2xl lg:text-3xl font-extrabold text-purple-600 w-full text-left sm:text-right truncate tabular-nums leading-tight">
                    {loading ? <span className="animate-pulse">…</span> : summaryFailed ? <span className="text-xl text-purple-400">—</span> : format(projectedCost)}
                </span>
                <span className="text-[10px] text-purple-600 mt-1">al cierre de mes</span>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-3 flex flex-col items-start sm:items-end shadow-sm w-full min-w-0">
                <span className="text-[10px] font-bold text-green-700 uppercase tracking-widest mb-1">{t('potential_savings')}</span>
                <span className="text-2xl lg:text-3xl font-extrabold text-green-600 w-full text-left sm:text-right truncate tabular-nums leading-tight">
                    {loading ? <span className="animate-pulse">…</span> : summaryFailed ? <span className="text-xl text-green-400">—</span> : format(totalSavings)}
                </span>
                <span className="text-[10px] text-green-600 mt-1">{t('monthly_projected')}</span>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex flex-col items-start sm:items-end shadow-sm w-full min-w-0">
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1">Recursos Zombies</span>
                <span className="text-2xl lg:text-3xl font-extrabold text-amber-600 w-full text-left sm:text-right truncate tabular-nums leading-tight">
                    {loading ? <span className="animate-pulse">…</span> : summaryFailed ? <span className="text-xl text-amber-400">—</span> : zombieCount}
                </span>
                <span className="text-[10px] text-amber-600 mt-1">detectados</span>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex flex-col items-start sm:items-end shadow-sm w-full min-w-0">
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest mb-1 flex items-center">
                    <Leaf className="w-3 h-3 mr-1" /> {t('environmental_impact')}
                </span>
                <span className="text-2xl lg:text-3xl font-extrabold text-emerald-600 w-full text-left sm:text-right truncate tabular-nums leading-tight">
                    {loading ? <span className="animate-pulse">…</span> : summaryFailed ? <span className="text-xl text-emerald-400">—</span> : calculateCO2Savings(totalSavings)}
                </span>
                <span className="text-[10px] text-emerald-600 mt-1">{t('co2_avoided')}</span>
            </div>
        </div>
      </div>

      <div className="card mb-4">
          <div className="card-h flex items-center justify-between gap-3">
              <div>
                  <h3 className="m-0 text-[var(--brand-deep)]">Histograma de costos</h3>
                  <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">Distribución diaria del gasto (último mes por defecto, hasta 13 meses — límite de datos históricos de Azure Cost Management).</p>
              </div>
              <select
                  value={histogramMonths}
                  onChange={(e) => setHistogramMonths(Number(e.target.value))}
                  className="border rounded-md px-2 py-1 text-sm bg-white dark:bg-slate-900"
              >
                  <option value={1}>Último mes</option>
                  <option value={3}>Últimos 3 meses</option>
                  <option value={6}>Últimos 6 meses</option>
                  <option value={9}>Últimos 9 meses</option>
                  <option value={12}>Último año</option>
                  <option value={13}>Máximo (13 meses — límite de Azure)</option>
              </select>
          </div>
          <div className="p-[18px] h-[320px] min-w-0">
              {billingLoading ? (
                  <div className="h-full flex items-center justify-center text-gray-400 animate-pulse">Cargando histograma...</div>
              ) : filteredHistogramData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400 text-sm">Sin datos de costos para el período seleccionado.</div>
              ) : !chartsMounted ? (
                  <div className="h-full flex items-center justify-center text-gray-300 text-sm">Inicializando gráfico...</div>
              ) : (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                      <BarChart data={filteredHistogramData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis
                              dataKey="date"
                              tickFormatter={formatHistogramDate}
                              minTickGap={18}
                              tick={{ fontSize: 12 }}
                          />
                          <YAxis
                              tickFormatter={(v: number) => format(v, { compact: true })}
                              tick={{ fontSize: 12 }}
                          />
                          <RechartsTooltip
                              formatter={(value: any) => [format(Number(value || 0)), 'Costo']}
                              labelFormatter={(label: any) => `Fecha: ${formatHistogramDate(label)}`}
                          />
                          <Bar dataKey="cost" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                      </BarChart>
                  </ResponsiveContainer>
              )}
          </div>
      </div>
      
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={80}
        onLayoutChange={onLayoutChange}
        draggableHandle=".drag-handle"
      >
        <div key="exec">
            <div className="drag-handle cursor-move w-full h-full">
                <ExecutiveSummaryCard title={t('captured_savings')} amount={format(totalSavings)} trend={t('vs_last_month')} />
            </div>
        </div>
        
        <div key="pie">
            <FeatureGuard requiredTier="Professional" featureName="Análisis de Facturación" className="h-full drag-handle cursor-move w-full">
                <div className="card h-full flex flex-col overflow-hidden">
                     <div className="card-h shrink-0 border-b-0 pb-0">
                         <div className="flex flex-col">
                             <h3 className="m-0 text-[var(--brand-deep)]">{t('financial_leak_distribution')}</h3>
                             <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">{t('click_segment_hint')}</p>
                         </div>
                     </div>
                     <div className="p-[18px] flex-1 overflow-hidden flex flex-col">
                         {loading ? (
                             <div className="flex-1 flex items-center justify-center text-gray-400 animate-pulse">{t('calculating')}</div>
                         ) : (
                             <CostPieChart data={dashboardData} onSegmentClick={(cat) => setSelectedCategory(cat)} />
                         )}
                     </div>
                </div>
            </FeatureGuard>
        </div>

        <div key="gov">
            <FeatureGuard requiredTier="Business" featureName="Estado de Gobernanza" className="h-full drag-handle cursor-move w-full">
                <div className="card h-full flex flex-col overflow-hidden">
                 <div className="card-h shrink-0 border-b-0 pb-0">
                     <div className="flex flex-col">
                         <h3 className="m-0 text-[var(--brand-deep)]">{t('governance_state')}</h3>
                         <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">{t('based_on_rules')}</p>
                     </div>
                 </div>
                 <div className="p-[18px] flex-1 overflow-hidden flex flex-col">
                     <div className="flex-1 flex flex-col items-center justify-center text-gray-400 bg-[var(--surface-sunken)] rounded-lg border border-dashed border-gray-300">
                         <p className="text-sm font-medium">{t('financial_security_score')}</p>
                         <span className={`text-4xl font-bold mt-2 ${complianceScore === -1 ? 'text-gray-400' : 'text-green-500'}`}>
                             {complianceScore === null ? t('calculating') : complianceScore === -1 ? t('unconfigured') : `${complianceScore}%`}
                         </span>
                         <p className="text-xs text-gray-400 mt-2 text-center px-8">
                             {complianceScore === -1 ? t('no_rules') : t('based_on_rules')}
                         </p>
                         {complianceScore === -1 && (
                             <button 
                                 onClick={(e) => { e.stopPropagation(); setActiveTab('tags'); }}
                                 className="mt-4 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold rounded shadow-sm transition-colors"
                             >
                                 {t('configure_policies')}
                             </button>
                         )}
                     </div>
                 </div>
                </div>
            </FeatureGuard>
        </div>

        <div key="burn">
            <FeatureGuard requiredTier="Professional" featureName="Presupuestos" className="drag-handle cursor-move h-full w-full">
                <BudgetBurnChart onHeightChange={handleBudgetResize} />
            </FeatureGuard>
        </div>

        <div key="power">
            <FeatureGuard requiredTier="Business" featureName="Power Schedules" className="drag-handle cursor-move h-full w-full">
                <PowerSchedules />
            </FeatureGuard>
        </div>

        <div key="right">
            <FeatureGuard requiredTier="Professional" featureName="Rightsizing" className="drag-handle cursor-move h-full w-full">
                <RightsizingBlade />
            </FeatureGuard>
        </div>

        <div key="sandbox">
            <FeatureGuard requiredTier="Professional" featureName="Time-To-Live (TTL)" className="drag-handle cursor-move h-full w-full overflow-hidden">
                <ExpiredSandboxTable />
            </FeatureGuard>
        </div>

        <div key="ha">
            <FeatureGuard requiredTier="Business" featureName="Alta Disponibilidad" className="drag-handle cursor-move h-full w-full overflow-hidden">
                <HABreakdownCard />
            </FeatureGuard>
        </div>

        <div key="aks">
            <FeatureGuard requiredTier="Enterprise" featureName="AKS Chargeback" className="drag-handle cursor-move h-full w-full overflow-hidden">
                <AksChargebackCard />
            </FeatureGuard>
        </div>

        <div key="projection">
            <FeatureGuard requiredTier="Professional" featureName="Proyección de Gastos" className="drag-handle cursor-move h-full w-full overflow-hidden">
                <CostProjectionCard dailyHistory={billingHistogram} loading={billingLoading} />
            </FeatureGuard>
        </div>
      </ResponsiveGridLayout>

      {selectedCategory && (
          <div className="animate-in slide-in-from-bottom-4 duration-500 mt-4 card">
              <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-[var(--brand-deep)]">
                      Recursos Afectados: <span className="text-[var(--brand)]">{selectedCategory}</span>
                  </h3>
                  <button onClick={() => setSelectedCategory(null)} className="text-sm text-gray-500 hover:text-[var(--brand-deep)] transition-colors">
                      ✕ Limpiar Filtro
                  </button>
              </div>
              <ZombieResourcesTable forceFilterType={selectedCategory} />
          </div>
      )}
    </div>
  );
}
