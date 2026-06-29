"use client";
import React from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { useTenant } from '@/components/TenantProvider';
import { isMockTenant } from '@/lib/mockData';

type Props = {
    show?: boolean;
    className?: string;
};

/**
 * Banner unificado para entornos DEMO / Mock.
 * - Si `show` se pasa, fuerza la visibilidad (útil cuando la API devuelve `data.mock === true`).
 * - Si no, detecta automáticamente sesión demo o tenant mock vía TenantProvider.
 * Texto centralizado en messages/*.json bajo namespace `Mock`.
 */
export default function MockBanner({ show, className }: Props) {
    const t = useTranslations('Mock');
    let auto = false;
    try {
        const { selectedTenant } = useTenant() as any;
        auto = isMockTenant(selectedTenant?.id || '');
    } catch {
        auto = false;
    }
    const visible = show ?? auto;
    if (!visible) return null;
    return (
        <div className={`bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-2 rounded-lg border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-sm mb-4 ${className ?? ''}`}>
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span><b>{t('badge')}:</b> {t('description')}</span>
        </div>
    );
}
