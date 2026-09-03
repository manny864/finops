"use client";
import React, { useState, useEffect, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { initializePaddle, Paddle } from '@paddle/paddle-js';
import EnterpriseLeadModal from './EnterpriseLeadModal';
import { TIER_BASE_PRICE_USD, getAnnualMonthlyEquivalent, getAnnualDiscountPercent } from '@/lib/pricing';
import DemoLeadModal from './DemoLeadModal';
import LanguageSwitcher from './LanguageSwitcher';

interface PricingPageProps {
  onLoginClick?: () => void;
  tenantId?: string;
  hideLogin?: boolean;
}

type DemoTier = 'pro' | 'business' | 'enterprise';

export default function PricingPage({ onLoginClick, tenantId, hideLogin }: PricingPageProps) {
  const { instance, accounts } = useMsal();
  const router = useRouter();
  const [isAnnual, setIsAnnual] = useState(false);
  const [paddle, setPaddle] = useState<Paddle>();
  const [isEnterpriseModalOpen, setEnterpriseModalOpen] = useState(false);
  const [pendingCheckoutPriceId, setPendingCheckoutPriceId] = useState<string | undefined>(undefined);
  // Precios leídos de Paddle vía /api/pricing/plans. null hasta que responda y
  // si falla: `getPrice` cae al catálogo de `pricing.ts` en ese caso.
  const [remotePrices, setRemotePrices] = useState<Record<string, { monthly: number | null; annual: number | null }> | null>(null);
  // Gate de leads para "Demo Interactiva": si el visitante todavía no completó
  // el formulario de datos, se abre acá mismo (en la página de precios) y solo
  // tras enviarlo se navega a /demo. Guarda el tier elegido mientras tanto.
  const [pendingDemoTier, setPendingDemoTier] = useState<DemoTier | null>(null);
  const t = useTranslations('pricing');
  const tf = useTranslations('Footer');
  const locale = useLocale();

  // Email corporativo del usuario ya logueado con MSAL (viene de preferred_username /
  // UPN del tenant Azure AD). Para cuando se llega al checkout, el login/onboarding
  // (ver AuthProvider.tsx) ya ocurrió, así que este es el email que debe quedar
  // asociado a la cuenta admin en Paddle — evitamos que el usuario tipee otro.
  const corporateEmail = accounts?.[0]?.username;

  const goToDemo = (tier: DemoTier) => {
    // Mismo flag que usa /demo: si ya completó el formulario alguna vez, pasa
    // directo; si no, el modal se muestra ANTES de salir de la página de precios.
    const hasCompleted = typeof window !== 'undefined' && localStorage.getItem('hasCompletedDemoLead');
    if (!hasCompleted) {
      setPendingDemoTier(tier);
      return;
    }
    router.push({ pathname: '/demo', query: { tier } });
  };

  const handleDemoLeadSuccess = () => {
    localStorage.setItem('hasCompletedDemoLead', 'true');
    const tier = pendingDemoTier;
    setPendingDemoTier(null);
    if (tier) router.push({ pathname: '/demo', query: { tier } });
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

  useEffect(() => {
    let cancelado = false;
    fetch('/api/pricing/plans')
      .then((r) => r.json())
      .then((j) => { if (!cancelado && j?.success && j.plans) setRemotePrices(j.plans); })
      .catch(() => { /* queda el catálogo */ });
    return () => { cancelado = true; };
  }, []);

  const getPriceId = (plan: string) => {
    if (plan === 'pro') {
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

  /**
   * El precio que se muestra lo LEE de Paddle, que es quien cobra.
   *
   * Antes era `monthly * 0.88` con el mensual escrito a mano en el JSX. Daba el
   * número correcto, pero por coincidencia del redondeo: Paddle cobra 3167.88
   * al año y `299.99 * 0.88` redondeado a dos decimales da justo 263.99, cuyo
   * ×12 es 3167.88. Nada ataba las dos cosas: cambiar un precio en Paddle
   * dejaba la página mostrando el viejo, y el cliente veía un número y le
   * cobraban otro a un click de distancia.
   *
   * `remotePrices` puede ser null en el primer render y si la ruta falla; el
   * catálogo de `pricing.ts` queda como fallback. Una página de precios en
   * blanco es peor que una con un número de hace un rato.
   */
  const getPrice = (tier: 'Professional' | 'Business') => {
    const remoto = remotePrices?.[tier];
    const mensual = remoto?.monthly ?? TIER_BASE_PRICE_USD[tier]!;
    if (!isAnnual) return mensual.toFixed(2);
    // El anual de Paddle es el TOTAL del año; lo que se muestra al lado del
    // mensual es su doceavo.
    const anual = remoto?.annual;
    if (anual != null) return (anual / 12).toFixed(2);
    return (getAnnualMonthlyEquivalent(tier) ?? mensual).toFixed(2);
  };

  /** El descuento sale de los precios que se están mostrando, no de una constante. */
  const descuentoAnual = (() => {
    const remoto = remotePrices?.Professional;
    if (remoto?.monthly && remoto?.annual) {
      return Math.round((1 - remoto.annual / (remoto.monthly * 12)) * 100);
    }
    return getAnnualDiscountPercent('Professional') ?? 12;
  })();

  return (
    <div className="relative overflow-hidden min-h-screen bg-[#0E1A2B] flex flex-col font-sans py-16 px-4 sm:px-6 lg:px-8">
      {/* Fondo: Video interactivo con superposición corporativa y orbes de luz */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden z-0">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-30 scale-105 filter contrast-110 saturate-105"
        >
          <source src="/videos/CSCS-Interactivo.mp4" type="video/mp4" />
        </video>
        {/* Degradado corporativo oscuro para preservar la legibilidad y estética de marca */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0E1A2B]/85 via-[#0E1A2B]/75 to-[#0E1A2B]/95 backdrop-blur-[1px]" />

        {/* Orbes de luz animados */}
        <div
          className="absolute -top-[10%] -left-[10%] w-[400px] h-[400px] rounded-full animate-blob-7 opacity-75"
          style={{ background: 'radial-gradient(circle, rgba(0,174,239,0.35) 0%, transparent 60%)' }}
        />
        <div
          className="absolute top-[12%] -right-[8%] w-[450px] h-[450px] rounded-full animate-blob-8 opacity-75"
          style={{ background: 'radial-gradient(circle, rgba(0,84,166,0.45) 0%, transparent 60%)' }}
        />
        <div
          className="absolute -bottom-[10%] left-[25%] w-[600px] h-[600px] rounded-full animate-blob-9 opacity-75"
          style={{ background: 'radial-gradient(circle, rgba(51,195,255,0.22) 0%, transparent 60%)' }}
        />
      </div>

      {/* Top Right: Language switcher + Login link */}
      <div className="absolute top-6 right-8 flex items-center gap-3 z-10">
        <LanguageSwitcher
          iconClassName="w-4 h-4 mr-1 text-white shrink-0"
          selectClassName="bg-transparent border-none focus:ring-0 cursor-pointer outline-none font-medium [color-scheme:dark]"
          selectStyle={{ color: '#ffffff' }}
        />
        {!hideLogin && (
          <>
            <span className="text-sm font-medium text-gray-300">Already have an account?</span>
            <button
              onClick={() => handleSignUp('login')}
              className="text-brand-bright font-bold hover:underline"
            >
              Log in
            </button>
          </>
        )}
      </div>

      <div className="relative z-10 max-w-7xl mx-auto text-center mt-8 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-center gap-3 sm:gap-4">
          <div className="flex flex-col items-start gap-1.5 shrink-0">
            <img src="/logo_29k.png" alt="CSCloudSolutions" className="h-11 sm:h-14 w-auto object-contain" />
            <img src="/CSCloudSolutionsText.png" alt="CSCloudSolutions" className="h-4 sm:h-5 w-auto object-contain" />
          </div>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight font-heading">
            {t('title')}
          </h2>
        </div>
        <p className="mt-4 text-lg text-gray-300 max-w-2xl mx-auto">
          {t('subtitle')}
        </p>
      </div>

      {/* Toggle */}
      <div className="relative z-10 flex justify-center items-center mb-16">
        <span className={`text-sm font-medium ${!isAnnual ? 'text-white' : 'text-gray-400'}`}>{t('monthly')}</span>
        <button 
          onClick={() => setIsAnnual(!isAnnual)}
          className="mx-4 relative inline-flex h-6 w-11 items-center rounded-full border border-white/40 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-bright focus:ring-offset-2 focus:ring-offset-[#0E1A2B]"
          style={{ backgroundColor: isAnnual ? '#0054A6' : '#D1D5DB' }}
        >
          <span 
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAnnual ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
        <span className={`text-sm font-medium flex items-center ${isAnnual ? 'text-white' : 'text-gray-400'}`}>
          {t('annual')}
          <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
            {t('annualSave', { percent: descuentoAnual })}
          </span>
        </span>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch animate-in fade-in zoom-in-95 duration-700 delay-150">
        {/* Professional */}
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl shadow-md hover:shadow-xl border border-slate-200/80 dark:border-slate-800 p-6 flex flex-col relative transition-all duration-300 hover:-translate-y-1.5 hover:z-20">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h3 className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100 font-heading min-w-0">{t('pro.name')}</h3>
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0">
              {t('trial')}
            </span>
          </div>
          <div className="mb-5">
            <div className="flex flex-wrap items-baseline text-3xl sm:text-4xl font-extrabold text-[#1B2A41] dark:text-white font-mono break-words">
              ${getPrice('Professional')}
              <span className="text-xs font-medium text-slate-500 ml-1">{t('perMonth')}</span>
            </div>
            {isAnnual && (
              <div className="text-xs text-slate-400 line-through mt-0.5">${(remotePrices?.Professional?.monthly ?? TIER_BASE_PRICE_USD.Professional!).toFixed(2)}{t('perMonth')}</div>
            )}
          </div>
          
          <div className="flex flex-col space-y-2.5 mb-5">
            <button 
              onClick={() => goToDemo('pro')}
              className="w-full bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-[#00AEEF] hover:bg-blue-50/50 dark:hover:bg-slate-800 rounded-lg py-2.5 px-3 text-xs font-bold transition-all shadow-2xs cursor-pointer"
            >
              {t('tryNow')}
            </button>
            <button 
              onClick={() => openCheckout(getPriceId('pro'))}
              className="w-full bg-[#0054A6] hover:bg-[#004080] text-white rounded-lg py-2.5 px-3 text-xs font-bold transition-all shadow-xs text-center inline-block cursor-pointer"
            >
              {t('buyNow')}
            </button>
          </div>
          
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
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
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl hover:shadow-2xl border-2 border-[#0054A6] p-6 flex flex-col relative transition-all duration-300 hover:-translate-y-1.5 hover:z-20 ring-4 ring-[#0054A6]/10">
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <span className="bg-gradient-to-r from-[#0054A6] to-[#00AEEF] text-white text-[10px] font-extrabold px-3 py-0.5 rounded-full uppercase tracking-wider shadow-md">
              {t('business.badge')}
            </span>
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mt-1">
            <h3 className="text-lg font-extrabold text-[#0054A6] dark:text-[#00AEEF] font-heading min-w-0">{t('business.name')}</h3>
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0">
              {t('trial')}
            </span>
          </div>
          <div className="mb-5">
            <div className="flex flex-wrap items-baseline text-3xl sm:text-4xl font-extrabold text-[#1B2A41] dark:text-white font-mono break-words">
              ${getPrice('Business')}
              <span className="text-xs font-medium text-slate-500 ml-1">{t('perMonth')}</span>
            </div>
            {isAnnual && (
              <div className="text-xs text-slate-400 line-through mt-0.5">${(remotePrices?.Business?.monthly ?? TIER_BASE_PRICE_USD.Business!).toFixed(2)}{t('perMonth')}</div>
            )}
          </div>
          
          <div className="flex flex-col space-y-2.5 mb-5">
            <button 
              onClick={() => goToDemo('business')}
              className="w-full bg-white dark:bg-slate-900 border border-[#1B2A41] dark:border-slate-600 text-[#1B2A41] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg py-2.5 px-3 text-xs font-bold transition-all shadow-2xs cursor-pointer"
            >
              {t('tryNow')}
            </button>
            <button 
              onClick={() => openCheckout(getPriceId('business'))}
              className="w-full bg-gradient-to-r from-[#0054A6] to-[#003B75] hover:brightness-110 text-white rounded-lg py-2.5 px-3 text-xs font-bold transition-all shadow-md text-center inline-block cursor-pointer"
            >
              {t('buyNow')}
            </button>
          </div>
          
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
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
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl shadow-md hover:shadow-xl border border-slate-200/80 dark:border-slate-800 p-6 flex flex-col relative transition-all duration-300 hover:-translate-y-1.5 hover:z-20">
          <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
            <div className="absolute top-0 right-0 -mr-8 -mt-8 w-24 h-24 bg-[#00AEEF] rounded-full opacity-10 blur-xl"></div>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 relative z-10">
            <h3 className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100 font-heading min-w-0">{t('enterprise.name')}</h3>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-bold px-2 py-0.5 rounded-full">
                {t('trial')}
              </span>
              <span className="bg-[#0E1A2B] text-white border border-slate-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">{t('enterprise.badge')}</span>
            </div>
          </div>
          <div className="mb-5 relative z-10">
            <div className="flex flex-wrap items-baseline text-2xl sm:text-3xl font-extrabold text-[#1B2A41] dark:text-white font-heading mt-1 mb-1 break-words">
              {t('customPrice')}
            </div>
          </div>
          
          <div className="flex flex-col space-y-2.5 mb-5 relative z-10">
            <button 
              onClick={() => setEnterpriseModalOpen(true)}
              className="w-full bg-[#0E1A2B] hover:bg-[#1B2A41] text-white rounded-lg py-2.5 px-3 text-xs font-bold transition-all shadow-md text-center flex justify-center items-center cursor-pointer"
            >
              {t('contactSales')}
            </button>
            <button
              onClick={() => goToDemo('enterprise')}
              className="w-full bg-white dark:bg-slate-900 border border-[#1B2A41] dark:border-slate-600 text-[#1B2A41] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg py-2.5 px-3 text-xs font-bold transition-all shadow-2xs text-center cursor-pointer"
            >
              {t('tryNow')}
            </button>
          </div>
          
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 relative z-10 leading-relaxed">
            {t('enterprise.desc')}
          </p>
          
          <div className="relative z-10">
            <PlanFeatures
              features={t.raw('enterprise.features') as string[]}
              showLabel={t('showFeatures', {count: (t.raw('enterprise.features') as string[]).length})}
              hideLabel={t('hideFeatures')}
            />
          </div>
          <div className="flex-1" />
        </div>

      </div>

      <footer className="relative z-10 max-w-7xl mx-auto w-full mt-16 pt-8 border-t border-white/10">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-300">
          <a href={`/${locale}/legal/privacy`} className="hover:text-white transition-colors">{tf('privacy')}</a>
          <a href={`/${locale}/legal/terms`} className="hover:text-white transition-colors">{tf('terms')}</a>
          <a href={`/${locale}/legal/dpa`} className="hover:text-white transition-colors">{tf('dpa')}</a>
          <a href={`/${locale}/legal/security`} className="hover:text-white transition-colors">{tf('security')}</a>
          <a href={`/${locale}/legal/subprocessors`} className="hover:text-white transition-colors">{tf('subprocessors')}</a>
          <a href={`/${locale}/status`} className="hover:text-white transition-colors">{tf('status')}</a>
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">{tf('copyright', { year: new Date().getFullYear() })}</p>
      </footer>
      <EnterpriseLeadModal isOpen={isEnterpriseModalOpen} onClose={() => setEnterpriseModalOpen(false)} />
      {pendingDemoTier && <DemoLeadModal onSuccess={handleDemoLeadSuccess} onClose={() => setPendingDemoTier(null)} />}
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
function PlanFeatures({
  features,
  showLabel,
  hideLabel,
}: {
  features: string[];
  showLabel: string;
  hideLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-2.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
      >
        <span>{open ? hideLabel : showLabel}</span>
        <svg
          className={`w-4 h-4 text-slate-500 dark:text-slate-300 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <ul className="space-y-3 text-sm mt-4 text-slate-700 dark:text-slate-200">
          {features.map((feature, idx) => (
            <li key={idx} className="flex items-start font-medium text-slate-800 dark:text-slate-100 leading-relaxed">
              <svg
                className="w-5 h-5 mr-2 flex-shrink-0 text-[#0078D4] dark:text-[#00AEEF]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

