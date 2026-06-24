"use client";
import React from 'react';
import { Lock } from 'lucide-react';
import { useTenant } from './TenantProvider';
import { hasAccess } from '@/lib/tierLogic';
import { useTranslations } from 'next-intl';

interface FeatureGuardProps {
    children: React.ReactNode;
    requiredTier: string;
    featureName?: string;
    className?: string;
}

export default function FeatureGuard({ children, requiredTier, featureName, className }: FeatureGuardProps) {
    const { selectedTenant, systemRole } = useTenant();
    const t = useTranslations('Common');
    const currentTier = (selectedTenant as any).tier || 'Essential';

    if (systemRole === 'SUPERADMIN' || hasAccess(currentTier, requiredTier)) {
        return (
            <div className={`h-full w-full ${className || ''}`}>
                {children}
            </div>
        );
    }

    return (
        <div className={`relative group cursor-not-allowed ${className || 'mb-1'}`}>
            <div className="opacity-40 grayscale pointer-events-none blur-[1px] transition-all h-full w-full">
                {children}
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <Lock className="w-5 h-5 text-gray-500/80 drop-shadow-md" />
            </div>
            <div className="absolute z-[100] bottom-full mb-2 right-0 w-48 px-3 py-2 text-xs font-medium text-white bg-gray-900 rounded-md shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity text-center whitespace-normal leading-tight">
                {t('tierRequired', { tier: requiredTier, feature: featureName || 'esta función' })}
                <div className="absolute top-full right-4 transform border-4 border-transparent border-t-gray-900"></div>
            </div>
        </div>
    );
}
