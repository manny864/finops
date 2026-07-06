"use client";
import React, { useState, useEffect, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { initializePaddle, Paddle } from '@paddle/paddle-js';
import EnterpriseLeadModal from './EnterpriseLeadModal';
import LanguageSwitcher from './LanguageSwitcher';

interface PricingPageProps {
  onLoginClick?: () => void;
  tenantId?: string;
  hideLogin?: boolean;
}

export default function PricingPage({ onLoginClick, tenantId, hideLogin }: PricingPageProps) {
  const { instance, accounts } = useMsal();
  const router = useRouter();
  const [isAnnual, setIsAnnual] = useState(false);
  const [paddle, setPaddle] = useState<Paddle>();
  const [isEnterpriseModalOpen, setEnterpriseModalOpen] = useState(false);
  const [pendingCheckoutPriceId, setPendingCheckoutPriceId] = useState<string | undefined>(undefined);
  const t = useTranslations('pricing');

  // Email corporativo del usuario ya logueado con MSAL (viene de preferred_username /
  // UPN del tenant Azure AD). Para cuando se llega al checkout, el login/onboarding
  // (ver AuthProvider.tsx) ya ocurrió, así que este es el email que debe quedar
  // asociado a la cuenta admin en Paddle — evitamos que el usuario tipee otro.
  const corporateEmail = accounts?.[0]?.username;

  const goToDemo = (tier: 'essential' | 'pro' | 'business' | 'enterprise') => {
    // Lead-capture modal and demo session are handled inside /demo
    router.push({ pathname: '/demo', query: { tier } });
  };

  const instanceRef = useRef(instance);
  const onLoginClickRef = useRef(onLoginClick);

  useEffect(() => {
    instanceRef.current = instance;
    onLoginClickRef.current = onLoginClick;
  }, [instance, onLoginClick]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN || '';
    if (!token) {
      console.warn("Paddle client token is missing. Billing features will not work.");
      return;
    }
    const env = token.startsWith('test_') ? 'sandbox' : 'production';
    initializePaddle({ 
      environment: env, 
      token,
      eventCallback: (data) => {
        if (data.name === 'checkout.completed') {
          sessionStorage.setItem('pendingUpgrade', 'paid');
          if (onLoginClickRef.current) {
            onLoginClickRef.current();
          } else {
            instanceRef.current.loginRedirect({ scopes: ["User.Read", "Directory.Read.All"] }).catch(e => console.error(e));
          }
        }
      }
    }).then(setPaddle);
  }, []);

  const handleSignUp = (plan: string) => {
    sessionStorage.setItem('pendingUpgrade', plan);
    if (onLoginClick) {
      onLoginClick();
    } else {
      instance.loginRedirect({ scopes: ["User.Read", "Directory.Read.All"] }).catch(e => console.error(e));
    }
  };

  const getPriceId = (plan: string) => {
    if (plan === 'Essential') {
        return isAnnual ? process.env.NEXT_PUBLIC_PADDLE_ESSENTIAL_YEARLY : process.env.NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY;
    } else if (plan === 'pro') {
        return isAnnual ? process.env.NEXT_PUBLIC_PADDLE_PRO_YEARLY : process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY;
    } else if (plan === 'business') {
        return isAnnual ? process.env.NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY : process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY;
    }
    return undefined;
  };

  const openCheckout = (priceId?: string) => {
    if (!paddle) {
      alert("El sistema de pagos no está inicializado. Verifica la configuración de Paddle en el entorno.");
      return;
    }
    if (!priceId) {
      alert("Falta el ID del plan en la configuración. Verifica las variables NEXT_PUBLIC_PADDLE_ en el entorno.");
      return;
    }
    // Antes de abrir el checkout de Paddle, confirmamos con el usuario que va a
    // pagar con su correo corporativo (esa cuenta queda como admin del tenant).
    // Si ya conocemos el email (login MSAL previo), se lo prellenamos en Paddle.
    setPendingCheckoutPriceId(priceId);
  };

  const confirmCheckout = () => {
    if (!paddle || !pendingCheckoutPriceId) return;
    const customData = tenantId ? { tenant_id: tenantId } : undefined;
    paddle.Checkout.open({
      items: [{ priceId: pendingCheckoutPriceId, quantity: 1 }],
      customData,
      customer: corporateEmail ? { email: corporateEmail } : undefined,
    });
    setPendingCheckoutPriceId(undefined);
  };

  const getPrice = (monthly: number) => {
    if (!isAnnual) return `${monthly}`;
    return `${(monthly * 0.88).toFixed(2)}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans py-16 px-4 sm:px-6 lg:px-8">
      {/* Top Right: Language switcher + Login link */}
      <div className="absolute top-6 right-8 flex items-center gap-3 z-10">
        <LanguageSwitcher />
        {!hideLogin && (
          <>
            <span className="text-sm font-medium text-gray-500">Already have an account?</span>
            <button
              onClick={() => handleSignUp('Essential')}
              className="text-brand-deep font-bold hover:underline"
            >
              Log in
            </button>
          </>
        )}
      </div>

      <div className="max-w-7xl mx-auto text-center mt-8 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h2 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight font-heading">
          {t('title')}
        </h2>
        <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
          {t('subtitle')}
        </p>
      </div>

      {/* Toggle */}
      <div className="flex justify-center items-center mb-16">
        <span className={`text-sm font-medium ${!isAnnual ? 'text-gray-900' : 'text-gray-500'}`}>{t('monthly')}</span>
        <button 
          onClick={() => setIsAnnual(!isAnnual)}
          className="mx-4 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-deep focus:ring-offset-2"
          style={{ backgroundColor: isAnnual ? '#0054A6' : '#D1D5DB' }}
        >
          <span 
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAnnual ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
        <span className={`text-sm font-medium flex items-center ${isAnnual ? 'text-gray-900' : 'text-gray-500'}`}>
          {t('annual')}
          <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
            {t('save12')}
          </span>
        </span>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in zoom-in-95 duration-700 delay-150">
        {/* Essential */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col hover:shadow-md transition-shadow">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">{t('essential.name')}</h3>
            <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded">
              {t('pro.trial')}
            </span>
          </div>
          <div className="mb-6">
            <div className="mt-4 flex items-baseline text-5xl font-extrabold text-gray-900">
              ${getPrice(19.99)}
              <span className="text-lg font-medium text-gray-500 ml-1">{t('perMonth')}</span>
            </div>
            {isAnnual && (
              <div className="text-sm text-gray-500 line-through mt-1">$19.99{t('perMonth')}</div>
            )}
          </div>
          
          <div className="flex flex-col space-y-3 mb-6">
            <button 
              onClick={() => goToDemo('essential')}
              className="w-full bg-white border-2 border-gray-800 text-gray-800 rounded-lg py-3 px-4 font-bold hover:bg-gray-50 transition-colors shadow-sm"
            >
              {t('tryNow')}
            </button>
            <button 
              onClick={() => handleSignUp('Essential')}
              className="w-full bg-gray-800 text-white rounded-lg py-3 px-4 font-semibold hover:bg-gray-900 transition-colors shadow-md text-center inline-block"
            >
              {t('buyNow')}
            </button>
          </div>
          
          <p className="text-sm text-gray-500 mb-8 text-justify">
            {t('essential.desc')}
          </p>
          
          <PlanFeatures
            features={t.raw('essential.features') as string[]}
            showLabel={t('showFeatures', {count: (t.raw('essential.features') as string[]).length})}
            hideLabel={t('hideFeatures')}
          />
          <div className="flex-1" />
        </div>

        {/* Professional */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col hover:shadow-md transition-shadow">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-xl font-bold text-gray-900">{t('pro.name')}</h3>
            <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded">
              {t('pro.trial')}
            </span>
          </div>
          <div className="mb-6">
            <div className="flex items-baseline text-5xl font-extrabold text-gray-900">
              ${getPrice(99.99)}
              <span className="text-lg font-medium text-gray-500 ml-1">{t('perMonth')}</span>
            </div>
            {isAnnual && (
              <div className="text-sm text-gray-500 line-through mt-1">$99.99{t('perMonth')}</div>
            )}
          </div>
          
          <div className="flex flex-col space-y-3 mb-6">
            <button 
              onClick={() => goToDemo('pro')}
              className="w-full bg-white border-2 border-brand-deep text-brand-deep rounded-lg py-3 px-4 font-bold hover:bg-gray-50 transition-colors shadow-sm"
            >
              {t('tryNow')}
            </button>
            <button 
              onClick={() => openCheckout(getPriceId('pro'))}
              className="w-full bg-gradient-to-r from-brand-deep to-[#1E88E5] text-white rounded-lg py-3 px-4 font-semibold hover:brightness-110 transition-colors shadow-md text-center inline-block"
            >
              {t('buyNow')}
            </button>
          </div>
          
          <p className="text-sm text-gray-500 mb-8 text-justify">
            {t('pro.desc')}
          </p>
          
          <PlanFeatures
            features={t.raw('pro.features') as string[]}
            showLabel={t('showFeatures', {count: (t.raw('pro.features') as string[]).length})}
            hideLabel={t('hideFeatures')}
          />
          <div className="flex-1" />
        </div>

        {/* Business */}
        <div className="bg-white rounded-2xl shadow-xl border-2 border-brand-deep p-8 flex flex-col hover:shadow-xl transition-shadow relative transform md:-translate-y-4">
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <span className="bg-brand-deep text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide shadow-md">
              {t('business.badge')}
            </span>
          </div>
          <div className="mb-6 flex items-center justify-between mt-2">
            <h3 className="text-xl font-bold text-brand-deep">{t('business.name')}</h3>
          </div>
          <div className="mb-6">
            <div className="flex items-baseline text-5xl font-extrabold text-gray-900">
              ${getPrice(299.99)}
              <span className="text-lg font-medium text-gray-500 ml-1">{t('perMonth')}</span>
            </div>
            {isAnnual && (
              <div className="text-sm text-gray-500 line-through mt-1">$299.99{t('perMonth')}</div>
            )}
          </div>
          
          <div className="flex flex-col space-y-3 mb-6">
            <button 
              onClick={() => goToDemo('business')}
              className="w-full bg-white border-2 border-gray-800 text-gray-800 rounded-lg py-3 px-4 font-bold hover:bg-gray-50 transition-colors shadow-sm"
            >
              {t('tryNow')}
            </button>
            <button 
              onClick={() => openCheckout(getPriceId('business'))}
              className="w-full bg-gradient-to-r from-brand-deep to-[#1E88E5] text-white rounded-lg py-3 px-4 font-semibold hover:brightness-110 transition-colors shadow-md text-center inline-block"
            >
              {t('buyNow')}
            </button>
          </div>
          
          <p className="text-sm text-gray-500 mb-8 text-justify">
            {t('business.desc')}
          </p>
          
          <PlanFeatures
            features={t.raw('business.features') as string[]}
            showLabel={t('showFeatures', {count: (t.raw('business.features') as string[]).length})}
            hideLabel={t('hideFeatures')}
          />
          <div className="flex-1" />
        </div>

        {/* Enterprise */}
        <div className="bg-gray-900 rounded-2xl shadow-lg border border-gray-700 p-8 flex flex-col hover:shadow-xl transition-shadow relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-8 -mt-8 w-24 h-24 bg-brand-deep rounded-full opacity-20 blur-xl"></div>
          
          <div className="mb-6 flex items-center justify-between relative z-10">
            <h3 className="text-lg font-medium text-white">{t('enterprise.name')}</h3>
            <span className="bg-brand-bright/20 text-brand-bright text-xs font-semibold px-2 py-1 rounded">{t('enterprise.badge')}</span>
          </div>
          <div className="mb-6 relative z-10">
            <div className="flex items-baseline text-4xl font-extrabold text-white mt-2 mb-2">
              {t('customPrice')}
            </div>
          </div>
          
          <button 
            onClick={() => setEnterpriseModalOpen(true)}
            className="w-full bg-white text-gray-900 rounded-lg py-3 px-4 font-bold hover:bg-gray-100 transition-colors shadow-sm relative z-10 text-center flex justify-center items-center"
          >
            {t('contactSales')}
          </button>
          <button
            onClick={() => goToDemo('enterprise')}
            className="w-full mt-3 mb-6 bg-transparent border border-white/30 text-white rounded-lg py-3 px-4 font-bold hover:bg-white/10 transition-colors relative z-10 text-center"
          >
            {t('tryNow')}
          </button>
          
          <p className="text-sm text-gray-300 mb-8 relative z-10 text-justify">
            {t('enterprise.desc')}
          </p>
          
          <div className="relative z-10">
            <PlanFeatures
              features={t.raw('enterprise.features') as string[]}
              showLabel={t('showFeatures', {count: (t.raw('enterprise.features') as string[]).length})}
              hideLabel={t('hideFeatures')}
              dark
            />
          </div>
          <div className="flex-1" />
        </div>

      </div>
      <EnterpriseLeadModal isOpen={isEnterpriseModalOpen} onClose={() => setEnterpriseModalOpen(false)} />
      <CorporateEmailNoticeModal
        open={!!pendingCheckoutPriceId}
        email={corporateEmail}
        onCancel={() => setPendingCheckoutPriceId(undefined)}
        onConfirm={confirmCheckout}
        t={t}
      />
    </div>
  );
}

interface CorporateEmailNoticeModalProps {
  open: boolean;
  email?: string;
  onCancel: () => void;
  onConfirm: () => void;
  t: ReturnType<typeof useTranslations>;
}

// Aviso previo al checkout de Paddle: el correo que se use ahí queda como la
// cuenta admin del tenant que se está registrando, así que debe ser el
// corporativo (el mismo con el que se logueó), no uno personal.
function CorporateEmailNoticeModal({ open, email, onCancel, onConfirm, t }: CorporateEmailNoticeModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
          {t('corporateEmailNotice.title')}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 text-justify">
          {t('corporateEmailNotice.body')}
        </p>
        {email && (
          <div className="mt-4 rounded-lg bg-brand-soft dark:bg-slate-800 border border-brand-bright/20 dark:border-slate-700 px-4 py-3">
            <p className="text-xs font-bold text-grey uppercase tracking-wide">{t('corporateEmailNotice.willUse')}</p>
            <p className="text-sm font-semibold text-ink dark:text-white mt-1">{email}</p>
          </div>
        )}
        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 px-4 py-2 font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800"
          >
            {t('corporateEmailNotice.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-brand-deep text-white px-4 py-2 font-semibold hover:brightness-110"
          >
            {t('corporateEmailNotice.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * Lista de funciones del plan contraída por defecto (móvil y escritorio):
 * un toggle "Ver funciones (N)" expande la lista completa inline.
 */
function PlanFeatures({ features, showLabel, hideLabel, dark = false }: { features: string[]; showLabel: string; hideLabel: string; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`w-full flex items-center justify-between py-2.5 px-3 rounded-lg border text-sm font-semibold transition-colors cursor-pointer ${dark ? 'border-white/25 text-white hover:bg-white/10' : 'border-gray-200 text-gray-800 hover:bg-gray-50'}`}
      >
        {open ? hideLabel : showLabel}
        <svg className={`w-4 h-4 transition-transform ${dark ? 'text-gray-300' : 'text-gray-500'} ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <ul className={`space-y-3 text-sm mt-4 ${dark ? 'text-gray-300' : 'text-gray-600'}`}>
          {features.map((feature, idx) => (
            <li key={idx} className={`flex items-start font-medium ${dark ? 'text-white' : 'text-gray-900'}`}>
              <svg className={`w-5 h-5 mr-2 flex-shrink-0 ${dark ? 'text-brand-bright' : 'text-blue-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {feature}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

