const fs = require('fs');

const code = `import React, { useState } from 'react';
import { useMsal } from '@azure/msal-react';

interface PricingPageProps {
  onLoginClick?: () => void;
}

export default function PricingPage({ onLoginClick }: PricingPageProps) {
  const { instance } = useMsal();
  const [isAnnual, setIsAnnual] = useState(false);

  const handleSignUp = (plan: string) => {
    sessionStorage.setItem('pendingUpgrade', plan);
    if (onLoginClick) {
      onLoginClick();
    } else {
      instance.loginRedirect({ scopes: ["User.Read", "Directory.Read.All"] }).catch(e => console.error(e));
    }
  };

  const getCheckoutLink = (plan: string) => {
    if (plan === 'free') {
        return isAnnual ? process.env.NEXT_PUBLIC_LS_ESSENTIAL_YEARLY : process.env.NEXT_PUBLIC_LS_ESSENTIAL_MONTHLY;
    }
    if (plan === 'pro') {
        return isAnnual ? process.env.NEXT_PUBLIC_LS_PRO_YEARLY : process.env.NEXT_PUBLIC_LS_PRO_MONTHLY;
    }
    if (plan === 'business') {
        return isAnnual ? process.env.NEXT_PUBLIC_LS_BUSINESS_YEARLY : process.env.NEXT_PUBLIC_LS_BUSINESS_MONTHLY;
    }
    return "#";
  };

  const getPrice = (monthly: number) => {
    if (!isAnnual) return \`\${monthly}\`;
    return \`\${(monthly * 0.88).toFixed(2)}\`;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans py-16 px-4 sm:px-6 lg:px-8">
      {/* Top Right Login Link */}
      <div className="absolute top-6 right-8">
        <span className="text-sm font-medium text-gray-500 mr-2">Already have an account?</span>
        <button 
          onClick={() => handleSignUp('free')}
          className="text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors"
        >
          Log in
        </button>
      </div>

      <div className="max-w-7xl mx-auto text-center mt-8 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h2 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight font-heading">
          Simple, Fixed Pricing
        </h2>
        <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
          Whether you're a startup or Enterprise, we have simple, fixed-rate plans that don't contribute to your cost problems.
        </p>
      </div>

      {/* Toggle */}
      <div className="flex justify-center items-center mb-16">
        <span className={\`text-sm font-medium \${!isAnnual ? 'text-gray-900' : 'text-gray-500'}\`}>Mensual</span>
        <button 
          onClick={() => setIsAnnual(!isAnnual)}
          className="mx-4 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-deep focus:ring-offset-2"
          style={{ backgroundColor: isAnnual ? '#0054A6' : '#D1D5DB' }}
        >
          <span 
            className={\`inline-block h-4 w-4 transform rounded-full bg-white transition-transform \${isAnnual ? 'translate-x-6' : 'translate-x-1'}\`}
          />
        </button>
        <span className={\`text-sm font-medium flex items-center \${isAnnual ? 'text-gray-900' : 'text-gray-500'}\`}>
          Anual
          <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
            Ahorra 12%
          </span>
        </span>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 animate-in fade-in zoom-in-95 duration-700 delay-150">
        
        {/* Essential */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col hover:shadow-md transition-shadow">
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900">Essential (Starter)</h3>
            <div className="mt-4 flex items-baseline text-5xl font-extrabold text-gray-900">
              \${getPrice(9.99)}
              <span className="text-lg font-medium text-gray-500 ml-1">/mes</span>
            </div>
            {isAnnual && (
              <div className="text-sm text-gray-500 line-through mt-1">$9.99/mes</div>
            )}
          </div>
          
          <a 
            href={getCheckoutLink('free') || '#'}
            className="w-full bg-gray-800 text-white rounded-lg py-3 px-4 font-semibold hover:bg-gray-900 transition-colors mb-6 text-center inline-block"
          >
            Comprar / Buy Now
          </a>
          
          <p className="text-sm text-gray-500 mb-8 flex-1">
            Para empresas que recién empiezan a preocuparse por sus costos en Azure.
          </p>
          
          <ul className="space-y-4 text-sm text-gray-600">
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              1 Suscripción soportada
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Dashboard interactivo (Consumo, Ahorro, CO2)
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Detección de Recursos Zombies básica
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Análisis de instancias (Rightsizing via Advisor)
            </li>
            <li className="flex items-start text-gray-400">
              <svg className="w-4 h-4 text-gray-300 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              Solo Lectura
            </li>
          </ul>
        </div>

        {/* Professional */}
        <div className="bg-white rounded-2xl shadow-xl border-2 border-brand-deep p-8 flex flex-col relative transform md:-translate-y-4">
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <span className="bg-brand-deep text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
              Recomendado
            </span>
          </div>
          
          <div className="mb-6 flex items-center justify-between mt-2">
            <h3 className="text-xl font-bold text-brand-deep">Professional</h3>
            <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded animate-pulse">
              14-Day Free Trial
            </span>
          </div>
          <div className="mb-6">
            <div className="flex items-baseline text-5xl font-extrabold text-gray-900">
              \${getPrice(99.99)}
              <span className="text-lg font-medium text-gray-500 ml-1">/mes</span>
            </div>
            {isAnnual && (
              <div className="text-sm text-gray-500 line-through mt-1">$99.99/mes</div>
            )}
          </div>
          
          <a 
            href={getCheckoutLink('pro') || '#'}
            className="w-full bg-gradient-to-r from-brand-deep to-[#1E88E5] text-white rounded-lg py-3 px-4 font-semibold hover:brightness-110 transition-colors mb-6 shadow-md text-center inline-block"
          >
            Try Now for 14 Days
          </a>
          
          <p className="text-sm text-gray-500 mb-8 flex-1">
            Para empresas medianas que necesitan entender tendencias y reportar.
          </p>
          
          <ul className="space-y-4 text-sm text-gray-600">
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-brand-deep mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Todo lo del plan Essential
            </li>
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-brand-deep mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Max 5 users
            </li>
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-brand-deep mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Hasta 5 Suscripciones soportadas
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Módulo BI (Preset.io / Superset)
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Copilot IA (Consultas limitadas a Gemini)
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Alertas Proactivas de consumo
            </li>
          </ul>
        </div>

        {/* Business */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col hover:shadow-md transition-shadow">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Business</h3>
            <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded">
              14-Day Free Trial
            </span>
          </div>
          <div className="mb-6">
            <div className="flex items-baseline text-5xl font-extrabold text-gray-900">
              \${getPrice(299)}
              <span className="text-lg font-medium text-gray-500 ml-1">/mes</span>
            </div>
            {isAnnual && (
              <div className="text-sm text-gray-500 line-through mt-1">$299/mes</div>
            )}
          </div>
          
          <a 
            href={getCheckoutLink('business') || '#'}
            className="w-full bg-gray-800 text-white rounded-lg py-3 px-4 font-semibold hover:bg-gray-900 transition-colors mb-6 text-center inline-block"
          >
            Try Now for 14 Days
          </a>
          
          <p className="text-sm text-gray-500 mb-8 flex-1">
            Automatización básica y múltiples entornos para empresas en crecimiento.
          </p>
          
          <ul className="space-y-4 text-sm text-gray-600">
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Todo lo del plan Professional
            </li>
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Max 20 users
            </li>
            <li className="flex items-start font-medium text-gray-900">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Hasta 20 Suscripciones soportadas
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Gestión Avanzada de Etiquetas (Tags)
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Copilot IA Expandido
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-blue-500 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Auditoría básica de licencias
            </li>
          </ul>
        </div>

        {/* Enterprise */}
        <div className="bg-gray-900 rounded-2xl shadow-lg border border-gray-700 p-8 flex flex-col hover:shadow-xl transition-shadow relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-8 -mt-8 w-24 h-24 bg-brand-deep rounded-full opacity-20 blur-xl"></div>
          
          <div className="mb-6 flex items-center justify-between relative z-10">
            <h3 className="text-lg font-medium text-white">Enterprise</h3>
            <span className="bg-brand-bright/20 text-brand-bright text-xs font-semibold px-2 py-1 rounded">Control Total</span>
          </div>
          <div className="mb-6 relative z-10">
            <div className="flex items-baseline text-4xl font-extrabold text-white mt-2 mb-2">
              Precio Personalizado
            </div>
          </div>
          
          <a 
            href="https://cscloudsolutions.com.ar/#contacto"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full bg-white text-gray-900 rounded-lg py-3 px-4 font-bold hover:bg-gray-100 transition-colors mb-6 shadow-sm relative z-10 text-center flex justify-center items-center"
          >
            Contact Sales
          </a>
          
          <p className="text-sm text-gray-300 mb-8 flex-1 relative z-10">
            Para corporaciones con topologías complejas (Hub & Spoke).
          </p>
          
          <ul className="space-y-4 text-sm text-gray-300 relative z-10">
            <li className="flex items-start font-medium text-white">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Todo lo del plan Business
            </li>
            <li className="flex items-start font-medium text-white">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Unlimited users
            </li>
            <li className="flex items-start font-medium text-white">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Unlimited Subscriptions
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Action Center (Remediación 1-Click)
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Power Schedules (Apagado de VMs)
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Auditoría AHUB profunda
            </li>
            <li className="flex items-start">
              <svg className="w-4 h-4 text-brand-bright mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              Copilot IA Ilimitado
            </li>
          </ul>
        </div>

      </div>
    </div>
  );
}
`;

fs.writeFileSync('src/components/PricingPage.tsx', code);
console.log('PricingPage.tsx updated successfully');
