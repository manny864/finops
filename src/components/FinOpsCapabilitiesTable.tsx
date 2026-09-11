'use client';

import React from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
  IconCheck,
  IconX,
  IconArrowLeft,
  IconSparkles,
  IconAward,
  IconStarFilled,
  IconShieldCheck,
  IconUsers,
  IconChartBar,
  IconReceipt,
  IconTrash,
  IconTags,
  IconCpu,
  IconServer,
  IconRobot,
  IconKey,
  IconHeadset,
  IconScale,
  IconLayersLinked,
  IconBrandAzure,
  IconLock,
  IconFileSpreadsheet,
  IconClock,
  IconBolt,
} from '@tabler/icons-react';

interface FinOpsCapabilitiesTableProps {
  onRevert?: () => void;
  onBack?: () => void;
  onClose: () => void;
  finopsUrl?: string;
  onSelectPro?: () => void;
  onSelectBusiness?: () => void;
  onSelectEnterprise?: () => void;
}

interface CapabilityRow {
  itemKey: string;
  icon: React.ReactNode;
  pro: boolean | string;
  business: boolean | string;
  enterprise: boolean | string;
}

interface CapabilityCategory {
  titleKey: string;
  rows: CapabilityRow[];
}

export function FinOpsCapabilitiesTable({
  onRevert,
  onBack,
  onClose,
  finopsUrl,
  onSelectPro,
  onSelectBusiness,
  onSelectEnterprise,
}: FinOpsCapabilitiesTableProps) {
  const t = useTranslations('finopsPopup');
  const locale = useLocale();
  const finopsLocale = locale === 'pt-BR' ? 'pt-BR' : locale === 'en' ? 'en' : 'es';
  const targetUrl = finopsUrl || `https://finops.cscloudsolutions.com.ar/${finopsLocale}/upgrade`;
  const handleRevert = onBack || onRevert || (() => {});

  const categories: CapabilityCategory[] = [
    {
      titleKey: 'categoryLimits',
      rows: [
        {
          itemKey: 'azureSubs',
          icon: <IconBrandAzure className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: 'val:upTo2',
          business: 'val:upTo3',
          enterprise: 'val:unlimited',
        },
        {
          itemKey: 'usersAccounts',
          icon: <IconUsers className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: 'val:upTo3Users',
          business: 'val:upTo5Users',
          enterprise: 'val:unlimitedUsers',
        },
        {
          itemKey: 'multiCurrency',
          icon: <IconReceipt className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: true,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'multiTenantDelegations',
          icon: <IconLayersLinked className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: true,
          enterprise: true,
        },
      ],
    },
    {
      titleKey: 'categoryVisibility',
      rows: [
        {
          itemKey: 'whiteboard',
          icon: <IconChartBar className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: true,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'costHistory',
          icon: <IconClock className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: true,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'realConsumption',
          icon: <IconChartBar className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: true,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'costGroups',
          icon: <IconScale className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'focusExport',
          icon: <IconFileSpreadsheet className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: true,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'finopsMaturity',
          icon: <IconAward className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: true,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'executiveReport',
          icon: <IconFileSpreadsheet className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'sharedCostAllocation',
          icon: <IconScale className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
      ],
    },
    {
      titleKey: 'categoryZombies',
      rows: [
        {
          itemKey: 'zombieResources',
          icon: <IconTrash className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: 'val:detectionOnly',
          business: 'val:detectionRemediation',
          enterprise: 'val:detectionRemediationBlock',
        },
        {
          itemKey: 'zombieNetworking',
          icon: <IconServer className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: 'val:detectionOnly',
          business: 'val:detectionRemediation',
          enterprise: 'val:detectionRemediationBlock',
        },
        {
          itemKey: 'tagCompliance',
          icon: <IconTags className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: 'val:auditOnly',
          business: 'val:auditRemediation',
          enterprise: 'val:auditRemediationBlock',
        },
        {
          itemKey: 'autoPowerSchedules',
          icon: <IconBolt className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'ttlExpirations',
          icon: <IconClock className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'expiringCredentials',
          icon: <IconKey className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: true,
          enterprise: true,
        },
      ],
    },
    {
      titleKey: 'categoryOptimization',
      rows: [
        {
          itemKey: 'rightsizing',
          icon: <IconCpu className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: 'val:basicRecommendations',
          business: true,
          enterprise: 'val:advancedRightsizingCode',
        },
        {
          itemKey: 'savingsPlansVsRis',
          icon: <IconScale className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'hybridBenefit',
          icon: <IconAward className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'zeroCostInventory',
          icon: <IconReceipt className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'whatIfScenarios',
          icon: <IconSparkles className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'teamScorecard',
          icon: <IconAward className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'storageComputeEfficiency',
          icon: <IconServer className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'maccTracking',
          icon: <IconChartBar className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
      ],
    },
    {
      titleKey: 'categoryAks',
      rows: [
        {
          itemKey: 'aksControl',
          icon: <IconServer className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'aksChargeback',
          icon: <IconScale className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'unitEconomics',
          icon: <IconReceipt className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
      ],
    },
    {
      titleKey: 'categoryAi',
      rows: [
        {
          itemKey: 'finopsCopilot',
          icon: <IconRobot className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: true,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'zScoreAnomalies',
          icon: <IconSparkles className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'aiCostAnalytics',
          icon: <IconCpu className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'm365CopilotCost',
          icon: <IconRobot className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'mcpApiKeys',
          icon: <IconKey className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
      ],
    },
    {
      titleKey: 'categoryGovernance',
      rows: [
        {
          itemKey: 'actionCenter',
          icon: <IconCheck className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: 'val:readOnly',
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'policiesAsCode',
          icon: <IconShieldCheck className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'auditTrail',
          icon: <IconClock className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: true,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'mfaMandatory',
          icon: <IconLock className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: true,
          business: true,
          enterprise: true,
        },
        {
          itemKey: 'notificationChannels',
          icon: <IconBolt className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: true,
          business: true,
          enterprise: true,
        },
      ],
    },
    {
      titleKey: 'categoryIntegrations',
      rows: [
        {
          itemKey: 'lighthouseOnboarding',
          icon: <IconBrandAzure className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'cspBillingMarkup',
          icon: <IconReceipt className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'powerBiFocus',
          icon: <IconChartBar className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'powerBiInvoicing',
          icon: <IconFileSpreadsheet className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'ssoFederation',
          icon: <IconKey className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'publicRestApi',
          icon: <IconLayersLinked className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'azureKeyVault',
          icon: <IconLock className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
        {
          itemKey: 'marketplaceBilling',
          icon: <IconBrandAzure className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: true,
        },
      ],
    },
    {
      titleKey: 'categorySupport',
      rows: [
        {
          itemKey: 'supportTickets',
          icon: <IconHeadset className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: 'val:tickets20',
          business: 'val:unlimited',
          enterprise: 'val:unlimited',
        },
        {
          itemKey: 'slaResponse',
          icon: <IconClock className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: 'val:sla24h',
          business: 'val:sla8h',
          enterprise: 'val:sla4h',
        },
        {
          itemKey: 'dedicatedSupport',
          icon: <IconShieldCheck className="w-4.5 h-4.5 text-white" stroke={1.75} />,
          pro: false,
          business: false,
          enterprise: 'val:dedicated247',
        },
      ],
    },
  ];

  const renderCellContent = (value: boolean | string) => {
    if (typeof value === 'string') {
      const displayValue = value.startsWith('val:')
        ? t(`matrix.values.${value.replace('val:', '')}`)
        : value;
      return (
        <span className="text-xs sm:text-sm font-semibold text-slate-800 tracking-tight">
          {displayValue}
        </span>
      );
    }
    if (value === true) {
      return (
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#0054A6] text-white shadow-2xs"
          aria-label={t('matrix.included')}
        >
          <IconCheck className="w-4 h-4 text-white" stroke={3} />
        </span>
      );
    }
    return <span className="text-slate-300 font-light text-base select-none">—</span>;
  };

  return (
    <div className="fixed inset-0 z-[120] w-screen h-screen bg-white overflow-y-auto text-slate-900 font-sans flex flex-col custom-scrollbar animate-in fade-in zoom-in-98 duration-200">
      {/* 1. Header Fijo Superior */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-8 py-3.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRevert}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs sm:text-sm font-bold transition-all shadow-2xs hover:shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
            title={t('revertToCards')}
          >
            <IconArrowLeft className="w-4 h-4 text-slate-700" stroke={2.5} />
            <span>{t('revertToCards')}</span>
          </button>

          <div className="hidden sm:block h-5 w-px bg-slate-200 mx-1" />

          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              CSCloudSolutions
            </span>
            <span className="text-slate-300">•</span>
            <h1 className="text-sm font-bold text-slate-900">{t('fullscreenTitle')}</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-xs sm:text-sm font-bold text-white bg-[color:var(--navy)] hover:bg-[#002244] transition-all shadow-sm hover:shadow-md cursor-pointer"
          >
            {t('popupCta')}
          </a>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-colors focus:outline-none cursor-pointer"
            aria-label={t('fullscreenClose')}
          >
            <IconX className="w-5 h-5 text-slate-600" stroke={2.2} />
          </button>
        </div>
      </header>

      {/* 2. Hero / Introducción de la Matriz */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-8 pt-8 pb-4">
        <div className="text-left sm:text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-800 text-xs font-bold mb-3">
            <IconSparkles className="w-3.5 h-3.5 text-blue-600" stroke={2} />
            <span>{t('matrix.badge')}</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            {t('fullscreenTitle')}
          </h2>
          <p className="mt-2 text-sm sm:text-base text-slate-600 leading-relaxed">
            {t('fullscreenSubtitle')}
          </p>
        </div>
      </div>

      {/* 3. Tabla Comparativa estilo Microsoft 365 */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-8 pb-16 flex-1">
        <div className="overflow-x-auto border-t border-slate-200">
          <table className="w-full text-left border-collapse">
            {/* Cabecera de Columnas / Planes */}
            <thead className="sticky top-[57px] z-30 bg-white/95 backdrop-blur-md shadow-xs border-b border-slate-200">
              <tr>
                <th className="py-5 px-4 w-[38%] text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {t('matrix.capabilitiesHeader')}
                </th>

                {/* Columna Professional */}
                <th className="py-5 px-4 w-[20%] text-center align-top">
                  <div className="flex flex-col items-center">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 mb-1">
                      <IconAward className="w-3 h-3 text-blue-700" />
                      {t('pro.badge')}
                    </span>
                    <span className="text-base sm:text-lg font-extrabold text-slate-900">
                      {t('pro.name')}
                    </span>
                    <span className="text-[11px] text-emerald-600 font-semibold mt-0.5">
                      {t('pro.trial')}
                    </span>
                    {onSelectPro && (
                      <button
                        type="button"
                        onClick={onSelectPro}
                        className="mt-2.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#0054A6] bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors shadow-2xs cursor-pointer"
                      >
                        {t('pro.name')} - Demo
                      </button>
                    )}
                  </div>
                </th>

                {/* Columna Business */}
                <th className="py-5 px-4 w-[21%] text-center align-top bg-slate-50/50">
                  <div className="flex flex-col items-center">
                    <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 mb-1">
                      <IconStarFilled className="w-3 h-3 text-amber-500" />
                      {t('business.badge')}
                    </span>
                    <span className="text-base sm:text-lg font-extrabold text-slate-900">
                      {t('business.name')}
                    </span>
                    <span className="text-[11px] text-slate-500 mt-0.5">
                      {t('matrix.businessTarget')}
                    </span>
                    {onSelectBusiness && (
                      <button
                        type="button"
                        onClick={onSelectBusiness}
                        className="mt-2.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#0054A6] hover:bg-[#003B75] transition-colors shadow-2xs cursor-pointer"
                      >
                        {t('business.name')}
                      </button>
                    )}
                  </div>
                </th>

                {/* Columna Enterprise */}
                <th className="py-5 px-4 w-[21%] text-center align-top">
                  <div className="flex flex-col items-center">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-300 mb-1">
                      <IconShieldCheck className="w-3 h-3 text-slate-700" />
                      {t('enterprise.badge')}
                    </span>
                    <span className="text-base sm:text-lg font-extrabold text-slate-900">
                      {t('enterprise.name')}
                    </span>
                    <span className="text-[11px] text-slate-500 mt-0.5">
                      {t('matrix.enterpriseTarget')}
                    </span>
                    {onSelectEnterprise && (
                      <button
                        type="button"
                        onClick={onSelectEnterprise}
                        className="mt-2.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#0F172A] hover:bg-[#1E293B] transition-colors shadow-2xs cursor-pointer"
                      >
                        {t('enterprise.name')}
                      </button>
                    )}
                  </div>
                </th>
              </tr>
            </thead>

            {/* Cuerpo con categorías agrupadas */}
            <tbody className="divide-y divide-slate-200">
              {categories.map((cat, catIdx) => (
                <React.Fragment key={catIdx}>
                  {/* Encabezado de Categoría */}
                  <tr className="bg-slate-100/70 border-t-2 border-slate-300">
                    <td
                      colSpan={4}
                      className="py-3 px-4 text-xs font-extrabold uppercase tracking-wider text-slate-700 font-heading"
                    >
                      {t(cat.titleKey)}
                    </td>
                  </tr>

                  {/* Filas de la Categoría */}
                  {cat.rows.map((row, rowIdx) => (
                    <tr
                      key={rowIdx}
                      className="hover:bg-slate-50/80 transition-colors border-b border-slate-200"
                    >
                      {/* Columna de la Característica (Ícono + Nombre traducido) */}
                      <td className="py-4 px-4 text-slate-900">
                        <div className="flex items-center gap-3.5">
                          <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-[#0054A6] text-white shadow-2xs [&>svg]:text-white [&>svg]:stroke-white">
                            {row.icon}
                          </span>
                          <span className="text-xs sm:text-sm font-medium text-slate-800 leading-snug">
                            {t(`matrix.items.${row.itemKey}`)}
                          </span>
                        </div>
                      </td>

                      {/* Professional */}
                      <td className="py-4 px-4 text-center align-middle">
                        {renderCellContent(row.pro)}
                      </td>

                      {/* Business */}
                      <td className="py-4 px-4 text-center align-middle bg-slate-50/40">
                        {renderCellContent(row.business)}
                      </td>

                      {/* Enterprise */}
                      <td className="py-4 px-4 text-center align-middle">
                        {renderCellContent(row.enterprise)}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* 4. Footer de la Pantalla Completa */}
        <div className="mt-12 pt-8 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleRevert}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-bold shadow-xs hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
          >
            <IconArrowLeft className="w-4 h-4 text-slate-700" stroke={2.5} />
            <span>{t('revertToCards')}</span>
          </button>

          <div className="flex flex-col items-center sm:items-end gap-2 text-center sm:text-right">
            <a
              href={targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-xl text-sm font-extrabold text-white bg-gradient-to-r from-[color:var(--navy)] to-[#0054A6] hover:from-[#002244] hover:to-[color:var(--navy)] transition-all shadow-md hover:shadow-lg focus:outline-none cursor-pointer"
            >
              {t('popupCta')}
            </a>
            <p className="inline-flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <IconLock className="w-3.5 h-3.5 text-slate-400" stroke={2} />
              <span>{t('trustBadge')}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
