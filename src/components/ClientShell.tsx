"use client";
import React, { useState, createContext, useEffect, useRef } from 'react';
import { Link } from '@/i18n/routing';
import AuthProvider, { AuthButton, useAuthLoading } from "./AuthProvider";
import { TenantProvider, useTenant } from './TenantProvider';
import { SubscriptionProvider } from './SubscriptionProvider';
import ScopeSelector from './ScopeSelector';
import { ViewModeProvider, useViewMode } from '../context/ViewModeContext';
import { ProviderProvider } from '../context/ProviderContext';
import { LayoutTemplate, Code2, Bell, HelpCircle } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import AuthSync from './AuthSync';
import LanguageSwitcher from './LanguageSwitcher';
import Sidebar from "./Sidebar";
import RouteTierGate from './RouteTierGate';
import ActionCenterDrawer from './ActionCenterDrawer';
import { useBrowserNotifications } from '@/hooks/useBrowserNotifications';
import CostToggle from './dashboard/CostToggle';
import GlobalPagePinButton from './dashboard/GlobalPagePinButton';
import SupportHeaderActions from './SupportHeaderActions';
import MobileTabBar from './mobile/MobileTabBar';
import PricingPage from './PricingPage';
import UnregisteredUserScreen from './UnregisteredUserScreen';

/** Rutas públicas de la Fase 2: se llega por link de email, sin sesión. */
const AUTH_TOKEN_ROUTES = ['/verify-email', '/reset-password', '/accept-invite'];

// Rutas públicas por definición: las legales (privacidad, términos, DPA,
// seguridad, subprocesadores) y la página de estado. Se visitan SIN sesión —
// desde la pantalla de precios, desde el pie del sidebar, o linkeadas desde
// afuera— y en el caso de las legales tienen que ser alcanzables por
// cumplimiento, no sólo por comodidad.
const PUBLIC_ROUTES = ['/legal', '/status'];
import CookieConsent from './CookieConsent';
import TelemetryDelayModal from './TelemetryDelayModal';
import { useActionLogStore } from '@/store/actionLogStore';
import { useRouter, usePathname } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { useMsal, useIsAuthenticated } from "@azure/msal-react";

import { MetricProvider } from './MetricProvider';
import { CurrencyProvider } from './CurrencyProvider';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';

export const TabContext = createContext({ activeTab: 'dashboard', setActiveTab: (t: string) => {} });

export default function ClientShell({ children, demoSession }: { children: React.ReactNode, demoSession?: { isDemo: boolean; tier: string } | null }) {
  return <AuthProvider>
      <AuthSync />
      <TenantProvider demoSession={demoSession}>
        <ProviderProvider>
        <SubscriptionProvider>
          <MetricProvider>
            <CurrencyProvider>
              <ViewModeProvider>
                <ShellContent demoSession={demoSession}>{children}</ShellContent>
                <CookieConsent />
              </ViewModeProvider>
            </CurrencyProvider>
          </MetricProvider>
        </SubscriptionProvider>
        </ProviderProvider>
      </TenantProvider>
    </AuthProvider>;
}

