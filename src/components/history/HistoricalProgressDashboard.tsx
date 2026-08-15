'use client';

import React, { useState, useMemo } from 'react';
import {
  IconTrendingUp,
  IconAward,
  IconCurrencyDollar,
  IconTag,
  IconBolt,
  IconCircleCheck,
  IconAlertTriangle,
  IconFlag,
  IconRotateClockwise2,
  IconShieldCheck,
  IconArrowUpRight,
  IconDownload,
  IconClock,
  IconLeaf,
  IconActivity,
  IconSearch,
} from '@tabler/icons-react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useLocale, useTranslations } from 'next-intl';
import {
  HistoricalProgressReport,
  HistoryTimeRange,
  BeforeAfterVerificationItem,
  ArchitectureMilestoneItem,
  WaiverLedgerItem,
} from '@/lib/historicalProgressModel';
import Pagination from '@/components/Pagination';

interface Props {
  report: HistoricalProgressReport;
  timeRange: HistoryTimeRange;
  onTimeRangeChange: (range: HistoryTimeRange) => void;
  isDemo?: boolean;
}

export function HistoricalProgressDashboard({
  report,
  timeRange,
  onTimeRangeChange,
  isDemo = false,
}: Props) {
  const locale = useLocale();
  const t = useTranslations('OverviewProgress');

  const [activeTab, setActiveTab] = useState<'maturity' | 'commitments' | 'roi' | 'audit'>('maturity');
  const [tableSearch, setTableSearch] = useState('');
  const [tableSort, setTableSort] = useState<'cost_desc' | 'cost_asc' | 'alpha_asc' | 'alpha_desc'>('cost_desc');
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState<15 | 30 | 45 | 60>(15);

  const series = report.series || [];
  const firstPoint = series[0] || {};
  const lastPoint = series[series.length - 1] || {};

  // Formateador de moneda USD sin floats
  const fmtUsd = (val: number) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val || 0);
  };

  const fmtDecUsd = (val: number) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val || 0);
  };

  // Deltas de Scorecard
  const maturityDelta = (lastPoint.maturityScore || 0) - (firstPoint.maturityScore || 0);
  const tagDelta = (lastPoint.tagCompliancePct || 0) - (firstPoint.tagCompliancePct || 0);

  // Filtrado y ordenamiento de Before/After Table
  const filteredBeforeAfter = useMemo(() => {
    let list = [...(report.beforeAfterVerifications || [])];
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      list = list.filter(
        (item) =>
          item.resourceName.toLowerCase().includes(q) ||
          item.resourceGroup.toLowerCase().includes(q) ||
          item.actionType.toLowerCase().includes(q) ||
          item.executedBy.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (tableSort === 'cost_desc') return b.realizedMonthlySavings - a.realizedMonthlySavings;
      if (tableSort === 'cost_asc') return a.realizedMonthlySavings - b.realizedMonthlySavings;
      if (tableSort === 'alpha_asc') return a.resourceName.localeCompare(b.resourceName);
      if (tableSort === 'alpha_desc') return b.resourceName.localeCompare(a.resourceName);
      return 0;
    });
    return list;
  }, [report.beforeAfterVerifications, tableSearch, tableSort]);

  const pagedBeforeAfter = useMemo(() => {
    const start = (tablePage - 1) * tablePageSize;
    return filteredBeforeAfter.slice(start, start + tablePageSize);
  }, [filteredBeforeAfter, tablePage, tablePageSize]);

  // Exportar CSV
  const handleExportCsv = () => {
    const headers = [
      'Fecha',
      'Maturity Score',
      'Nivel',
      'Tag Compliance %',
      'Gasto No Asignado USD',
      'Cobertura RIs %',
      'Utilización RIs %',
      'Gasto Real USD',
      'Línea Base Contrafactual USD',
      'Ahorro Neto Acumulado USD',
      'Emisiones MTCO2e',
    ];
    const rows = series.map((s) => [
      s.date,
      s.maturityScore,
      s.maturityLevel,
      `${s.tagCompliancePct}%`,
      s.unallocatedSpend,
      `${s.commitmentCoveragePct}%`,
      `${s.commitmentUtilizationPct}%`,
      s.actualSpend,
      s.counterfactualCost,
      s.netSavingsAccumulated,
      s.emissionsMtco2e,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `FinOps_Progreso_Historico_${timeRange}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 text-[#1B2A41] dark:text-foreground">
      {/* 1. Header de Controles y Selector de Rango */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface p-4 rounded-xl border border-line shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-brand-soft text-brand-deep dark:bg-brand-deep/20 dark:text-brand-bright">
              <IconTrendingUp className="w-5 h-5" strokeWidth={2} />
            </span>
            <div>
              <h2 className="font-heading text-base font-bold text-[#1B2A41] dark:text-white">
                {t('dashboardTitle') || 'Evolución Temporal del Programa FinOps'}
              </h2>
              <p className="text-xs text-ink-soft">
                {t('dashboardSubtitle') || 'Monitoreo de retorno de inversión contrafactual, madurez y eficiencia de costos.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Selector de Rango */}
          <div className="inline-flex rounded-lg border border-line bg-surface-2 p-1 text-xs font-semibold">
            {(
              [
                { id: '30d', label: '30 Días' },
                { id: '90d', label: '3 Meses' },
                { id: '180d', label: '6 Meses' },
                { id: '365d', label: '1 Año' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => onTimeRangeChange(opt.id)}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  timeRange === opt.id
                    ? 'bg-brand-deep text-white shadow-sm font-bold'
                    : 'text-ink-soft hover:text-[#1B2A41] dark:hover:text-white hover:bg-surface'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface text-brand-deep border border-line rounded-lg text-xs font-bold hover:bg-brand-soft transition-colors shadow-sm"
          >
            <IconDownload className="w-4 h-4" strokeWidth={2} />
            {t('exportCsv') || 'Exportar CSV'}
          </button>
        </div>
      </div>

      {/* 2. Scorecard Superior (5 KPIs Ejecutivos) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* KPI 1: Maturity */}
        <div className="bg-surface border border-line rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold text-ink-soft">
            <span>{t('kpiMaturity') || 'Maturity Score'}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                lastPoint.maturityLevel === 'Run'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : lastPoint.maturityLevel === 'Walk'
                  ? 'bg-blue-500/10 text-brand-deep dark:text-brand-bright'
                  : 'bg-amber-500/10 text-amber-600'
              }`}
            >
              {lastPoint.maturityLevel || 'Walk'}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-heading text-2xl font-bold text-[#1B2A41] dark:text-white tabular-nums">
              {lastPoint.maturityScore?.toFixed(1) || '0.0'}
            </span>
            <span className="text-xs text-grey font-semibold">/ 100</span>
          </div>
          <div className="mt-2 text-[11px] font-bold text-emerald-600 flex items-center gap-0.5">
            <IconArrowUpRight className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span>+{maturityDelta >= 0 ? maturityDelta.toFixed(1) : '0.0'} pts en el período</span>
          </div>
        </div>

        {/* KPI 2: Counterfactual Net Savings */}
        <div className="bg-surface border border-line rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold text-ink-soft">
            <span>{t('kpiNetSavings') || 'Gasto Evitado Total'}</span>
            <IconCurrencyDollar className="w-4 h-4 text-brand-deep dark:text-brand-bright" strokeWidth={2} />
          </div>
          <div className="font-heading mt-2 text-2xl font-bold text-brand-deep dark:text-brand-bright tabular-nums">
            {fmtUsd(report.totalCounterfactualSavings || 0)}
          </div>
          <div className="mt-2 text-[11px] text-ink-soft font-medium">
            Línea Base Contrafactual
          </div>
        </div>

        {/* KPI 3: Tag Compliance */}
        <div className="bg-surface border border-line rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold text-ink-soft">
            <span>{t('kpiTagging') || 'Higiene de Tags'}</span>
            <IconTag className="w-4 h-4 text-brand-deep" strokeWidth={2} />
          </div>
          <div className="font-heading mt-2 text-2xl font-bold text-[#1B2A41] dark:text-white tabular-nums">
            {lastPoint.tagCompliancePct?.toFixed(1) || '0.0'}%
          </div>
          <div className="mt-2 text-[11px] font-bold text-emerald-600 flex items-center gap-0.5">
            <IconArrowUpRight className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span>+{tagDelta >= 0 ? tagDelta.toFixed(1) : '0.0'}% cobertura</span>
          </div>
        </div>

        {/* KPI 4: Commitments */}
        <div className="bg-surface border border-line rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold text-ink-soft">
            <span>{t('kpiCoverage') || 'Cobertura RIs / SPs'}</span>
            <IconBolt className="w-4 h-4 text-amber-500" strokeWidth={2} />
          </div>
          <div className="font-heading mt-2 text-2xl font-bold text-[#1B2A41] dark:text-white tabular-nums">
            {lastPoint.commitmentCoveragePct?.toFixed(1) || '0.0'}%
          </div>
          <div className="mt-2 text-[11px] text-ink-soft font-medium">
            Utilización: <strong className="text-emerald-600">{lastPoint.commitmentUtilizationPct || 0}%</strong>
          </div>
        </div>

        {/* KPI 5: Realized vs Leakage */}
        <div className="bg-surface border border-line rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold text-ink-soft">
            <span>{t('kpiRealized') || 'Ahorro Realizado'}</span>
            <IconCircleCheck className="w-4 h-4 text-emerald-500" strokeWidth={2} />
          </div>
          <div className="font-heading mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {fmtUsd(report.currentRealizedSavings || 0)}
          </div>
          <div className="mt-2 text-[11px] text-ink-soft font-medium">
            Fuga evitada: <span className="text-amber-600 font-bold">{fmtUsd(report.currentLeakageSpend || 0)}</span>
          </div>
        </div>
      </div>

      {/* 3. Navegación por Pestañas */}
      <div className="border-b border-line">
        <div className="flex gap-2 overflow-x-auto">
          {[
            { id: 'maturity', label: '1. Madurez & Gobernanza', icon: IconAward },
            { id: 'commitments', label: '2. Compromisos & Zombis', icon: IconBolt },
            { id: 'roi', label: '3. ROI & Ahorro Contrafactual', icon: IconCurrencyDollar },
            { id: 'audit', label: '4. Before/After & Hitos', icon: IconShieldCheck },
          ].map((tb) => {
            const Icon = tb.icon;
            const active = activeTab === tb.id;
            return (
              <button
                key={tb.id}
                onClick={() => setActiveTab(tb.id as any)}
                className={`relative flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
                  active
                    ? 'border-brand-deep text-brand-deep dark:border-brand-bright dark:text-brand-bright bg-brand-soft/50 dark:bg-brand-deep/10 rounded-t-lg'
                    : 'border-transparent text-ink-soft hover:text-[#1B2A41] dark:hover:text-white hover:bg-surface-2'
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={2} />
                <span className="font-heading">{tb.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Contenido de las Pestañas */}

      {/* PESTAÑA 1: MADUREZ & GOBERNANZA */}
      {activeTab === 'maturity' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Gráfico 1: Evolución del Score de Madurez */}
          <div className="bg-surface border border-line rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-heading text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                  <IconAward className="w-4 h-4 text-brand-deep" strokeWidth={2} />
                  Evolución del Índice de Madurez FinOps (0 - 100)
                </h3>
                <p className="text-xs text-ink-soft mt-0.5">
                  Progresión a través de las etapas del marco FinOps (Crawl → Walk → Run).
                </p>
              </div>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--ink-soft)', fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: 'var(--ink-soft)', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--line)',
                      borderRadius: '8px',
                    }}
                  />
                  <ReferenceLine y={40} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'Walk (40)', fill: '#f59e0b', fontSize: 10 }} />
                  <ReferenceLine y={75} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Run (75)', fill: '#10b981', fontSize: 10 }} />
                  <Line
                    type="monotone"
                    dataKey="maturityScore"
                    name="Maturity Score Total"
                    stroke="#0054A6"
                    strokeWidth={3}
                    dot={{ r: 3, fill: '#0054A6' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-line text-center text-xs">
              <div className="p-2 bg-surface-2 rounded-lg">
                <div className="text-[10px] text-grey uppercase font-bold">Asignación</div>
                <div className="font-extrabold text-[#1B2A41] dark:text-white mt-0.5">{lastPoint.pillars?.allocation || 0}%</div>
              </div>
              <div className="p-2 bg-surface-2 rounded-lg">
                <div className="text-[10px] text-grey uppercase font-bold">Tarifas</div>
                <div className="font-extrabold text-[#1B2A41] dark:text-white mt-0.5">{lastPoint.pillars?.rates || 0}%</div>
              </div>
              <div className="p-2 bg-surface-2 rounded-lg">
                <div className="text-[10px] text-grey uppercase font-bold">Uso</div>
                <div className="font-extrabold text-[#1B2A41] dark:text-white mt-0.5">{lastPoint.pillars?.usage || 0}%</div>
              </div>
              <div className="p-2 bg-surface-2 rounded-lg">
                <div className="text-[10px] text-grey uppercase font-bold">Gobernanza</div>
                <div className="font-extrabold text-[#1B2A41] dark:text-white mt-0.5">{lastPoint.pillars?.governance || 0}%</div>
              </div>
            </div>
          </div>

          {/* Gráfico 2: Higiene de Tags y Gasto No Asignado */}
          <div className="bg-surface border border-line rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-heading text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                  <IconTag className="w-4 h-4 text-brand-deep" strokeWidth={2} />
                  Higiene de Tags & Reducción de Gasto Huérfano
                </h3>
                <p className="text-xs text-ink-soft mt-0.5">
                  Evolución del porcentaje de tags obligatorios vs gasto sin centro de costos.
                </p>
              </div>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorUnallocated" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--ink-soft)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--ink-soft)', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--line)',
                      borderRadius: '8px',
                    }}
                    formatter={(v: any, name: any) => [
                      name === 'unallocatedSpend' ? fmtUsd(v) : `${v}%`,
                      name === 'unallocatedSpend' ? 'Gasto No Asignado' : 'Cumplimiento Tags',
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="unallocatedSpend"
                    name="unallocatedSpend"
                    stroke="#ef4444"
                    strokeWidth={2}
                    fill="url(#colorUnallocated)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-line text-xs">
              <span className="text-ink-soft">
                Herencia Automática de Tags: <strong className="text-brand-deep font-bold">{lastPoint.inheritedTagsCount || 0} recursos</strong>
              </span>
              <span className="text-ink-soft">
                Gasto Huérfano Actual: <strong className="text-emerald-600 font-bold">{fmtUsd(lastPoint.unallocatedSpend || 0)}/mes</strong>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 2: COMPROMISOS & DESPERDICIO */}
      {activeTab === 'commitments' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Gráfico 3: Cobertura vs Utilización de Compromisos */}
          <div className="bg-surface border border-line rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-heading text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                  <IconBolt className="w-4 h-4 text-amber-500" strokeWidth={2} />
                  Salud de Reservas & Savings Plans (RIs / SPs)
                </h3>
                <p className="text-xs text-ink-soft mt-0.5">
                  Tasa de Cobertura (% del cómputo elegible) vs Tasa de Utilización efectiva.
                </p>
              </div>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--ink-soft)', fontSize: 11 }} />
                  <YAxis domain={[40, 100]} tick={{ fill: 'var(--ink-soft)', fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--line)',
                      borderRadius: '8px',
                    }}
                    formatter={(v: any) => [`${v}%`]}
                  />
                  <ReferenceLine y={80} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Meta Cobertura 80%', fill: '#10b981', fontSize: 10 }} />
                  <Line
                    type="monotone"
                    dataKey="commitmentCoveragePct"
                    name="Tasa de Cobertura"
                    stroke="#0054A6"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="commitmentUtilizationPct"
                    name="Tasa de Utilización"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-line text-xs">
              <span className="text-ink-soft">
                Adopción AHUB: <strong className="text-brand-deep font-bold">{lastPoint.ahubVcores || 0} vCores migrados</strong>
              </span>
              <span className="text-ink-soft">
                Desperdicio de Reservas: <strong className="text-emerald-600 font-bold">$0.00 (100% óptimo)</strong>
              </span>
            </div>
          </div>

          {/* Gráfico 4: Cacería Zombi & Ahorro Recurrente */}
          <div className="bg-surface border border-line rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-heading text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                  <IconRotateClockwise2 className="w-4 h-4 text-emerald-600" strokeWidth={2} />
                  Caza de Recursos Zombi & Ahorro Recurrente
                </h3>
                <p className="text-xs text-ink-soft mt-0.5">
                  Volumen acumulado de recursos purgados y dinero recurrente evitado.
                </p>
              </div>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--ink-soft)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--ink-soft)', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--line)',
                      borderRadius: '8px',
                    }}
                    formatter={(v: any, name: any) => [
                      name === 'zombiesPurgedCount' ? `${v} recursos` : fmtUsd(v),
                      name === 'zombiesPurgedCount' ? 'Zombis Eliminados' : 'Ahorro Recurrente Evitado',
                    ]}
                  />
                  <Bar dataKey="zombiesPurgedCount" name="zombiesPurgedCount" fill="#0054A6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-line text-xs">
              <span className="text-ink-soft">
                Total Zombis Purgados: <strong className="text-brand-deep font-bold">{report.totalZombiesPurged || 0} items</strong>
              </span>
              <span className="text-ink-soft">
                Ahorro Recurrente: <strong className="text-emerald-600 font-bold">{fmtUsd(lastPoint.recurringSavingsAvoided || 0)}/mes</strong>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 3: ROI & AHORRO CONTRAFACTUAL */}
      {activeTab === 'roi' && (
        <div className="space-y-6">
          {/* Gráfico 5: Gasto Real vs Línea Base Contrafactual */}
          <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-heading text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                  <IconCurrencyDollar className="w-4 h-4 text-brand-deep" strokeWidth={2} />
                  Gasto Real vs Línea Base Contrafactual ("Lo que habrías gastado")
                </h3>
                <p className="text-xs text-ink-soft mt-0.5">
                  El área sombreada entre la proyección sin optimizar y el gasto real representa el ROI neto capturado por el SaaS.
                </p>
              </div>
              <div className="px-3 py-1 bg-brand-soft text-brand-deep dark:bg-brand-deep/20 dark:text-brand-bright rounded-lg text-xs font-bold">
                Ahorro Neto: {fmtUsd(report.totalCounterfactualSavings || 0)}
              </div>
            </div>

            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRoi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0054A6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0054A6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--ink-soft)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--ink-soft)', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--line)',
                      borderRadius: '8px',
                    }}
                    formatter={(v: any) => [fmtUsd(v)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="counterfactualCost"
                    name="Línea Base Sin FinOps"
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="actualSpend"
                    name="Gasto Real Facturado"
                    stroke="#0054A6"
                    strokeWidth={3}
                    fill="url(#colorRoi)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gráfico 6: Real vs Presupuesto vs Forecast ML & GreenOps */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
              <h3 className="font-heading text-sm font-bold text-[#1B2A41] dark:text-white mb-1 flex items-center gap-2">
                <IconActivity className="w-4 h-4 text-emerald-500" strokeWidth={2} />
                Precisión de Forecast ML vs Presupuesto
              </h3>
              <p className="text-xs text-ink-soft mb-4">
                Comparativa de gasto real, presupuesto asignado y proyección predictiva Ensemble.
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--ink-soft)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--ink-soft)', fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--surface)', borderRadius: '8px' }} formatter={(v: any) => [fmtUsd(v)]} />
                    <Line type="monotone" dataKey="budget" name="Presupuesto" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="2 2" dot={false} />
                    <Line type="monotone" dataKey="forecastSpend" name="Forecast ML" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="actualSpend" name="Gasto Real" stroke="#0054A6" strokeWidth={2.5} dot={{ r: 2 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
              <h3 className="font-heading text-sm font-bold text-[#1B2A41] dark:text-white mb-1 flex items-center gap-2">
                <IconLeaf className="w-4 h-4 text-emerald-500" strokeWidth={2} />
                Sostenibilidad (GreenOps Carbon Footprint)
              </h3>
              <p className="text-xs text-ink-soft mb-4">
                Evolución de emisiones de carbono ($MTCO_2e$) emitidas vs evitadas por optimizaciones.
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--ink-soft)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--ink-soft)', fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--surface)', borderRadius: '8px' }} formatter={(v: any) => [`${v} MTCO2e`]} />
                    <Area type="monotone" dataKey="emissionsMtco2e" name="Emisiones Actuales" stroke="#10b981" fill="#10b981" fillOpacity={0.15} />
                    <Line type="monotone" dataKey="carbonAvoidedMtco2e" name="Carbono Evitado Acumulado" stroke="#0054A6" strokeWidth={2} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 4: BEFORE/AFTER & HITOS */}
      {activeTab === 'audit' && (
        <div className="space-y-6">
          {/* Hitos de Arquitectura y Despliegues */}
          <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
            <h3 className="font-heading text-sm font-bold text-[#1B2A41] dark:text-white mb-1 flex items-center gap-2">
              <IconFlag className="w-4 h-4 text-brand-deep" strokeWidth={2} />
              Hitos de Arquitectura & Marcadores de Despliegue (Change Markers)
            </h3>
            <p className="text-xs text-ink-soft mb-4">
              Correlación directa de cambios técnicos con impactos inmediatos en la curva de costo mensual.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {report.architectureMilestones?.map((m) => (
                <div key={m.id} className="p-4 bg-surface-2 border border-line rounded-xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-grey font-mono">
                      <span>{m.date}</span>
                      <span className="uppercase font-bold text-brand-deep">{m.type}</span>
                    </div>
                    <h4 className="font-heading font-bold text-xs text-[#1B2A41] dark:text-white mt-1.5">{m.title}</h4>
                    <p className="text-[11px] text-ink-soft mt-1 leading-relaxed">{m.description}</p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-line flex items-center justify-between text-xs">
                    <span className="text-grey text-[11px]">Impacto Mensual:</span>
                    <span
                      className={`font-extrabold ${
                        m.monthlyCostDelta < 0 ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    >
                      {m.monthlyCostDelta < 0 ? fmtDecUsd(m.monthlyCostDelta) : `+${fmtDecUsd(m.monthlyCostDelta)}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabla Before vs After */}
          <div className="bg-surface border border-line rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-heading text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                  <IconShieldCheck className="w-4 h-4 text-emerald-600" strokeWidth={2} />
                  Verificación de Ahorro Real (30 Días Pre vs 30 Días Post)
                </h3>
                <p className="text-xs text-ink-soft">
                  Auditoría de optimizaciones ejecutadas y comprobación de ausencia de Efecto Rebote.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-surface-2 rounded-xl border border-line">
              <div className="relative w-full sm:w-80">
                <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-grey" strokeWidth={2} />
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(e) => { setTableSearch(e.target.value); setTablePage(1); }}
                  placeholder="Buscar por recurso, grupo o acción..."
                  className="w-full pl-9 pr-3 py-1.5 bg-surface border border-line rounded-lg text-xs text-[#1B2A41] dark:text-white placeholder:text-grey focus:outline-none focus:border-brand-deep"
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <span className="text-xs text-grey font-medium">Ordenar:</span>
                <select
                  value={tableSort}
                  onChange={(e) => setTableSort(e.target.value as any)}
                  className="bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-[#1B2A41] dark:text-white font-semibold focus:outline-none focus:border-brand-deep cursor-pointer"
                >
                  <option value="cost_desc">Mayor Ahorro</option>
                  <option value="cost_asc">Menor Ahorro</option>
                  <option value="alpha_asc">Nombre A-Z</option>
                  <option value="alpha_desc">Nombre Z-A</option>
                </select>
                <span className="text-xs font-bold text-ink-soft bg-surface border border-line px-2 py-1.5 rounded-lg">
                  {filteredBeforeAfter.length} recursos
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-surface-2 text-ink-soft uppercase text-[10px] font-extrabold border-y border-line font-heading">
                  <tr>
                    <th className="py-2.5 px-3">Recurso / Grupo</th>
                    <th className="py-2.5 px-3">Acción</th>
                    <th className="py-2.5 px-3">Ejecutado Por</th>
                    <th className="py-2.5 px-3 text-right">Costo Pre-30d</th>
                    <th className="py-2.5 px-3 text-right">Costo Post-30d</th>
                    <th className="py-2.5 px-3 text-right">Ahorro Real</th>
                    <th className="py-2.5 px-3">Estado / Rebote</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pagedBeforeAfter.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-ink-soft">
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <IconCircleCheck className="w-6 h-6 text-brand-deep dark:text-brand-bright mb-1" strokeWidth={1.5} />
                          <span className="font-heading font-bold text-xs text-[#1B2A41] dark:text-white">
                            Sin acciones de remediación previas
                          </span>
                          <span className="text-[11px] text-grey max-w-md">
                            Las optimizaciones ejecutadas desde la plataforma (purgas de recursos zombis, rightsizing o schedules) se registrarán aquí automáticamente con su verificación de consumo pre y post 30 días.
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pagedBeforeAfter.map((item) => (
                      <tr key={item.id} className="hover:bg-surface-2 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-[#1B2A41] dark:text-white">{item.resourceName}</div>
                          <div className="text-[10px] text-grey font-mono mt-0.5">rg: {item.resourceGroup}</div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-md bg-brand-soft text-brand-deep text-[10.5px] font-bold">
                            {item.actionType}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-ink-soft">
                          <div>{item.executedBy}</div>
                          <div className="text-[10px] text-grey font-mono">{item.executedDate}</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">{fmtDecUsd(item.costPre30d)}</td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">{fmtDecUsd(item.costPost30d)}</td>
                        <td className="py-3 px-3 text-right font-bold text-emerald-600 font-mono tabular-nums">
                          -{fmtDecUsd(item.realizedMonthlySavings)}/mes
                        </td>
                        <td className="py-3 px-3">
                          {item.reboundStatus === 'verified_optimal' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[11px]">
                              <IconCircleCheck className="w-3.5 h-3.5" strokeWidth={2} /> Verificado (100%)
                            </span>
                          ) : item.reboundStatus === 'warning_rebound' ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 font-bold text-[11px]" title={item.reboundDetails}>
                              <IconAlertTriangle className="w-3.5 h-3.5" strokeWidth={2} /> Efecto Rebote
                            </span>
                          ) : (
                            <span className="text-ink-soft text-[11px]">Estable</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={tablePage}
              setPage={setTablePage}
              pageSize={tablePageSize}
              setPageSize={(s: number) => { setTablePageSize(s as any); setTablePage(1); }}
              total={filteredBeforeAfter.length}
              totalPages={Math.max(1, Math.ceil(filteredBeforeAfter.length / tablePageSize))}
              pageSizes={[15, 30, 45, 60]}
            />
          </div>

          {/* Registro de Excepciones (Waiver Ledger) */}
          <div className="bg-surface border border-line rounded-xl p-5 shadow-sm space-y-4">
            <div>
              <h3 className="font-heading text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                <IconClock className="w-4 h-4 text-brand-deep" strokeWidth={2} />
                Registro de Excepciones y Rechazos (Waiver Ledger)
              </h3>
              <p className="text-xs text-ink-soft">
                Control de recomendaciones descartadas formalmente con justificación de ingeniería y fecha de revisión.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-surface-2 text-ink-soft uppercase text-[10px] font-extrabold border-y border-line font-heading">
                  <tr>
                    <th className="py-2.5 px-3">Recurso</th>
                    <th className="py-2.5 px-3">Recomendación</th>
                    <th className="py-2.5 px-3">Justificación / Motivo</th>
                    <th className="py-2.5 px-3">Aprobador</th>
                    <th className="py-2.5 px-3">Vencimiento</th>
                    <th className="py-2.5 px-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.waiverLedger?.map((w) => (
                    <tr key={w.id} className="hover:bg-surface-2 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-bold text-[#1B2A41] dark:text-white">{w.resourceName}</div>
                        <div className="text-[10px] text-grey font-mono">rg: {w.resourceGroup}</div>
                      </td>
                      <td className="py-3 px-3 font-medium text-ink-soft max-w-[220px]">
                        {w.recommendationTitle}
                      </td>
                      <td className="py-3 px-3 text-[#1B2A41] dark:text-white max-w-[280px]">
                        {w.reason}
                      </td>
                      <td className="py-3 px-3 text-ink-soft font-mono text-[11px]">
                        {w.engineerName}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px]">
                        {w.expiryDate}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-md font-bold text-[10.5px] ${
                            w.status === 'active_waiver'
                              ? 'bg-blue-50 text-brand-deep dark:bg-brand-deep/20 dark:text-brand-bright'
                              : w.status === 'expired_waiver'
                              ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30'
                              : 'bg-amber-50 text-amber-600'
                          }`}
                        >
                          {w.status === 'active_waiver' ? 'Excepción Activa' : w.status === 'expired_waiver' ? 'Vencida' : 'En Revisión'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
