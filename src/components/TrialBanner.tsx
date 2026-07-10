'use client';

import { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useLocale } from 'next-intl';
import Link from 'next/link';

interface TrialState {
  daysLeft: number | null;
  severity: 'info' | 'warning' | 'critical' | null;
  expired: boolean;
}

function getTrialState(status: string | null, trialEndsAt: string | null): TrialState {
  if (!status || !trialEndsAt) {
    return { daysLeft: null, severity: null, expired: false };
  }

  if (status === 'EXPIRED') {
    return { daysLeft: 0, severity: null, expired: true };
  }

  if (status !== 'TRIAL') {
    return { daysLeft: null, severity: null, expired: false };
  }

  const now = new Date();
  const endDate = new Date(trialEndsAt);
  const diffTime = endDate.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let severity: 'info' | 'warning' | 'critical' = 'info';
  if (daysLeft <= 2) {
    severity = 'critical';
  } else if (daysLeft <= 7) {
    severity = 'warning';
  }

  return { daysLeft: Math.max(0, daysLeft), severity, expired: false };
}

export default function TrialBanner() {
  const { selectedTenant } = useTenant();
  const locale = useLocale();
  const [trialState, setTrialState] = useState<TrialState>({ daysLeft: null, severity: null, expired: false });
  const [isDismissed, setIsDismissed] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    
    // Check if banner was dismissed today
    const dismissedAt = localStorage.getItem('trial-banner-dismissed');
    if (dismissedAt) {
      const now = Date.now();
      const dayInMs = 24 * 60 * 60 * 1000;
      if (now - parseInt(dismissedAt) < dayInMs) {
        setIsDismissed(true);
      } else {
        localStorage.removeItem('trial-banner-dismissed');
      }
    }
  }, []);

  useEffect(() => {
    if (selectedTenant) {
      const state = getTrialState(selectedTenant.subscription_status || null, selectedTenant.trial_ends_at || null);
      setTrialState(state);
    }
  }, [selectedTenant]);

  if (!isClient || !selectedTenant) {
    return null;
  }

  const { daysLeft, severity, expired } = trialState;

  // Cancelado pero todavía dentro del período pagado: no bloquea (eso lo
  // hace subscription_status=EXPIRED, vía /api/cron/subscription-expiry
  // una vez que access_until pasa), solo avisa la fecha de corte.
  if (selectedTenant.subscription_status === 'CANCELED' && selectedTenant.access_until) {
    const accessUntilDate = new Date(selectedTenant.access_until);
    if (accessUntilDate > new Date()) {
      const formatted = accessUntilDate.toLocaleDateString(locale === 'en' ? 'en-US' : locale === 'pt-BR' ? 'pt-BR' : 'es-AR');
      return (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 002 0V6zm0 6a1 1 0 10-2 0v2a1 1 0 102 0v-2z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-semibold text-amber-800">
                  {locale === 'en' ? 'Your subscription is canceled' : locale === 'es' ? 'Tu suscripción está cancelada' : 'Sua assinatura foi cancelada'}
                </p>
                <p className="text-sm text-amber-700">
                  {locale === 'en' ? `You'll keep access until ${formatted}.` :
                   locale === 'es' ? `Vas a mantener el acceso hasta el ${formatted}.` :
                   `Você manterá o acesso até ${formatted}.`}
                </p>
              </div>
            </div>
            <Link href="/admin/billing" className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 font-semibold text-sm">
              {locale === 'en' ? 'Reactivate' : locale === 'es' ? 'Reactivar' : 'Reativar'}
            </Link>
          </div>
        </div>
      );
    }
  }

  // Only show if TRIAL or EXPIRED
  if (!expired && selectedTenant.subscription_status !== 'TRIAL') {
    return null;
  }

  if (selectedTenant.subscription_status === 'PAST_DUE') {
    return (
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-yellow-800">
                {locale === 'en' ? 'Payment failed' : locale === 'es' ? 'Pago fallido' : 'Pagamento falhou'}
              </p>
              <p className="text-sm text-yellow-700">
                {locale === 'en' ? 'Update your payment method to keep your account active.' : 
                 locale === 'es' ? 'Actualiza tu método de pago para mantener tu cuenta activa.' : 
                 'Atualize seu método de pagamento para manter sua conta ativa.'}
              </p>
            </div>
          </div>
          <Link href="/admin/billing" className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 font-semibold text-sm">
            {locale === 'en' ? 'Update Payment' : locale === 'es' ? 'Actualizar Pago' : 'Atualizar Pagamento'}
          </Link>
        </div>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="bg-red-50 border-l-4 border-red-400 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-red-800">
                {selectedTenant.trial_ends_at
                  ? (locale === 'en' ? 'Your trial has expired' : locale === 'es' ? 'Tu prueba ha expirado' : 'Seu julgamento expirou')
                  : (locale === 'en' ? 'Your subscription access has ended' : locale === 'es' ? 'Tu acceso por suscripción finalizó' : 'Seu acesso por assinatura terminou')}
              </p>
              <p className="text-sm text-red-700">
                {locale === 'en' ? 'Upgrade to restore access to your account.' :
                 locale === 'es' ? 'Actualiza para restaurar el acceso a tu cuenta.' :
                 'Atualize para restaurar o acesso à sua conta.'}
              </p>
            </div>
          </div>
          <Link href="/pricing" className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-semibold text-sm">
            {locale === 'en' ? 'Upgrade Now' : locale === 'es' ? 'Actualizar Ahora' : 'Atualizar Agora'}
          </Link>
        </div>
      </div>
    );
  }

  if (isDismissed) {
    return null;
  }

  const bgColor =
    severity === 'critical' ? 'bg-red-50 border-l-4 border-red-400' :
    severity === 'warning' ? 'bg-yellow-50 border-l-4 border-yellow-400' :
    'bg-blue-50 border-l-4 border-blue-400';

  const iconColor =
    severity === 'critical' ? 'text-red-600' :
    severity === 'warning' ? 'text-yellow-600' :
    'text-blue-600';

  const buttonColor =
    severity === 'critical' ? 'bg-red-600 hover:bg-red-700' :
    severity === 'warning' ? 'bg-yellow-600 hover:bg-yellow-700' :
    'bg-blue-600 hover:bg-blue-700';

  return (
    <div className={`p-4 ${bgColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg className={`w-6 h-6 ${iconColor}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 002 0V6zm0 6a1 1 0 10-2 0v2a1 1 0 102 0v-2z" clipRule="evenodd" />
          </svg>
          <div>
            <p className={`font-semibold ${severity === 'critical' ? 'text-red-800' : severity === 'warning' ? 'text-yellow-800' : 'text-blue-800'}`}>
              {daysLeft === 1 ? 
                (locale === 'en' ? '1 day left' : locale === 'es' ? '1 día restante' : '1 dia restante') :
                (locale === 'en' ? `${daysLeft} days left in your trial` : locale === 'es' ? `${daysLeft} días restantes en tu prueba` : `${daysLeft} dias restantes em seu julgamento`)
              }
            </p>
            <p className={`text-sm ${severity === 'critical' ? 'text-red-700' : severity === 'warning' ? 'text-yellow-700' : 'text-blue-700'}`}>
              {locale === 'en' ? 'Upgrade now to keep your data and analytics.' : 
               locale === 'es' ? 'Actualiza ahora para mantener tus datos y análisis.' : 
               'Atualize agora para manter seus dados e análises.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/billing" className={`px-4 py-2 ${buttonColor} text-white rounded font-semibold text-sm`}>
            {locale === 'en' ? 'Upgrade Now' : locale === 'es' ? 'Actualizar Ahora' : 'Atualizar Agora'}
          </Link>
          <button
            onClick={() => {
              setIsDismissed(true);
              localStorage.setItem('trial-banner-dismissed', Date.now().toString());
            }}
            className="p-2 text-gray-500 hover:text-gray-700 rounded"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
