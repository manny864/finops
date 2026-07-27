'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import Pagination, { usePagination } from '@/components/Pagination';

interface KPIs {
  signups_30d: number;
  trials_active: number;
  converted: number;
  conversion_pct: string;
  churn_pct: string;
}

interface FunnelStage {
  stage: string;
  count: number;
}

interface RecentSignup {
  tenant_id: string;
  email: string;
  plan?: string;
  status: string;
  trial_days_left: number;
  created_at: string;
}

interface FunnelData {
  kpis: KPIs;
  funnel: FunnelStage[];
  recent_signups: RecentSignup[];
}

export default function FunnelPage() {
  const t = useTranslations('SuperAdminFunnel');
  const locale = useLocale();
  const router = useRouter();
  const { instance, accounts } = useMsal();
  const [data, setData] = useState<FunnelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros de la tabla de signups recientes (server-side; el listado ya
  // viene acotado a los últimos 90 días desde la API).
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({ status: '', plan: '', q: '' });

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        if (accounts.length === 0) {
          router.push(`/${locale}/auth/login`);
          return;
        }
        const token = await getFreshIdToken(instance, accounts[0]);
        const params = new URLSearchParams();
        if (appliedFilters.status) params.set('status', appliedFilters.status);
        if (appliedFilters.plan) params.set('plan', appliedFilters.plan);
        if (appliedFilters.q) params.set('q', appliedFilters.q);

        const response = await fetch(`/api/superadmin/funnel?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.status === 401 || response.status === 403) {
          router.push(`/${locale}/auth/login`);
          return;
        }

        if (!response.ok) {
          throw new Error(t('errorFetchFailed'));
        }

        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorUnknown'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [locale, router, instance, accounts, t, appliedFilters]);

  const applyFilters = () => setAppliedFilters({ status: statusFilter, plan: planFilter, q: emailFilter });
  const clearFilters = () => {
    setStatusFilter('');
    setPlanFilter('');
    setEmailFilter('');
    setAppliedFilters({ status: '', plan: '', q: '' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-red-50 border border-red-200 rounded-lg text-red-700">
        <p className="font-semibold">{t('errorLoadingTitle')}</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <FunnelContent
      data={data}
      locale={locale}
      t={t}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      planFilter={planFilter}
      setPlanFilter={setPlanFilter}
      emailFilter={emailFilter}
      setEmailFilter={setEmailFilter}
      onApplyFilters={applyFilters}
      onClearFilters={clearFilters}
      isLoading={isLoading}
    />
  );
}

function FunnelContent({
  data,
  locale,
  t,
  statusFilter,
  setStatusFilter,
  planFilter,
  setPlanFilter,
  emailFilter,
  setEmailFilter,
  onApplyFilters,
  onClearFilters,
  isLoading,
}: {
  data: FunnelData;
  locale: string;
  t: (key: string) => string;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  planFilter: string;
  setPlanFilter: (v: string) => void;
  emailFilter: string;
  setEmailFilter: (v: string) => void;
  onApplyFilters: () => void;
  onClearFilters: () => void;
  isLoading: boolean;
}) {
  const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(data.recent_signups, 25);

  const stageLabels: Record<string, string> = {
    signup_started: t('stageSignupStarted'),
    trial_started: t('stageTrialStarted'),
    onboarding_completed: t('stageOnboardingCompleted'),
    converted_to_paid: t('stageConvertedToPaid'),
  };

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-4xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-600 mt-2">{t('subtitle')}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <KPICard label={t('kpiSignups30d')} value={data.kpis.signups_30d} suffix="" />
        <KPICard label={t('kpiActiveTrials')} value={data.kpis.trials_active} suffix="" />
        <KPICard label={t('kpiConverted')} value={data.kpis.converted} suffix="" />
        <KPICard
          label={t('kpiConversionRate')}
          value={parseFloat(data.kpis.conversion_pct)}
          suffix="%"
        />
        <KPICard
          label={t('kpiChurnRate')}
          value={parseFloat(data.kpis.churn_pct)}
          suffix="%"
          isNegative
        />
      </div>

      {/* Funnel Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">{t('funnelTitle')}</h2>
        <div className="space-y-4">
          {data.funnel.map((stage, idx) => {
            const maxCount = Math.max(...data.funnel.map(s => s.count), 1);
            const percentage = (stage.count / maxCount) * 100;
            const label = stageLabels[stage.stage] || stage.stage;

            return (
              <div key={idx}>
                <div className="flex justify-between mb-2">
                  <span className="font-semibold text-gray-700">{label}</span>
                  <span className="text-gray-600">{stage.count}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-8 overflow-hidden">
                  <div
                    className="bg-blue-600 h-full flex items-center justify-center text-white text-sm font-semibold transition-all"
                    style={{ width: `${percentage}%` }}
                  >
                    {percentage > 10 && `${Math.round(percentage)}%`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Signups Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-2xl font-bold text-gray-900">{t('recentSignupsTitle')}</h2>
            <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-3 py-1">
              Últimos 90 días
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3 mt-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
              <input
                type="text"
                value={emailFilter}
                onChange={(e) => setEmailFilter(e.target.value)}
                placeholder="Buscar por email"
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-56"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Estado</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">Todos</option>
                <option value="TRIAL">TRIAL</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="EXPIRED">EXPIRED</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Plan</label>
              <input
                type="text"
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                placeholder="Ej. Business"
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-40"
              />
            </div>
            <button
              onClick={onApplyFilters}
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-1.5"
            >
              Filtrar
            </button>
            <button
              onClick={onClearFilters}
              disabled={isLoading}
              className="text-gray-600 hover:text-gray-900 text-sm font-semibold px-2 py-1.5"
            >
              Limpiar
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {t('colEmail')}
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {t('colPlan')}
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {t('colStatus')}
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {t('colTrialDaysLeft')}
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {t('colSignupDate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.map((signup, idx) => (
                <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900 font-mono">{signup.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{signup.plan || '-'}</td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        signup.status === 'TRIAL'
                          ? 'bg-blue-100 text-blue-800'
                          : signup.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800'
                          : signup.status === 'EXPIRED'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {signup.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">{signup.trial_days_left}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {new Date(signup.created_at).toLocaleDateString(locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 pb-6">
          <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
        </div>
      </div>
    </div>
  );
}

interface KPICardProps {
  label: string;
  value: number;
  suffix: string;
  isNegative?: boolean;
}

function KPICard({ label, value, suffix, isNegative }: KPICardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <p className="text-sm text-gray-600 mb-2">{label}</p>
      <p className={`text-3xl font-bold ${isNegative ? 'text-red-600' : 'text-blue-600'}`}>
        {value.toFixed(suffix === '%' ? 2 : 0)}
        {suffix}
      </p>
    </div>
  );
}
