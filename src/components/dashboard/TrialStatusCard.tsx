'use client';

import { useTenant } from '@/components/TenantProvider';
import { useLocale } from 'next-intl';
import Link from 'next/link';

export default function TrialStatusCard() {
  const { selectedTenant } = useTenant();
  const locale = useLocale();

  if (!selectedTenant || selectedTenant.subscription_status !== 'TRIAL') {
    return null;
  }

  if (!selectedTenant.trial_ends_at) {
    return null;
  }

  const now = new Date();
  const endDate = new Date(selectedTenant.trial_ends_at);
  const diffTime = endDate.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-blue-900">
            {locale === 'en' ? 'Your Trial' : 'Tu Prueba'}
          </h3>
          <p className="text-blue-700 mt-1">
            {daysLeft === 1 ?
              (locale === 'en' ? '1 day remaining' : locale === 'es' ? '1 día restante' : '1 dia restante') :
              (locale === 'en' ? `${daysLeft} days remaining` : locale === 'es' ? `${daysLeft} días restantes` : `${daysLeft} dias restantes`)
            }
          </p>
          <p className="text-sm text-blue-600 mt-2">
            {locale === 'en' ? 'Upgrade anytime to continue using all features.' : 
             locale === 'es' ? 'Actualiza en cualquier momento para seguir usando todas las funciones.' : 
             'Atualize a qualquer momento para continuar usando todos os recursos.'}
          </p>
        </div>
        <Link
          href="/admin/billing"
          className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors whitespace-nowrap ml-4"
        >
          {locale === 'en' ? 'Upgrade' : locale === 'es' ? 'Actualizar' : 'Atualizar'}
        </Link>
      </div>
    </div>
  );
}
