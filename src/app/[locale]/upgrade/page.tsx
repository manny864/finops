"use client";
import React from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useRouter } from 'next/navigation';
import PricingPage from '@/components/PricingPage';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function UpgradePage() {
  const { selectedTenant } = useTenant();
  const router = useRouter();
  const t = useTranslations('pricing');

  return (
    <div className="relative">
        <button 
            onClick={() => router.back()} 
            className="absolute top-6 left-8 z-10 flex items-center text-sm font-semibold text-gray-500 hover:text-brand-deep transition-colors bg-white/80 px-4 py-2 rounded-full shadow-sm backdrop-blur-sm border border-gray-100"
        >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('backToDashboard')}
        </button>
        <PricingPage 
            hideLogin={true} 
            tenantId={selectedTenant?.id} 
        />
    </div>
  );
}
