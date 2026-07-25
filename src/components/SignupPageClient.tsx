'use client';

import React, { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import LocalSignupForm from './LocalSignupForm';

interface PlanProps {
  id: string;
  name: string;
  price: string;
  monthlyPrice: string;
  yearlyPrice: string;
  description: string;
  features: string[];
  cta: string;
  recommended?: boolean;
}

export default function SignupPageClient() {
  const { instance } = useMsal();
  const t = useTranslations('signup');
  const locale = useLocale();
  const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);
  // Proveedor elegido en el alta. Azure entra por MSAL; AWS no puede (no hay
  // IdP corporativo equivalente a Entra), asi que abre el alta local.
  const [provider, setProvider] = useState<'azure' | 'aws'>('azure');
  const [awsSignupPlan, setAwsSignupPlan] = useState<string | null>(null);
  const tp = useTranslations('provider');

  const plans: PlanProps[] = [
    {
      id: 'essential',
      name: t('essential.name'),
      price: t('essential.price'),
      monthlyPrice: t('essential.monthlyPrice'),
      yearlyPrice: t('essential.yearlyPrice'),
      description: t('essential.description'),
      features: [
        t('essential.features.0'),
        t('essential.features.1'),
        t('essential.features.2'),
        t('essential.features.3'),
        t('essential.features.4'),
      ],
      cta: t('essential.cta'),
    },
    {
      id: 'professional',
      name: t('professional.name'),
      price: t('professional.price'),
      monthlyPrice: t('professional.monthlyPrice'),
      yearlyPrice: t('professional.yearlyPrice'),
      description: t('professional.description'),
      features: [
        t('professional.features.0'),
        t('professional.features.1'),
        t('professional.features.2'),
        t('professional.features.3'),
        t('professional.features.4'),
      ],
      cta: t('professional.cta'),
      recommended: true,
    },
    {
      id: 'business',
      name: t('business.name'),
      price: t('business.price'),
      monthlyPrice: t('business.monthlyPrice'),
      yearlyPrice: t('business.yearlyPrice'),
      description: t('business.description'),
      features: [
        t('business.features.0'),
        t('business.features.1'),
        t('business.features.2'),
        t('business.features.3'),
        t('business.features.4'),
      ],
      cta: t('business.cta'),
    },
    {
      id: 'enterprise',
      name: t('enterprise.name'),
      description: t('enterprise.description'),
      price: 'Custom',
      monthlyPrice: 'Custom',
      yearlyPrice: 'Custom',
      features: [
        t('enterprise.features.0'),
        t('enterprise.features.1'),
        t('enterprise.features.2'),
        t('enterprise.features.3'),
        t('enterprise.features.4'),
      ],
      cta: t('enterprise.cta'),
    },
  ];

  const handleSignUp = (planId: string) => {
    if (provider === 'aws') {
      // No hay redirect posible: el alta AWS es email+contrasena y se resuelve
      // en la misma tarjeta del plan elegido.
      setAwsSignupPlan(planId);
      return;
    }
    sessionStorage.setItem('pendingUpgrade', planId);
    instance.loginRedirect({ scopes: ["User.Read", "Directory.Read.All"] }).catch(e => console.error(e));
  };

  const handleContactSales = () => {
    window.location.href = 'mailto:ventas@cscloudsolutions.com.ar?subject=Enterprise%20Plan%20Inquiry';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Header */}
      <header className="border-b bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-blue-600">
            FinOps
          </Link>
          <nav className="flex gap-6 items-center">
            <Link href="/pricing" className="text-gray-600 hover:text-gray-900">
              {t('planSelector')}
            </Link>
            <a href="#faq" className="text-gray-600 hover:text-gray-900">
              {t('faq.title')}
            </a>
            <Link href="/" className="px-4 py-2 text-gray-600 hover:text-gray-900">
              {locale === 'en' ? 'Sign In' : locale === 'es' ? 'Iniciar Sesión' : 'Fazer Login'}
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 px-4 text-center">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            {t('hero')}
          </h1>
          <p className="text-xl text-gray-600 mb-2">{t('subtitle')}</p>
          <p className="text-lg text-blue-600 font-semibold mb-8">{t('noCardRequired')}</p>
        </div>
      </section>

      {/* Plan Cards */}
      <section className="py-16 px-4">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-6">{t('planSelector')}</h2>

          {/* Selector de proveedor. Los precios y los planes son identicos para
              los dos: lo unico que cambia es como se crea la cuenta y que datos
              se recolectan despues. */}
          <div className="flex flex-col items-center mb-10">
            <p className="text-sm font-semibold text-gray-700 mb-3">{tp('signupTitle')}</p>
            <div role="radiogroup" aria-label={tp('signupTitle')} className="inline-flex rounded-lg border border-gray-300 bg-white p-1">
              {(['azure', 'aws'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={provider === p}
                  onClick={() => { setProvider(p); setAwsSignupPlan(null); }}
                  className={`px-5 py-2 text-sm font-semibold rounded-md transition-colors ${
                    provider === p ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {p === 'azure' ? tp('signupAzure') : tp('signupAws')}
                </button>
              ))}
            </div>
            <p className="mt-3 max-w-xl text-center text-xs text-gray-500">
              {provider === 'azure' ? tp('signupAzureHint') : tp('signupAwsHint')}
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-lg border-2 transition-all duration-300 overflow-hidden ${
                  plan.recommended
                    ? 'border-blue-500 shadow-xl scale-105 bg-white'
                    : 'border-gray-200 shadow-md hover:shadow-lg bg-white'
                } ${hoveredPlan === plan.id ? 'shadow-xl' : ''}`}
                onMouseEnter={() => setHoveredPlan(plan.id)}
                onMouseLeave={() => setHoveredPlan(null)}
              >
                {plan.recommended && (
                  <div className="bg-blue-500 text-white text-center py-2 text-sm font-semibold">
                    {locale === 'en' ? 'RECOMMENDED' : locale === 'es' ? 'RECOMENDADO' : 'RECOMENDADO'}
                  </div>
                )}

                <div className="p-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                  <p className="text-sm text-gray-600 mb-4">{plan.description}</p>

                  {plan.id !== 'enterprise' ? (
                    <div className="mb-6">
                      <div className="text-4xl font-bold text-gray-900">{plan.price}</div>
                      <div className="text-sm text-gray-500">{plan.monthlyPrice}</div>
                    </div>
                  ) : (
                    <div className="mb-6">
                      <div className="text-2xl font-bold text-gray-900">Custom Pricing</div>
                    </div>
                  )}

                  {/* CTA Button */}
                  {plan.id === 'enterprise' ? (
                    <button
                      onClick={handleContactSales}
                      className="w-full py-3 px-4 bg-gray-200 text-gray-900 font-semibold rounded-lg hover:bg-gray-300 transition-colors mb-6"
                    >
                      {plan.cta}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSignUp(plan.id)}
                      className={`w-full py-3 px-4 font-semibold rounded-lg transition-colors mb-6 ${
                        plan.recommended
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                      }`}
                    >
                      {plan.cta}
                    </button>
                  )}

                  {awsSignupPlan === plan.id && (
                    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
                      <LocalSignupForm plan={plan.id} onCancel={() => setAwsSignupPlan(null)} />
                    </div>
                  )}

                  {/* Features */}
                  <div className="space-y-3">
                    {plan.features.slice(0, 5).map((feature, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <svg
                          className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="text-sm text-gray-700">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Signals */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-7xl mx-auto text-center">
          <h3 className="text-2xl font-bold text-gray-900 mb-8">{t('trustSignals')}</h3>
          <div className="flex justify-center gap-8 flex-wrap">
            {[t('badges.0'), t('badges.1'), t('badges.2')].map((badge, idx) => (
              <div key={idx} className="flex items-center gap-2 text-gray-600">
                <svg className="w-6 h-6 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                </svg>
                <span className="font-semibold">{badge}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">{t('faq.title')}</h2>
          
          <div className="space-y-6">
            {[
              { q: 'q1', a: 'a1' },
              { q: 'q2', a: 'a2' },
              { q: 'q3', a: 'a3' },
              { q: 'q4', a: 'a4' },
            ].map((item, idx) => (
              <details
                key={idx}
                className="border border-gray-300 rounded-lg p-6 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <summary className="font-semibold text-gray-900 cursor-pointer">
                  {t(`faq.${item.q}`)}
                </summary>
                <p className="text-gray-600 mt-4">{t(`faq.${item.a}`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12 px-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <p className="text-sm text-gray-400">© 2026 CSCloudSolutions. All rights reserved.</p>
          </div>
          <div className="flex gap-6">
            <Link href="/pricing" className="text-gray-400 hover:text-white text-sm">
              {t('planSelector')}
            </Link>
            <a href="#" className="text-gray-400 hover:text-white text-sm">
              {locale === 'en' ? 'Privacy' : locale === 'es' ? 'Privacidad' : 'Privacidade'}
            </a>
            <a href="#" className="text-gray-400 hover:text-white text-sm">
              {locale === 'en' ? 'Terms' : locale === 'es' ? 'Términos' : 'Termos'}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
