'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { Cloud, CheckCircle2 } from 'lucide-react';

export default function CloudAccountsPage() {
  const t = useTranslations('AdminCloudAccounts');
  const { selectedTenant } = useTenant();

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Cloud className="h-8 w-8" />
          {t('pageTitle')}
        </h1>
        <p className="text-gray-600 mt-2">
          {t('pageSubtitle')}
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8 shadow-sm">
        <div className="flex items-start justify-between mb-6 pb-6 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-sky-50 dark:bg-sky-950/50 border border-sky-100 dark:border-sky-900/50 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <Cloud className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                Microsoft Azure Tenant
                <span className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                  Active & Connected
                </span>
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Conexión directa mediante Azure Resource Graph y Cost Management API
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Tenant Organiazación</p>
            <p className="text-base font-bold text-gray-900 dark:text-white truncate">{selectedTenant?.name || 'Default Tenant'}</p>
            <p className="text-xs text-gray-400 font-mono mt-1">{selectedTenant?.id}</p>
          </div>
          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Plan / Tier Activo</p>
            <p className="text-base font-bold text-brand-deep dark:text-brand-bright">{selectedTenant?.tier || 'Essential'}</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">✓ FinOps Engine Ready</p>
          </div>
          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Estado de Ingesta</p>
            <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Sincronización OK
            </p>
            <p className="text-xs text-gray-400 mt-1">Línea de tiempo de costos en tiempo real</p>
          </div>
        </div>
      </div>
    </div>
  );
}