function ShellContent({ children, demoSession }: { children: React.ReactNode, demoSession?: { isDemo: boolean; tier: string } | null }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showPricing, setShowPricing] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [hasPendingUpgrade, setHasPendingUpgrade] = useState(false);
  const { selectedTenant, setSelectedTenant, isAdmin, tenants, isUserRegistered, systemRole } = useTenant();
  useBrowserNotifications(selectedTenant?.id);
  const { instance, accounts, inProgress } = useMsal();
  const { isInitializing } = useAuthLoading();
  
  // If demoSession exists, we treat the user as authenticated for the sake of the shell.
  const isMsalAuthenticated = useIsAuthenticated();
  const isAuthenticated = isMsalAuthenticated || !!demoSession?.isDemo;
  const { viewMode, toggleViewMode } = useViewMode();
  const t = useTranslations('nav');
  const tc = useTranslations('Common');
  const tAuth = useTranslations('auth');
  const tPricing = useTranslations('pricing');
  const tFooter = useTranslations('ClientShellFooter');
  const locale = useLocale();
  const actions = useActionLogStore(state => state.actions);

  const userManualHref = locale === 'pt-BR'
    ? '/manual/MANUAL_USUARIO_PT-BR.pdf'
    : locale === 'en'
      ? '/manual/MANUAL_USUARIO_EN.pdf'
      : '/manual/MANUAL_USUARIO_ES.pdf';

  const router = useRouter();
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();

  useEffect(() => {
      const paymentStatus = searchParams?.get('payment');
      if (paymentStatus === 'success') {
          toast.success(tAuth('paymentSuccess'), { duration: 5000 });
          const newUrl = pathname;
          router.replace(newUrl);
      }
  }, [searchParams, tAuth, pathname, router]);

  // En teléfonos, la home es la experiencia móvil (/mobile) salvo que el
  // usuario haya pedido la versión de escritorio desde su perfil.
  useEffect(() => {
      if (pathname !== '/' || !isAuthenticated) return;
      const isPhone = window.matchMedia('(max-width: 767px)').matches;
      if (isPhone && sessionStorage.getItem('finops:forceDesktop') !== '1') {
          router.replace('/mobile');
      }
  }, [pathname, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      const pendingPlan = sessionStorage.getItem('pendingUpgrade');
      if (pendingPlan && pendingPlan !== 'login') {
        setHasPendingUpgrade(true);
        sessionStorage.removeItem('pendingUpgrade');
        // Handle checkout post-login
        const triggerCheckout = async () => {
          try {
             const tokenResponse = await instance.acquireTokenSilent({
               scopes: ["User.Read"],
               account: accounts[0]
             });
             const res = await fetch('/api/checkout', {
               method: 'POST',
               headers: {
                   'Authorization': `Bearer ${tokenResponse.idToken}`,
                   'Content-Type': 'application/json'
               },
               body: JSON.stringify({ plan: pendingPlan })
             });
             const data = await res.json();
             if (res.ok && data.checkoutUrl) {
                 window.location.href = data.checkoutUrl;
             }
          } catch(e) {
             console.error("Error trigger auto checkout", e);
          }
        };
        triggerCheckout();
      } else if (pendingPlan === 'login') {
        setHasPendingUpgrade(false);
        sessionStorage.removeItem('pendingUpgrade');
      }
    }
  }, [isAuthenticated, accounts, instance]);

  const navItems = [
      { id: 'dashboard', label: 'Dashboard', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
      { id: 'audit', label: 'Auditoría Completa', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
      { id: 'tags', label: 'Gestión de Etiquetas', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
      { id: 'advisor', label: 'Azure Advisor', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
      { id: 'powerbi', label: 'Reportes Power BI', icon: 'M8 13v-1m4 1v-3m4 3V8M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
      { id: 'config', label: 'Configuración', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  ];

  const isTrialExpired = selectedTenant?.subscription_status === 'TRIAL' && 
      selectedTenant?.trial_ends_at && 
      new Date(selectedTenant.trial_ends_at) < new Date();
  
  const isPendingPayment = selectedTenant?.subscription_status === 'PENDING_PAYMENT' || selectedTenant?.subscription_status === 'EXPIRED';

  useEffect(() => {
      if (isAuthenticated && (isTrialExpired || isPendingPayment) && pathname !== '/login' && pathname !== '/upgrade') {
          router.replace('/upgrade');
      }
  }, [isAuthenticated, isTrialExpired, isPendingPayment, pathname, router]);

  // Auto-redirect a /onboarding si el tenant no tiene credenciales Azure
  // configuradas. Migrado del viejo Dashboard General (src/app/[locale]/
  // page.tsx, ahora un simple redirect a White Board) para que el chequeo
  // siga aplicando sin importar en qué página caiga el usuario tras login.
  const onboardingRedirectRef = useRef(false);
  useEffect(() => {
    if (onboardingRedirectRef.current) return;
    if (!isMsalAuthenticated || !selectedTenant || selectedTenant.id === 'default' || accounts.length === 0) return;
    if (pathname === '/onboarding') return;
    // Tenants demo/mock nunca pasan por el wizard real: no tienen fila en la
    // DB, así que /api/onboarding/progress respondería is_onboarded=false y
    // esto redirigiría en loop.
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
          // aún NO tienen credenciales Azure (client_id + secret). Si el
          // entorno ya está configurado, no lo forzamos al wizard aunque
          // is_onboarded sea false (p.ej. onboarding técnico hecho pero flag
          // no seteado).
          const hasCredentials = !!(selectedTenant.client_id && selectedTenant.has_client_secret);
          if (!selectedTenant.is_onboarded && !hasCredentials) {
            onboardingRedirectRef.current = true;
            router.push('/onboarding');
          }
        }
      } catch (error) {
        console.error('[ClientShell] Failed to check onboarding:', error);
      }
    };

    checkOnboarding();
  }, [selectedTenant?.id, isMsalAuthenticated, accounts.length, instance, pathname, router]);

  useEffect(() => {
      const paymentStatus = searchParams?.get('payment');
      if (paymentStatus === 'success') {
          toast.success(tAuth('paymentSuccess'), { duration: 5000 });
          const newUrl = pathname;
          router.replace(newUrl);
      }
  }, [searchParams, tAuth, pathname, router]);



  // Rutas que se abren desde un link de email y por definición se visitan SIN
  // sesión: confirmar email, restablecer contraseña, aceptar invitación. Sin
  // esta excepción, ClientShell las tapa con la pantalla de login y el token
  // del link se pierde.
  const isAuthTokenRoute = AUTH_TOKEN_ROUTES.some(
      (r) => pathname === r || pathname.startsWith(`${r}/`)
  );

  const isPublicRoute = PUBLIC_ROUTES.some(
      (r) => pathname === r || pathname.startsWith(`${r}/`)
  );

  useEffect(() => {
      if (!isInitializing && !isAuthenticated && inProgress !== "startup" && inProgress !== "handleRedirect") {
          const isDemo = pathname === '/demo' || pathname.startsWith('/demo/');
          if (!showPricing && pathname !== '/login' && !isDemo && !isAuthTokenRoute && !isPublicRoute) {
              router.replace('/login');
          }
      } else if (isAuthenticated && pathname === '/login') {
          router.replace('/');
      }
  }, [isAuthenticated, inProgress, showPricing, pathname, router, isAuthTokenRoute, isPublicRoute]);

  const isDemoRoute = pathname === '/demo' || pathname.startsWith('/demo/');

  // Las rutas públicas se sirven ANTES del gate de inicialización de MSAL: una
  // página legal no depende de la sesión, así que no tiene por qué esperar a
  // que MSAL resuelva. Sin esto se quedaban ~3 s en "Cargando..." (medido en
  // local el 2026-07-30), que es exactamente lo que hacía que el click desde la
  // pantalla de precios se sintiera como "no muestra nada".
  // Sólo sin sesión establecida: durante la inicialización isAuthenticated es
  // false, así que la página sale al instante; una vez que MSAL resuelve, un
  // usuario logueado la vuelve a ver dentro del shell (con su sidebar), que es
  // desde donde la abre.
  if (isPublicRoute && !isAuthenticated) {
      return <>{children}</>;
  }

  if (isInitializing || inProgress === "startup" || inProgress === "handleRedirect" || (isAuthenticated && isUserRegistered === null && !isDemoRoute && !isAuthTokenRoute && !isPublicRoute)) {
      return (
          <div className="min-h-screen bg-gradient-to-br from-nav-bg to-nav-bg2 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative font-sans items-center">
              <div className="flex flex-col items-center">
                  <div className="relative mb-6 flex items-center justify-center">
                      <div className="absolute w-40 h-40 rounded-full bg-brand-bright/25 blur-3xl animate-ping"></div>
                      <img src="/logo_29k.png" alt="Logo" className="relative w-32 h-32 object-contain animate-pulse drop-shadow-[0_0_28px_rgba(30,136,229,0.55)]" />
                  </div>
                  <div className="w-8 h-8 border-4 border-[#0054A6] border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-4 text-sm font-semibold text-[#62809c] tracking-widest uppercase">Cargando...</p>
              </div>
          </div>
      );
  }

  if (!isAuthenticated) {
      if (isDemoRoute || isAuthTokenRoute || isPublicRoute) {
          return <>{children}</>;
      }
      if (showPricing) {
          return <PricingPage onLoginClick={() => setShowPricing(false)} tenantId={selectedTenant?.id} />;
      }
      return (
          <div className="min-h-screen bg-gradient-to-br from-nav-bg to-nav-bg2 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative font-sans">
              <div className="absolute top-4 right-4 z-50">
                  <LanguageSwitcher />
              </div>
              
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-brand-deep/20 blur-[100px]"></div>
                  <div className="absolute bottom-[10%] right-[-5%] w-[30%] h-[30%] rounded-full bg-brand-bright/10 blur-[80px]"></div>
              </div>

              <div className="sm:mx-auto sm:w-full sm:max-w-md text-center animate-in fade-in zoom-in duration-500 relative z-10">
                  <div className="flex items-center justify-center mb-6">
                      <img src="/CSCloudSolutions.png" alt="CSCloudSolutions" className="w-full max-w-[400px] h-auto object-contain" />
                  </div>
                  <p className="mt-2 text-center text-[13px] tracking-[2px] text-[#62809c] uppercase font-semibold">
                      Cloud Management Platform
                  </p>
              </div>

              <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-[440px] animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100 relative z-10">
                  <div className="bg-surface/5 backdrop-blur-xl py-10 px-6 sm:px-10 shadow-2xl shadow-black/50 border border-white/10 sm:rounded-[20px] relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-deep to-brand-bright"></div>
                      
                      <div className="mb-8 text-center">
                          <h3 className="text-[18px] font-bold text-white font-heading">
                              {tc('corporate_access')}
                          </h3>
                          <p className="text-[13.5px] text-[#A9BBD0] mt-2 leading-relaxed">
                              {tc('corporate_access_desc')}
                          </p>
                      </div>

                      <div className="space-y-4">
                          <button
                              onClick={() => {
                                  instance.loginRedirect({ scopes: ["User.Read", "Directory.Read.All"] })
                                      .catch(e => console.error(e));
                              }}
                              className="w-full flex items-center justify-center py-[13px] px-4 border border-transparent rounded-[12px] shadow-[0_6px_16px_rgba(0,84,166,0.4)] text-[14px] font-bold text-white bg-gradient-to-br from-brand-deep to-[#1E88E5] hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-nav-bg focus:ring-brand-deep transition-all transform active:scale-[0.98] font-heading"
                          >
                              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24"><path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z"/></svg>
                              {tc('sign_in_microsoft')}
                          </button>

                          <button
                              onClick={() => {
                                  setShowPricing(true);
                                  router.replace('/');
                              }}
                              className="w-full mt-4 flex items-center justify-center py-3 px-4 rounded-[12px] text-[14px] font-bold text-[#A9BBD0] hover:text-white hover:bg-white/5 transition-all focus:outline-none font-heading"
                          >
                              {tPricing('backToPricing')}
                          </button>


                      </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-8 text-[11px] text-[#566f8c]">
                      <Link href="/legal/privacy" className="hover:text-[#A9BBD0] transition-colors">{tFooter('privacy')}</Link>
                      <span className="text-[#324259]">·</span>
                      <Link href="/legal/terms" className="hover:text-[#A9BBD0] transition-colors">{tFooter('terms')}</Link>
                      <span className="text-[#324259]">·</span>
                      <Link href="/legal/dpa" className="hover:text-[#A9BBD0] transition-colors">{tFooter('dpa')}</Link>
                      <span className="text-[#324259]">·</span>
                      <Link href="/legal/security" className="hover:text-[#A9BBD0] transition-colors">{tFooter('security')}</Link>
                      <span className="text-[#324259]">·</span>
                      <Link href="/legal/subprocessors" className="hover:text-[#A9BBD0] transition-colors">{tFooter('subprocessors')}</Link>
                      <span className="text-[#324259]">·</span>
                      <Link href="/status" className="hover:text-[#A9BBD0] transition-colors">{tFooter('status')}</Link>
                  </div>
                  <p className="text-center text-[11px] text-[#566f8c] mt-2 tracking-wide">
                      &copy; {new Date().getFullYear()} CSCloudSolutions. {tc('all_rights')}
                  </p>
              </div>
          </div>
      );
  }

  // Bloqueo de seguridad: Si el usuario inició sesión con Microsoft pero NO existe en la base de datos
  // ni tiene una organización o compra asignada, se despliega la pantalla de advertencia UnregisteredUserScreen.
  if (isUserRegistered === false && !isDemoRoute && !isAuthTokenRoute && !isPublicRoute && systemRole !== 'SUPERADMIN' && !isAdmin) {
      if (showPricing) {
          return <PricingPage onLoginClick={() => setShowPricing(false)} tenantId={selectedTenant?.id} />;
      }
      return <UnregisteredUserScreen onGoToPricing={() => setShowPricing(true)} />;
  }

  return (
    <TabContext.Provider value={{ activeTab, setActiveTab }}>
    <div className="flex h-screen bg-background text-foreground overflow-hidden relative">
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-surface/85 backdrop-blur-md border-b border-line flex items-center justify-between px-3 sm:px-6 z-30 shadow-sm sticky top-0">
          <div className="flex items-center">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 mr-1 sm:mr-4 text-gray-400 hover:text-[#0054A6] transition-colors focus:outline-none">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
            {selectedTenant && selectedTenant.id !== 'default' && selectedTenant.has_logo ? (
                <div className="hidden sm:flex flex-row items-center gap-2 leading-tight">
                    {/* eslint-disable-next-line @next/next/no-img-element -- logo servido por nuestra propia API, dinámico por tenant, no apto para next/image estático */}
                    <img
                        src={`/api/tenant-logo/${selectedTenant.id}${selectedTenant.logo_version ? `?v=${selectedTenant.logo_version}` : ''}`}
                        alt={selectedTenant.name}
                        className="max-h-[55px] w-auto object-contain object-left"
                    />
                    <span className="text-xs font-bold text-ink tracking-tight">{selectedTenant.name}</span>
                </div>
            ) : (
                <Link href="/admin/config#logo-upload" className="hidden sm:flex items-center gap-2 group">
                    {/* eslint-disable-next-line @next/next/no-img-element -- asset estático local, no requiere optimización de next/image */}
                    <img src="/logo_29k.png" alt="" className="h-8 w-8 object-contain shrink-0" />
                    <div className="flex flex-col items-start leading-tight">
                        <h1 className="text-xl font-bold text-ink tracking-tight">CSCloudSolutions</h1>
                        <span className="text-[11px] font-bold text-brand-deep group-hover:underline">{tc('add_your_logo')}</span>
                    </div>
                </Link>
            )}
          </div>
          
          <div className="flex items-center space-x-2 sm:space-x-6">
            <div className="hidden sm:flex items-center space-x-4">
                <ScopeSelector />
            </div>

            {/* En móvil el idioma vive en el Perfil y Soporte tiene su pestaña
                inferior: el header queda solo con hamburguesa, campana y avatar. */}
            <div className="hidden md:block">
                <LanguageSwitcher />
            </div>

            <div className="flex items-center space-x-1 sm:space-x-2">
                <SupportHeaderActions />
                <button
                    onClick={() => setDrawerOpen(true)}
                    className="relative p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                    <Bell className="w-5 h-5" />
                    {actions.length > 0 && (
                        <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                        </span>
                    )}
                </button>
                <a
                    href={userManualHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={tc('user_manual', { fallback: 'Ver manual de usuario' })}
                    aria-label={tc('user_manual', { fallback: 'Ver manual de usuario' })}
                    className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                    <HelpCircle className="w-5 h-5" />
                </a>
                <AuthButton />
            </div>
          </div>
        </header>

        <ActionCenterDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

        <main className="flex-1 overflow-y-auto p-3 sm:p-6 pb-24 md:pb-6 relative">
          <div className="absolute top-3 right-3 sm:top-6 sm:right-6 z-30">
            <GlobalPagePinButton />
          </div>
          <RouteTierGate>{children}</RouteTierGate>
        </main>

        <MobileTabBar />
        <TelemetryDelayModal isAuthenticated={isAuthenticated} />

        <div className="fixed bottom-4 right-6 pointer-events-none z-40 opacity-40 select-none">
            <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">SaaS Tier</span>
                <span className="text-xl font-black text-gray-400/80 tracking-tighter">
                    {selectedTenant?.tier || 'Professional'}
                </span>
            </div>
        </div>
      </div>
    </div>
    </TabContext.Provider>
  );
}
