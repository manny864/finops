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
import { FinOpsCapabilitiesTable } from './FinOpsCapabilitiesTable';
import {
  IconBuildingLighthouse,
  IconCheck,
  IconAward,
  IconStarFilled,
  IconShieldCheck,
  IconArrowRight,
  IconTable,
  IconArrowsMaximize,
} from "@tabler/icons-react";

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
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  const t = useTranslations('pricing');
  const tf = useTranslations('Footer');
  const locale = useLocale();

  const proFeatures = (t.raw('pro.features') as string[]) || [];
  const businessFeatures = (t.raw('business.features') as string[]) || [];
  const enterpriseFeatures = (t.raw('enterprise.features') as string[]) || [];

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

  if (viewMode === 'table') {
    return (
      <>
        <FinOpsCapabilitiesTable
          onRevert={() => setViewMode('cards')}
          onClose={onLoginClick ? () => onLoginClick() : () => setViewMode('cards')}
          onSelectPro={() => {
            setViewMode('cards');
            goToDemo('pro');
          }}
          onSelectBusiness={() => {
            setViewMode('cards');
            openCheckout(getPriceId('business'));
          }}
          onSelectEnterprise={() => {
            setViewMode('cards');
            setEnterpriseModalOpen(true);
          }}
        />
        <EnterpriseLeadModal
          isOpen={isEnterpriseModalOpen}
          onClose={() => setEnterpriseModalOpen(false)}
        />
        {pendingDemoTier && (
          <DemoLeadModal
            onSuccess={handleDemoLeadSuccess}
            onClose={() => setPendingDemoTier(null)}
          />
        )}
        <CorporateEmailNoticeModal
          open={!!pendingCheckoutPriceId}
          email={corporateEmail}
          onCancel={() => setPendingCheckoutPriceId(undefined)}
          onConfirm={confirmCheckout}
          t={t}
        />
      </>
    );
  }

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
        <LanguageSwitcher variant="white" />
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

      {/* Botón de Matriz Comparativa Completa */}
      <div className="relative z-10 flex justify-center -mt-8 mb-12">
        <button
          type="button"
          onClick={() => setViewMode('table')}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-slate-100 bg-white/10 hover:bg-white/20 border border-white/20 shadow-sm transition-all hover:-translate-y-0.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#00AEEF]"
        >
          <IconTable className="w-4 h-4 text-[#00AEEF]" />
          <span>{t('compareFullscreen')}</span>
          <IconArrowsMaximize className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch animate-in fade-in zoom-in-95 duration-700 delay-150">
        {/* Professional */}
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl shadow-md hover:shadow-xl border border-slate-200/80 dark:border-slate-800 p-6 flex flex-col justify-between relative transition-all duration-300 hover:-translate-y-1.5 hover:z-20 overflow-hidden">
          <div>
            <div className="flex flex-wrap items-center gap-2 justify-between mb-3">
              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-md border border-blue-200">
                <IconAward className="w-3.5 h-3.5 text-blue-700" stroke={2} />
                <span>{t('pro.badge')}</span>
              </span>
              <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                {t('trial')}
              </span>
            </div>
            <h3 className="text-xl font-extrabold text-gray-900 dark:text-white mb-2 font-heading">{t('pro.name')}</h3>
            <div className="mb-4">
              <div className="flex flex-wrap items-baseline text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white font-mono break-words">
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

            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
              {t('pro.desc')}
            </p>

            <div className="h-px bg-gray-100 dark:bg-slate-800 mb-5" />

            <ul className="space-y-3 text-xs sm:text-sm text-gray-700 dark:text-slate-200">
              {proFeatures.slice(0, 8).map((f, i) => (
                <li key={i} className="flex items-start">
                  <IconCheck className="w-4 h-4 text-[#00AEEF] mr-2.5 mt-0.5 flex-shrink-0" stroke={2.5} />
                  <span className={i === 0 ? 'font-semibold text-gray-900 dark:text-white' : ''}>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {proFeatures.length > 8 && (
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className="mt-4 pt-2 text-xs font-bold text-[#0078D4] dark:text-[#00AEEF] hover:underline transition-colors text-left flex items-center gap-1.5 focus:outline-none cursor-pointer group"
            >
              <span>{t('showFeatures', { count: proFeatures.length })}</span>
              <IconArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1" stroke={2.5} />
            </button>
          )}
        </div>

        {/* Business */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl hover:shadow-2xl border-2 border-[#002244] dark:border-[#0078D4] p-6 flex flex-col justify-between relative transition-all duration-300 hover:-translate-y-1.5 hover:z-20 ring-4 ring-blue-500/10 overflow-hidden">
          <div className="absolute top-0 right-0 left-0 h-1.5 bg-gradient-to-r from-[#002244] via-[#00AEEF] to-[#002244]" />

          <div>
            <div className="flex items-center justify-between mb-3 mt-1">
              <span className="inline-flex items-center gap-1.5 bg-[#002244] dark:bg-[#0054A6] text-white text-xs font-extrabold px-3 py-1 rounded-md tracking-wide uppercase">
                <IconStarFilled className="w-3.5 h-3.5 text-amber-400" />
                <span>{t('business.badge')}</span>
              </span>
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                {t('trial')}
              </span>
            </div>
            <h3 className="text-xl font-extrabold text-[#002244] dark:text-[#00AEEF] mb-2 font-heading">{t('business.name')}</h3>
            <div className="mb-4">
              <div className="flex flex-wrap items-baseline text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white font-mono break-words">
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
                className="w-full bg-white dark:bg-slate-900 border border-[#002244] dark:border-slate-600 text-[#002244] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg py-2.5 px-3 text-xs font-bold transition-all shadow-2xs cursor-pointer"
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

            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mb-5 leading-relaxed">
              {t('business.desc')}
            </p>

            <div className="h-px bg-gray-100 dark:bg-slate-800 mb-5" />

            <ul className="space-y-3 text-xs sm:text-sm text-gray-700 dark:text-slate-200">
              {businessFeatures.slice(0, 8).map((f, i) => (
                <li key={i} className="flex items-start">
                  <IconCheck className="w-4 h-4 text-[#002244] dark:text-[#00AEEF] mr-2.5 mt-0.5 flex-shrink-0" stroke={2.5} />
                  <span className={i === 0 || f.startsWith('Todo lo de') || f.startsWith('Everything in') || f.startsWith('Tudo do') ? 'font-bold text-gray-900 dark:text-white' : ''}>
                    {f}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {businessFeatures.length > 8 && (
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className="mt-4 pt-2 text-xs font-bold text-[#002244] dark:text-[#00AEEF] hover:underline transition-colors text-left flex items-center gap-1.5 focus:outline-none cursor-pointer group"
            >
              <span>{t('showFeatures', { count: businessFeatures.length })}</span>
              <IconArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1" stroke={2.5} />
            </button>
          )}
        </div>

        {/* Enterprise */}
        <div className="bg-gradient-to-b from-[#0F172A] to-[#1E293B] text-white rounded-2xl shadow-xl hover:shadow-2xl border border-slate-700 p-6 flex flex-col justify-between relative overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:z-20">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />

          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 relative z-10">
              <span className="inline-flex items-center gap-1.5 bg-white/10 text-white text-xs font-bold px-2.5 py-1 rounded-md border border-white/20">
                <IconShieldCheck className="w-3.5 h-3.5 text-white" stroke={2} />
                <span className="text-white font-bold">{t('enterprise.badge')}</span>
              </span>
              <span className="bg-white/10 text-white border border-white/20 text-[11px] font-bold px-2.5 py-0.5 rounded-full">
                {t('trial')}
              </span>
            </div>

            <h3 className="text-xl font-extrabold text-white mb-2 font-heading relative z-10">{t('enterprise.name')}</h3>

            <div className="mb-4 relative z-10">
              <div className="flex flex-wrap items-baseline text-2xl sm:text-3xl font-extrabold text-white font-heading mt-1 mb-1 break-words">
                {t('customPrice')}
              </div>
            </div>
            
            <div className="flex flex-col space-y-2.5 mb-5 relative z-10">
              <button 
                onClick={() => setEnterpriseModalOpen(true)}
                className="w-full bg-white hover:bg-slate-100 text-[#0F172A] rounded-lg py-2.5 px-3 text-xs font-bold transition-all shadow-md text-center flex justify-center items-center cursor-pointer"
              >
                {t('contactSales')}
              </button>
              <button
                onClick={() => goToDemo('enterprise')}
                className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-lg py-2.5 px-3 text-xs font-bold transition-all shadow-2xs text-center cursor-pointer"
              >
                {t('tryNow')}
              </button>
            </div>
            
            <p className="text-xs sm:text-sm text-slate-300 mb-4 relative z-10 leading-relaxed">
              {t('enterprise.desc')}
            </p>

            <div className="relative z-10 mb-5 rounded-xl border border-cyan-500/30 bg-cyan-950/40 p-3">
              <div className="flex items-center gap-1.5">
                <IconBuildingLighthouse size={15} stroke={1.75} className="text-[#00AEEF] shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#00AEEF]">
                  {t('enterprise.lighthouseTitle')}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">
                {t('enterprise.lighthouseDesc')}
              </p>
            </div>

            <div className="h-px bg-slate-700 mb-5 relative z-10" />

            <ul className="space-y-3 text-xs sm:text-sm text-white relative z-10">
              {enterpriseFeatures.slice(0, 8).map((f, i) => (
                <li key={i} className="flex items-start">
                  <IconCheck className="w-4 h-4 text-white mr-2.5 mt-0.5 flex-shrink-0" stroke={2.5} />
                  <span className={i === 0 || f.startsWith('Todo lo de') || f.startsWith('Everything in') || f.startsWith('Tudo do') ? 'font-bold text-white' : 'text-slate-100'}>
                    {f}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {enterpriseFeatures.length > 8 && (
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className="mt-4 pt-2 text-xs font-bold text-white hover:text-white/80 transition-colors text-left flex items-center gap-1.5 focus:outline-none cursor-pointer group relative z-10"
            >
              <span>{t('showFeatures', { count: enterpriseFeatures.length })}</span>
              <IconArrowRight className="w-3.5 h-3.5 text-white transition-transform duration-200 group-hover:translate-x-1" stroke={2.5} />
            </button>
          )}
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
