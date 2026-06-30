'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';

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
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<FunnelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/superadmin/funnel');
        
        if (response.status === 403) {
          router.push(`/${locale}/auth/login`);
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to fetch funnel data');
        }

        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [locale, router]);

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
        <p className="font-semibold">Error loading funnel data</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-4xl font-bold text-gray-900">
          {locale === 'en' ? 'Signup Funnel Analytics' : 'Análisis de Embudo de Inscripción'}
        </h1>
        <p className="text-gray-600 mt-2">
          {locale === 'en' ? 'Track signup conversion and trial metrics' : 'Rastrear la conversión de inscripciones y métricas de prueba'}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <KPICard
          label={locale === 'en' ? 'Signups (30d)' : 'Inscripciones (30d)'}
          value={data.kpis.signups_30d}
          suffix=""
        />
        <KPICard
          label={locale === 'en' ? 'Active Trials' : 'Pruebas Activas'}
          value={data.kpis.trials_active}
          suffix=""
        />
        <KPICard
          label={locale === 'en' ? 'Converted' : 'Convertido'}
          value={data.kpis.converted}
          suffix=""
        />
        <KPICard
          label={locale === 'en' ? 'Conversion Rate' : 'Tasa de Conversión'}
          value={parseFloat(data.kpis.conversion_pct)}
          suffix="%"
        />
        <KPICard
          label={locale === 'en' ? 'Churn Rate' : 'Tasa de Rotación'}
          value={parseFloat(data.kpis.churn_pct)}
          suffix="%"
          isNegative
        />
      </div>

      {/* Funnel Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          {locale === 'en' ? 'Conversion Funnel' : 'Embudo de Conversión'}
        </h2>
        <div className="space-y-4">
          {data.funnel.map((stage, idx) => {
            const maxCount = Math.max(...data.funnel.map(s => s.count), 1);
            const percentage = (stage.count / maxCount) * 100;
            const labels: Record<string, Record<string, string>> = {
              en: {
                'signup_started': 'Signups Started',
                'trial_started': 'Trial Started',
                'onboarding_completed': 'Onboarding Completed',
                'converted_to_paid': 'Converted to Paid',
              },
              es: {
                'signup_started': 'Inscripciones Iniciadas',
                'trial_started': 'Prueba Iniciada',
                'onboarding_completed': 'Incorporación Completada',
                'converted_to_paid': 'Convertido a Pagado',
              },
            };
            const label = labels[locale]?.[stage.stage] || stage.stage;

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
          <h2 className="text-2xl font-bold text-gray-900">
            {locale === 'en' ? 'Recent Signups' : 'Inscripciones Recientes'}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {locale === 'en' ? 'Email' : 'Correo Electrónico'}
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {locale === 'en' ? 'Plan' : 'Plan'}
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {locale === 'en' ? 'Status' : 'Estado'}
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {locale === 'en' ? 'Trial Days Left' : 'Días de Prueba Restantes'}
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {locale === 'en' ? 'Signup Date' : 'Fecha de Inscripción'}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.recent_signups.map((signup, idx) => (
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
