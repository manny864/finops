import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTranslations } from 'next-intl';
import { initializePaddle, Paddle } from '@paddle/paddle-js';
import EnterpriseLeadModal from './EnterpriseLeadModal';

interface PricingPageProps {
  onLoginClick?: () => void;
  tenantId?: string;
  hideLogin?: boolean;
}

export default function PricingPage({ onLoginClick, tenantId, hideLogin }: PricingPageProps) {
  const { instance } = useMsal();
  const [isAnnual, setIsAnnual] = useState(false);
  const [paddle, setPaddle] = useState<Paddle>();
  const [isEnterpriseModalOpen, setEnterpriseModalOpen] = useState(false);
  const t = useTranslations('pricing');

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!;
    const env = token.startsWith('test_') ? 'sandbox' : 'production';
    initializePaddle({ environment: env, token }).then(setPaddle);
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
    if (plan === 'free') {
        return isAnnual ? process.env.NEXT_PUBLIC_PADDLE_ESSENTIAL_YEARLY : process.env.NEXT_PUBLIC_PADDLE_ESSENTIAL_MONTHLY;
    } else if (plan === 'pro') {
        return isAnnual ? process.env.NEXT_PUBLIC_PADDLE_PRO_YEARLY : process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY;
    } else if (plan === 'business') {
        return isAnnual ? process.env.NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY : process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY;
    }
    return undefined;
  };

  const openCheckout = (priceId?: string) => {
    if (!priceId) return;
    paddle?.Checkout.open({ items: [{ priceId, quantity: 1 }], customData: { tenant_id: tenantId } });
  };

  const getPrice = (monthly: number) => {
    if (!isAnnual) return `${monthly}`;
    return `${(monthly * 0.88).toFixed(2)}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans py-16 px-4 sm:px-6 lg:px-8">
      {/* Top Right Login Link */}
      {!hideLogin && (
        <div className="absolute top-6 right-8">
          <span className="text-sm font-medium text-gray-500 mr-2">Already have an account?</span>
          <button 
            onClick={() => handleSignUp('free')}
            className="text-brand-deep font-bold hover:underline"
          >
            Log in
          </button>
        </div>
      )}

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
              <span className="text-lg font-medium text-gray-500 ml-1">/mes</span>
            </div>
            {isAnnual && (
              <div className="text-sm text-gray-500 line-through mt-1">$19.99/mes</div>
            )}
          </div>
          
          <div className="flex flex-col space-y-3 mb-6">
            <button 
              onClick={() => openCheckout(getPriceId('free'))}
              className="w-full bg-white border-2 border-gray-800 text-gray-800 rounded-lg py-3 px-4 font-bold hover:bg-gray-50 transition-colors shadow-sm"
            >
              {t('tryNow')}
            </button>
            <button 
              onClick={() => openCheckout(getPriceId('free'))}
              className="w-full bg-gray-800 text-white rounded-lg py-3 px-4 font-semibold hover:bg-gray-900 transition-colors shadow-md text-center inline-block"
            >
              {t('buyNow')}
            </button>
          </div>
          
          <p className="text-sm text-gray-500 mb-8 flex-1">
            {t('essential.desc')}
          </p>
          
          <ul className="space-y-4 text-sm text-gray-600">
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('essential.f1')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('essential.f2')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('essential.f3')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('essential.f4')}
            </li>
            <li className="flex items-start text-gray-400">
              <svg className="w-4 h-4 text-gray-300 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              {t('essential.f5')}
            </li>
          </ul>
        </div>

        {/* Professional */}
        <div className="bg-white rounded-2xl shadow-xl border-2 border-brand-deep p-8 flex flex-col relative transform md:-translate-y-4">
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <span className="bg-brand-deep text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
              {t('pro.badge')}
            </span>
          </div>
          
          <div className="mb-6 flex items-center justify-between mt-2">
            <h3 className="text-xl font-bold text-brand-deep">{t('pro.name')}</h3>
            <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded animate-pulse">
              {t('pro.trial')}
            </span>
          </div>
          <div className="mb-6">
            <div className="flex items-baseline text-5xl font-extrabold text-gray-900">
              ${getPrice(99.99)}
              <span className="text-lg font-medium text-gray-500 ml-1">/mes</span>
            </div>
            {isAnnual && (
              <div className="text-sm text-gray-500 line-through mt-1">$99.99/mes</div>
            )}
          </div>
          
          <div className="flex flex-col space-y-3 mb-6">
            <button 
              onClick={() => openCheckout(getPriceId('pro'))}
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
          
          <p className="text-sm text-gray-500 mb-8 flex-1">
            {t('pro.desc')}
          </p>
          
          <ul className="space-y-4 text-sm text-gray-600">
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-brand-deep mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('pro.f1')}
            </li>
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-brand-deep mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('pro.f2')}
            </li>
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-brand-deep mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('pro.f3')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('pro.f4')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('pro.f5')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('pro.f6')}
            </li>
          </ul>
        </div>

        {/* Business */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col hover:shadow-md transition-shadow">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">{t('business.name')}</h3>
            <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded">
              {t('pro.trial')}
            </span>
          </div>
          <div className="mb-6">
            <div className="flex items-baseline text-5xl font-extrabold text-gray-900">
              ${getPrice(299.99)}
              <span className="text-lg font-medium text-gray-500 ml-1">/mes</span>
            </div>
            {isAnnual && (
              <div className="text-sm text-gray-500 line-through mt-1">$299.99/mes</div>
            )}
          </div>
          
          <div className="flex flex-col space-y-3 mb-6">
            <button 
              onClick={() => openCheckout(getPriceId('business'))}
              className="w-full bg-white border-2 border-gray-800 text-gray-800 rounded-lg py-3 px-4 font-bold hover:bg-gray-50 transition-colors shadow-sm"
            >
              {t('tryNow')}
            </button>
            <button 
              onClick={() => openCheckout(getPriceId('business'))}
              className="w-full bg-gray-800 text-white rounded-lg py-3 px-4 font-semibold hover:bg-gray-900 transition-colors shadow-md text-center inline-block"
            >
              {t('buyNow')}
            </button>
          </div>
          
          <p className="text-sm text-gray-500 mb-8 flex-1">
            {t('business.desc')}
          </p>
          
          <ul className="space-y-4 text-sm text-gray-600">
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('business.f1')}
            </li>
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('business.f2')}
            </li>
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('business.f3')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('business.f4')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('business.f5')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('business.f6')}
            </li>
          </ul>
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
            className="w-full bg-white text-gray-900 rounded-lg py-3 px-4 font-bold hover:bg-gray-100 transition-colors mb-6 shadow-sm relative z-10 text-center flex justify-center items-center"
          >
            {t('contactSales')}
          </button>
          
          <p className="text-sm text-gray-300 mb-8 flex-1 relative z-10">
            {t('enterprise.desc')}
          </p>
          
          <ul className="space-y-4 text-sm text-gray-300 relative z-10">
            <li className="flex items-start font-medium text-white">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('enterprise.f1')}
            </li>
            <li className="flex items-start font-medium text-white">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('enterprise.f2')}
            </li>
            <li className="flex items-start font-medium text-white">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('enterprise.f3')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('enterprise.f4')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('enterprise.f5')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('enterprise.f6')}
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              {t('enterprise.f7')}
            </li>
          </ul>
        </div>

      </div>
      <EnterpriseLeadModal isOpen={isEnterpriseModalOpen} onClose={() => setEnterpriseModalOpen(false)} />
    </div>
  );
}
