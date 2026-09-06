'use client';
import React, { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { useTranslations } from 'next-intl';
import { isMockTenant } from '@/lib/mockData';
import {
    IconReceipt2,
    IconFileZip,
    IconFileSpreadsheet,
    IconBraces,
    IconChartBar,
    IconFileText,
    IconMail,
    IconSparkles,
    IconColumns,
    IconBrandAzure,
    IconCash,
    IconPercentage,
    IconTrendingUp,
    IconCalendar,
    IconInfoCircle,
    IconX,
    IconCheck,
    IconFilter,
    IconLoader2,
    IconAlertTriangle,
    IconRefresh,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { getFreshIdToken } from '@/lib/msalToken';
import TierLockedNotice, { parseTierRequiredError } from '@/components/TierLockedNotice';
import InfoTooltip from '@/components/InfoTooltip';
import ResizableTh from '@/components/ResizableTh';
import { ColumnMenu, useColumnConfig, type TableColumnConfig } from '@/components/TableColumns';
import { errorMessage } from '@/lib/apiErrors';
import type {
    BillingReportApiResponse,
    CustomerBillingSummaryItem,
    SubscriptionBillingSummaryItem,
    BillingLineDetailItem,
    InvoiceSectionBillingItem,
} from '@/types/billingReport.types';

const MACOS_SCROLL =
    'w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 ' +
    'scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 ' +
    '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 ' +
    'dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 ' +
    'dark:[&::-webkit-scrollbar-track]:bg-slate-800';

const CUSTOMER_COLUMNS: TableColumnConfig[] = [
    { id: 'customer', label: 'Cliente / Entidad', visible: true },
    { id: 'customerId', label: 'Customer ID', visible: true },
    { id: 'originalCost', label: 'Costo Original USD', visible: true },
    { id: 'adjustedCost', label: 'Costo Ajustado USD', visible: true },
    { id: 'actions', label: 'Acciones Rápidas', visible: true },
];

const SUBSCRIPTION_COLUMNS: TableColumnConfig[] = [
    { id: 'subscription', label: 'Suscripción Azure', visible: true },
    { id: 'originalCost', label: 'Costo Original USD', visible: true },
    { id: 'markupAmount', label: 'Monto Markup USD', visible: true },
    { id: 'adjustedCost', label: 'Costo Ajustado USD', visible: true },
];

const LINES_COLUMNS: TableColumnConfig[] = [
    { id: 'date', label: 'Fecha', visible: true },
    { id: 'customer', label: 'Cliente', visible: true },
    { id: 'billingProfile', label: 'Billing Profile', visible: true },
    { id: 'invoiceSection', label: 'Invoice Section', visible: true },
    { id: 'service', label: 'Servicio', visible: true },
    { id: 'resourceGroup', label: 'Resource Group', visible: true },
    { id: 'originalCost', label: 'Costo Original USD', visible: true },
    { id: 'adjustedCost', label: 'Costo Ajustado USD', visible: true },
];

function fmtUSD(n: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(n || 0);
}

function getPeriodOptions(): { value: string; label: string }[] {
    const opts: { value: string; label: string }[] = [
        { value: 'last3m', label: 'Últimos 3 meses (Acumulado)' },
        { value: 'last30d', label: 'Últimos 30 días' },
        { value: 'last7d', label: 'Últimos 7 días' },
        { value: 'ytd', label: 'Año en curso (YTD)' },
        { value: 'last12m', label: 'Últimos 12 meses' },
    ];
    const now = new Date();
    for (let i = 0; i < 4; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthName = d.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
        const label = i === 0 ? `Mes actual (${monthName})` : monthName;
        opts.push({ value, label });
    }
    return opts;
}

export default function InvoicingReportPanel() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tMock = useTranslations('Mock');
    const t = useTranslations('Invoicing');

    const tenantId = selectedTenant?.id || '';
    const isMock = isMockTenant(tenantId);

    const periodOptions = getPeriodOptions();
    const [period, setPeriod] = useState(periodOptions[0].value);
    const [customMonth, setCustomMonth] = useState('');
    const [rangeStart, setRangeStart] = useState('');
    const [rangeEnd, setRangeEnd] = useState('');
    const [dateMode, setDateMode] = useState<'preset' | 'range' | 'month'>('preset');
    const [subscriptionId, setSubscriptionId] = useState('');
    const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
    const [sendingEmailCustomer, setSendingEmailCustomer] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);

    // Modal de Mapeo de Cliente Virtual
    const [mappingCustomer, setMappingCustomer] = useState<CustomerBillingSummaryItem | null>(null);
    const [virtualName, setVirtualName] = useState('');
    const [virtualId, setVirtualId] = useState('');
    const [isSavingMapping, setIsSavingMapping] = useState(false);

    // Paginación en Detalle de Líneas
    const [linesPage, setLinesPage] = useState(1);
    const [linesPageSize, setLinesPageSize] = useState(15);

    // Configuración de Columnas persistida en localStorage
    const custCols = useColumnConfig(`table_columns_config_billing_cust_${tenantId}`, CUSTOMER_COLUMNS);
    const subCols = useColumnConfig(`table_columns_config_billing_sub_${tenantId}`, SUBSCRIPTION_COLUMNS);
    const lineCols = useColumnConfig(`table_columns_config_billing_lines_${tenantId}`, LINES_COLUMNS);



    const MIN_MONTH = (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 13);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    const MAX_MONTH = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock) return {};
        const account = accounts[0];
        if (!account) throw new Error(t('noAccount'));
        const token = await getFreshIdToken(instance, account);
        return { Authorization: `Bearer ${token}` };
    }, [accounts, instance, isMock, t]);

    const fetcher = async (url: string) => {
        const headers = await authHeaders();
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error || t('toastLoadError'));
        }
        return res.json();
    };

    const downloadFile = async (url: string, filename: string) => {
        const headers = await authHeaders();
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error || t('toastDownloadError', { filename }));
        }
        const blob = await res.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(objectUrl);
        document.body.removeChild(a);
    };

    const apiUrl =
        selectedTenant && selectedTenant.id !== 'default' && (isMock || accounts.length > 0)
            ? `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=json${subscriptionId ? `&subscriptionId=${encodeURIComponent(subscriptionId)}` : ''}`
            : null;

    const { data, error, isLoading, mutate } = useSWR<any>(apiUrl, fetcher, { revalidateOnFocus: false });

    // Paginación de líneas
    const paginatedLines = useMemo(() => {
        const allLines = data?.lines || [];
        const start = (linesPage - 1) * linesPageSize;
        return allLines.slice(start, start + linesPageSize);
    }, [data?.lines, linesPage, linesPageSize]);

    const totalLinesCount = data?.lines?.length || 0;
    const totalLinesPages = Math.ceil(totalLinesCount / linesPageSize) || 1;

    // Exportaciones Principales
    const handleDownloadZip = async () => {
        if (!selectedTenant) return;
        setDownloadingFormat('zip');
        try {
            await downloadFile(
                `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=pdf`,
                `Facturacion-${selectedTenant.id}-${period}.zip`
            );
            toast.success('Paquete ZIP descargado exitosamente.');
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setDownloadingFormat(null);
        }
    };

    const handleDownloadCsv = async () => {
        if (!selectedTenant) return;
        setDownloadingFormat('csv');
        try {
            await downloadFile(
                `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=csv${subscriptionId ? `&subscriptionId=${encodeURIComponent(subscriptionId)}` : ''}`,
                `Facturacion-${selectedTenant.id}-${period}.csv`
            );
            toast.success('Reporte CSV descargado con éxito.');
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setDownloadingFormat(null);
        }
    };

    const handleDownloadJson = async () => {
        if (!selectedTenant) return;
        setDownloadingFormat('json');
        try {
            await downloadFile(
                `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=json${subscriptionId ? `&subscriptionId=${encodeURIComponent(subscriptionId)}` : ''}`,
                `Facturacion-${selectedTenant.id}-${period}.json`
            );
            toast.success('Dataset JSON descargado con éxito.');
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setDownloadingFormat(null);
        }
    };

    const handleExportPbids = async () => {
        if (!selectedTenant) return;
        setDownloadingFormat('pbids');
        try {
            await downloadFile(
                `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=pbit`,
                `invoicing-${selectedTenant.id}-${period}.pbids`
            );
            toast.success('Conector Power BI (.pbids) generado.');
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setDownloadingFormat(null);
        }
    };

    const handleDownloadCustomerPdf = async (custId: string) => {
        setDownloadingFormat(`pdf-${custId}`);
        try {
            await downloadFile(
                `/api/admin/report/invoicing?tenantId=${selectedTenant?.id}&period=${period}&format=pdf&customerId=${encodeURIComponent(custId)}`,
                `Factura-${custId}-${period}.pdf`
            );
            toast.success('Factura proforma PDF generada exitosamente.');
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setDownloadingFormat(null);
        }
    };


    const handleEmailCustomerPdf = async (custId: string) => {
        const recipientEmail = prompt('Ingrese el correo del destinatario:');
        if (!recipientEmail) return;

        setSendingEmailCustomer(custId);
        try {
            const headers = await authHeaders();
            const res = await fetch('/api/admin/report/invoicing/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({
                    tenantId: selectedTenant?.id,
                    period,
                    customerId: custId,
                    recipientEmail,
                }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j.error || 'Error al despachar email');
            }
            toast.success(`Factura despachada a ${recipientEmail}`);
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setSendingEmailCustomer(null);
        }
    };

    const handleSyncNow = async () => {
        if (!selectedTenant) return;
        setIsSyncing(true);
        try {
            const headers = await authHeaders();
            const res = await fetch('/api/admin/config/account-status/sync-now', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ tenantId: selectedTenant.id }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j.error || 'Error al iniciar sincronización');
            }
            toast.success('Sincronización de telemetría iniciada en segundo plano.');
            setTimeout(() => {
                mutate();
            }, 3000);
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSaveMapping = async () => {
        if (!virtualName || !virtualId) {
            toast.error('Complete el nombre y el ID del cliente virtual.');
            return;
        }

        setIsSavingMapping(true);
        try {
            const headers = await authHeaders();
            const res = await fetch('/api/reports/billing/map-customer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({
                    tenantId: selectedTenant?.id,
                    targetCustomerId: virtualId,
                    customerName: virtualName,
                }),
            });
            if (!res.ok) throw new Error('Error al guardar mapeo');
            toast.success('Cliente virtual asignado correctamente.');
            setMappingCustomer(null);
            mutate();
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setIsSavingMapping(false);
        }
    };

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (isLoading) {
        return (
            <div className="w-full flex flex-col items-center justify-center py-24 space-y-4">
                <IconLoader2 className="w-9 h-9 animate-spin text-[#0078D4]" />
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    {t("loading")}
                </p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return (
                <TierLockedNotice
                    requiredTier={requiredTier}
                    currentTier={(selectedTenant as any)?.tier}
                    featureName={t('tierFeatureName')}
                />
            );
        }
        return (
            <div className="w-full bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 p-5 rounded-xl border border-rose-200 dark:border-rose-800 flex items-start gap-3">
                <IconAlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
                <div>
                    <h3 className="font-semibold text-sm">Error al cargar facturación</h3>
                    <p className="text-xs mt-1">{error.message}</p>
                </div>
            </div>
        );
    }

    if (!data) return null;

    const { totals, byCustomer = [], byInvoiceSection = [], bySubscription = [], availableSubscriptions = [], markupPercent, currency } = data;

    const originalCostVal = totals?.originalCost || 0;
    const markupAmountVal = totals?.markupAmount || 0;
    const adjustedCostVal = totals?.adjustedCost || 0;

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in pb-12">
            {/* MOCK BANNER */}
            {isMock && (
                <div className="w-full bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 rounded-xl px-4 py-3 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                        <IconSparkles size={16} className="text-[#0078D4] shrink-0" />
                        <span>
                            <strong>Modo Simulación Demo:</strong> {tMock("demoBillingNotice")}
                        </span>
                    </div>
                </div>
            )}

            {/* HEADER PRINCIPAL Y BOTONES DE ACCIÓN CORPORATIVOS */}
            <div className="w-full flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-200 dark:border-slate-800 pb-5 gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#1B2A41] dark:text-white flex items-center gap-2" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                        <IconReceipt2 size={26} className="text-[#0078D4]" />
                        {t("title")}
                        <InfoTooltip content={t("tooltip")} />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Reporte de facturación con markup para clientes PBI y distribución de costos (Business+ / Enterprise).
                    </p>
                </div>

                {/* BARRA SUPERIOR DE ACCIONES - ESTÁNDAR DIRECTIVA 21 */}
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleSyncNow}
                        disabled={isSyncing || downloadingFormat !== null}
                        className="border border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900 hover:bg-blue-50/60 dark:hover:bg-blue-950/40 px-3.5 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
                        title="Sincronizar telemetría más reciente desde Azure Cost Management"
                    >
                        {isSyncing ? <IconLoader2 size={16} className="animate-spin" /> : <IconRefresh size={16} />}
                        {t("syncTelemetry")}
                    </button>

                    <button
                        onClick={handleDownloadZip}
                        disabled={downloadingFormat !== null}
                        className="border border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900 hover:bg-blue-50/60 dark:hover:bg-blue-950/40 px-3.5 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
                        title="Descargar paquete completo con CSVs, JSON y Conector Power BI"
                    >
                        {downloadingFormat === 'zip' ? <IconLoader2 size={16} className="animate-spin" /> : <IconFileZip size={16} />}
                        Descargar Todo (ZIP)
                    </button>

                    <button
                        onClick={handleDownloadCsv}
                        disabled={downloadingFormat !== null}
                        className="border border-[#00AEEF] text-[#00AEEF] bg-white dark:bg-slate-900 hover:bg-cyan-50/60 dark:hover:bg-cyan-950/40 px-3.5 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
                        title="Descargar detalle en formato CSV"
                    >
                        {downloadingFormat === 'csv' ? <IconLoader2 size={16} className="animate-spin" /> : <IconFileSpreadsheet size={16} />}
                        Descargar CSV
                    </button>

                    <button
                        onClick={handleDownloadJson}
                        disabled={downloadingFormat !== null}
                        className="border border-[#8B5CF6] text-[#8B5CF6] bg-white dark:bg-slate-900 hover:bg-purple-50/60 dark:hover:bg-purple-950/40 px-3.5 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
                        title="Descargar dataset en formato JSON"
                    >
                        {downloadingFormat === 'json' ? <IconLoader2 size={16} className="animate-spin" /> : <IconBraces size={16} />}
                        JSON
                    </button>

                    <button
                        onClick={handleExportPbids}
                        disabled={downloadingFormat !== null}
                        className="border border-[#F59E0B] text-[#F59E0B] bg-white dark:bg-slate-900 hover:bg-amber-50/60 dark:hover:bg-amber-950/40 px-3.5 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
                        title="Generar archivo de conexión para Microsoft Power BI Desktop"
                    >
                        {downloadingFormat === 'pbids' ? <IconLoader2 size={16} className="animate-spin" /> : <IconChartBar size={16} />}
                        Power BI (.pbids)
                    </button>
                </div>
            </div>


            {/* BARRA DE FILTROS Y CONTROLES DE PERÍODO / RANGO DE TIEMPO */}
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
                {/* Selector de Modo de Fecha */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs">
                        <button
                            onClick={() => {
                                setDateMode('preset');
                                setCustomMonth('');
                                setPeriod(periodOptions[0].value);
                            }}
                            className={`px-3 py-1 rounded-md font-medium transition-all ${dateMode === 'preset' ? 'bg-white dark:bg-slate-900 text-[#0078D4] shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            Predefinidos
                        </button>
                        <button
                            onClick={() => {
                                setDateMode('range');
                                setCustomMonth('');
                                const todayStr = new Date().toISOString().slice(0, 10);
                                if (!rangeStart) setRangeStart('2026-06-01');
                                if (!rangeEnd) setRangeEnd(todayStr);
                                setPeriod(`2026-06-01_${todayStr}`);
                            }}
                            className={`px-3 py-1 rounded-md font-medium transition-all ${dateMode === 'range' ? 'bg-white dark:bg-slate-900 text-[#0078D4] shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            Rango Personalizado (Desde / Hasta)
                        </button>
                        <button
                            onClick={() => {
                                setDateMode('month');
                                const curMonth = new Date().toISOString().slice(0, 7);
                                setCustomMonth(curMonth);
                                setPeriod(curMonth);
                            }}
                            className={`px-3 py-1 rounded-md font-medium transition-all ${dateMode === 'month' ? 'bg-white dark:bg-slate-900 text-[#0078D4] shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            {t("specificMonth")}
                        </button>
                    </div>

                    {markupPercent != null && (
                        <div className="flex items-center gap-1.5 text-xs bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] dark:text-blue-300 border border-blue-200 dark:border-blue-800 px-3 py-1 rounded-lg font-medium">
                            <IconPercentage size={14} className="text-[#0078D4]" />
                            % Markup aplicado: <strong>{markupPercent}%</strong>
                        </div>
                    )}
                </div>

                {/* Controles Dinámicos según Modo */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        {dateMode === 'preset' && (
                            <div className="flex items-center gap-2">
                                <IconFilter size={16} className="text-slate-400" />
                                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Período:</label>
                                <select
                                    value={period}
                                    onChange={(e) => setPeriod(e.target.value)}
                                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                >
                                    {periodOptions.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {dateMode === 'range' && (
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex items-center gap-1.5">
                                    <IconCalendar size={16} className="text-slate-400" />
                                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Desde:</label>
                                    <input
                                        type="date"
                                        value={rangeStart}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setRangeStart(v);
                                            if (v && rangeEnd) setPeriod(`${v}_${rangeEnd}`);
                                        }}
                                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                    />
                                </div>

                                <div className="flex items-center gap-1.5">
                                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Hasta:</label>
                                    <input
                                        type="date"
                                        value={rangeEnd}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setRangeEnd(v);
                                            if (rangeStart && v) setPeriod(`${rangeStart}_${v}`);
                                        }}
                                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                    />
                                </div>

                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => {
                                            const todayStr = new Date().toISOString().slice(0, 10);
                                            setRangeStart('2026-06-01');
                                            setRangeEnd(todayStr);
                                            setPeriod(`2026-06-01_${todayStr}`);
                                        }}
                                        className="px-2 py-1 text-[11px] font-semibold text-[#0078D4] bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 rounded border border-blue-200 dark:border-blue-800"
                                        title="Rango completo desde creación del tenant (1 Jun a Hoy)"
                                    >
                                        1 Jun - Hoy
                                    </button>
                                    <button
                                        onClick={() => {
                                            const todayStr = new Date().toISOString().slice(0, 10);
                                            setRangeStart('2026-08-01');
                                            setRangeEnd(todayStr);
                                            setPeriod(`2026-08-01_${todayStr}`);
                                        }}
                                        className="px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded border border-slate-200 dark:border-slate-700"
                                        title="Mes en curso (1 Ago a Hoy)"
                                    >
                                        1 Ago - Hoy
                                    </button>
                                </div>
                            </div>
                        )}

                        {dateMode === 'month' && (
                            <div className="flex items-center gap-2">
                                <IconCalendar size={16} className="text-slate-400" />
                                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Mes:</label>
                                <input
                                    type="month"
                                    value={customMonth}
                                    min={MIN_MONTH}
                                    max={MAX_MONTH}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setCustomMonth(v);
                                        if (v) setPeriod(v);
                                    }}
                                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>
                        )}

                        {availableSubscriptions && availableSubscriptions.length > 0 && (
                            <div className="flex items-center gap-2">
                                <IconBrandAzure size={16} className="text-[#0078D4]" />
                                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Suscripción:</label>
                                <select
                                    value={subscriptionId}
                                    onChange={(e) => setSubscriptionId(e.target.value)}
                                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0078D4] max-w-[200px]"
                                >
                                    <option value="">Todas las suscripciones</option>
                                    {availableSubscriptions.map((s: any) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {t("activePeriod")} <span className="font-semibold text-slate-800 dark:text-slate-200">{period}</span>
                    </div>
                </div>
            </div>


            {/* 3 KPI CARDS SUPERIORES EN AZUL CORPORATIVO Y FONDOS NEUTROS */}
            <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Card 1: Costo Original */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            {t("originalCost")}
                        </span>
                        <div className="p-2 bg-blue-50 dark:bg-blue-950/40 rounded-lg text-[#0078D4]">
                            <IconCash size={20} />
                        </div>
                    </div>
                    <div className="text-2xl font-extrabold text-[#0078D4] mt-2" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                        {fmtUSD(originalCostVal)} {currency}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                        Consumo neto registrado en Azure
                    </div>
                </div>

                {/* Card 2: Monto Markup */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Monto Markup (Margen Partner)
                        </span>
                        <div className="p-2 bg-blue-50 dark:bg-blue-950/40 rounded-lg text-[#2563EB]">
                            <IconPercentage size={20} />
                        </div>
                    </div>
                    <div className="text-2xl font-extrabold text-[#2563EB] mt-2" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                        +{fmtUSD(markupAmountVal)} {currency}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                        {t("marginOverBase", { pct: markupPercent })}
                    </div>
                </div>

                {/* Card 3: Costo Ajustado */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            {t("adjustedCost")}
                        </span>
                        <div className="p-2 bg-blue-50 dark:bg-blue-950/40 rounded-lg text-[#0078D4]">
                            <IconTrendingUp size={20} />
                        </div>
                    </div>
                    <div className="text-2xl font-extrabold text-[#0078D4] mt-2" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                        {fmtUSD(adjustedCostVal)} {currency}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                        Importe final consolidado a facturar
                    </div>
                </div>
            </div>

            {/* SECCIÓN 1: TABLA FACTURACIÓN POR CLIENTE */}
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <IconFileText size={18} className="text-[#0078D4]" />
                        <h2 className="text-sm font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                            {t("byCustomer")}
                        </h2>
                        <InfoTooltip content="Desglose consolidado de importes base, márgenes y totales por cliente o entidad." />
                    </div>
                    <ColumnMenu {...custCols} label="Personalizar Columnas" />
                </div>

                <div className={MACOS_SCROLL}>
                    <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                {custCols.isVisible('customer') && <ResizableTh minWidth={140} className="px-4 py-3 font-semibold">Cliente / Entidad</ResizableTh>}
                                {custCols.isVisible('customerId') && <ResizableTh minWidth={120} className="px-4 py-3 font-semibold">Customer ID</ResizableTh>}
                                {custCols.isVisible('originalCost') && <ResizableTh minWidth={120} className="px-4 py-3 text-right font-semibold">Costo Original USD</ResizableTh>}
                                {custCols.isVisible('adjustedCost') && <ResizableTh minWidth={120} className="px-4 py-3 text-right font-semibold">Costo Ajustado USD</ResizableTh>}
                                {custCols.isVisible('actions') && <ResizableTh minWidth={160} className="px-4 py-3 text-center font-semibold">Acciones Rápidas</ResizableTh>}
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {byCustomer.map((c: any) => {
                                const origCost = c.originalCostUSD ?? c.originalCost ?? 0;
                                const adjCost = c.adjustedCostUSD ?? c.adjustedCost ?? 0;
                                const isAssigned = c.customerId && c.customerId !== 'unassigned';
                                const displayName = c.customerDisplayName || c.customerName || (isAssigned ? c.customerId : 'Sin identificar (facturación EA/MCA sin cliente CSP)');

                                return (
                                    <tr key={c.customerId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                        {custCols.isVisible('customer') && (
                                            <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                                                {displayName}
                                            </td>
                                        )}
                                        {custCols.isVisible('customerId') && (
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded font-mono text-[11px] ${isAssigned ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                                    {c.customerId}
                                                </span>
                                            </td>
                                        )}
                                        {custCols.isVisible('originalCost') && (
                                            <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                                {fmtUSD(origCost)}
                                            </td>
                                        )}
                                        {custCols.isVisible('adjustedCost') && (
                                            <td className="px-4 py-3 text-right font-mono font-bold text-[#0078D4] dark:text-blue-400">
                                                {fmtUSD(adjCost)}
                                            </td>
                                        )}
                                        {custCols.isVisible('actions') && (
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                        onClick={() => handleDownloadCustomerPdf(c.customerId)}
                                                        disabled={downloadingFormat !== null}
                                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0078D4] hover:underline disabled:opacity-50"
                                                        title="Descargar proforma en PDF A4"
                                                    >
                                                        {downloadingFormat === `pdf-${c.customerId}` ? <IconLoader2 size={14} className="animate-spin" /> : <IconFileText size={14} />}
                                                        PDF
                                                    </button>
                                                    <button
                                                        onClick={() => handleEmailCustomerPdf(c.customerId)}
                                                        disabled={sendingEmailCustomer !== null}
                                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:text-[#0078D4] hover:underline disabled:opacity-50"
                                                        title="Despachar factura por email"
                                                    >
                                                        {sendingEmailCustomer === c.customerId ? <IconLoader2 size={14} className="animate-spin" /> : <IconMail size={14} />}
                                                        Email
                                                    </button>
                                                    {!isAssigned && (
                                                        <button
                                                            onClick={() => {
                                                                setMappingCustomer(c);
                                                                setVirtualName('');
                                                                setVirtualId(`cust-${Date.now().toString().slice(-4)}`);
                                                            }}
                                                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0078D4] bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800"
                                                            title="Asignar Cliente Virtual o Unidad de Negocio"
                                                        >
                                                            <IconSparkles size={13} />
                                                            Mapear Cliente
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                            {byCustomer.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">
                                        {t("noBillingData")}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* SECCIÓN 2: TABLA FACTURACIÓN POR INVOICE SECTION */}
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <IconReceipt2 size={18} className="text-[#0078D4]" />
                        <h2 className="text-sm font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                            {t("byInvoiceSection")}
                        </h2>
                        <InfoTooltip content="Secciones de facturación agrupadas según la jerarquía de facturación de Azure." />
                    </div>
                </div>

                <div className={MACOS_SCROLL}>
                    <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-4 py-3 font-semibold">Invoice Section ID</th>
                                <th className="px-4 py-3 font-semibold">Billing Profile</th>
                                <th className="px-4 py-3 font-semibold">Customer ID</th>
                                <th className="px-4 py-3 text-right font-semibold">Costo Original USD</th>
                                <th className="px-4 py-3 text-right font-semibold">Costo Ajustado USD</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {byInvoiceSection.map((s: any) => {
                                const origCost = s.originalCostUSD ?? s.originalCost ?? s.cost ?? 0;
                                const adjCost = s.adjustedCostUSD ?? s.adjustedCost ?? s.adjusted ?? 0;
                                return (
                                    <tr key={s.invoiceSectionId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                        <td className="px-4 py-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">{s.invoiceSectionId}</td>
                                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{s.billingProfileId || '—'}</td>
                                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{s.customerId}</td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">{fmtUSD(origCost)}</td>
                                        <td className="px-4 py-3 text-right font-mono font-bold text-[#0078D4] dark:text-blue-400">{fmtUSD(adjCost)}</td>
                                    </tr>
                                );
                            })}
                            {byInvoiceSection.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">
                                        {t("noInvoiceSectionData")}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* SECCIÓN 3: TABLA FACTURACIÓN POR SUSCRIPCIÓN */}
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <IconBrandAzure size={18} className="text-[#0078D4]" />
                        <h2 className="text-sm font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                            {t("bySubscription")}
                        </h2>
                        <InfoTooltip content="Consolidado de costos base y montos ajustados por suscripción." />
                    </div>
                    <ColumnMenu {...subCols} label="Personalizar Columnas" />
                </div>

                <div className={MACOS_SCROLL}>
                    <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                {subCols.isVisible('subscription') && <ResizableTh minWidth={180} className="px-4 py-3 font-semibold">Suscripción Azure</ResizableTh>}
                                {subCols.isVisible('originalCost') && <ResizableTh minWidth={120} className="px-4 py-3 text-right font-semibold">Costo Original USD</ResizableTh>}
                                {subCols.isVisible('markupAmount') && <ResizableTh minWidth={120} className="px-4 py-3 text-right font-semibold">Monto Markup USD</ResizableTh>}
                                {subCols.isVisible('adjustedCost') && <ResizableTh minWidth={120} className="px-4 py-3 text-right font-semibold">Costo Ajustado USD</ResizableTh>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {bySubscription.map((s: any) => {
                                const origCost = s.originalCostUSD ?? s.originalCost ?? 0;
                                const adjCost = s.adjustedCostUSD ?? s.adjustedCost ?? 0;
                                const markupVal = s.markupAmountUSD ?? s.markupAmount ?? Math.max(0, adjCost - origCost);
                                const subDisplayName = s.subscriptionName || s.name || s.subscriptionId;

                                return (
                                    <tr key={s.subscriptionId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                        {subCols.isVisible('subscription') && (
                                            <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                                <IconBrandAzure size={16} className="text-[#0078D4] shrink-0" />
                                                <span>{subDisplayName}</span>
                                            </td>
                                        )}
                                        {subCols.isVisible('originalCost') && (
                                            <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                                {fmtUSD(origCost)}
                                            </td>
                                        )}
                                        {subCols.isVisible('markupAmount') && (
                                            <td className="px-4 py-3 text-right font-mono text-[#2563EB] dark:text-blue-300">
                                                +{fmtUSD(markupVal)}
                                            </td>
                                        )}
                                        {subCols.isVisible('adjustedCost') && (
                                            <td className="px-4 py-3 text-right font-mono font-bold text-[#0078D4] dark:text-blue-400">
                                                {fmtUSD(adjCost)}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                            {bySubscription.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">
                                        {t("noSubscriptionData")}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        {bySubscription.length > 0 && (
                            <tfoot className="bg-slate-100/70 dark:bg-slate-800/80 font-bold border-t-2 border-slate-200 dark:border-slate-700">
                                <tr>
                                    {subCols.isVisible('subscription') && (
                                        <td className="px-4 py-3 text-slate-900 dark:text-white">
                                            Total ({bySubscription.length} suscripciones)
                                        </td>
                                    )}
                                    {subCols.isVisible('originalCost') && (
                                        <td className="px-4 py-3 text-right font-mono text-slate-900 dark:text-white">
                                            {fmtUSD(bySubscription.reduce((acc: number, s: any) => acc + (s.originalCostUSD ?? s.originalCost ?? 0), 0))}
                                        </td>
                                    )}
                                    {subCols.isVisible('markupAmount') && (
                                        <td className="px-4 py-3 text-right font-mono text-[#2563EB] dark:text-blue-300">
                                            +{fmtUSD(bySubscription.reduce((acc: number, s: any) => acc + (s.markupAmountUSD ?? s.markupAmount ?? Math.max(0, (s.adjustedCostUSD ?? s.adjustedCost ?? 0) - (s.originalCostUSD ?? s.originalCost ?? 0))), 0))}
                                        </td>
                                    )}
                                    {subCols.isVisible('adjustedCost') && (
                                        <td className="px-4 py-3 text-right font-mono text-[#0078D4] dark:text-blue-400">
                                            {fmtUSD(bySubscription.reduce((acc: number, s: any) => acc + (s.adjustedCostUSD ?? s.adjustedCost ?? 0), 0))}
                                        </td>
                                    )}
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* SECCIÓN 4: TABLA DETALLE DE LÍNEAS */}
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <IconReceipt2 size={18} className="text-[#0078D4]" />
                        <h2 className="text-sm font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                            {t("lineDetail")}
                        </h2>
                        <InfoTooltip content="Registros individuales de consumo con fechas, perfiles, servicios y grupos de recursos." />
                    </div>
                    <ColumnMenu {...lineCols} label="Personalizar Columnas" />
                </div>

                <div className={MACOS_SCROLL}>
                    <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                {lineCols.isVisible('date') && <ResizableTh minWidth={90} className="px-4 py-3 font-semibold">Fecha</ResizableTh>}
                                {lineCols.isVisible('customer') && <ResizableTh minWidth={120} className="px-4 py-3 font-semibold">Cliente</ResizableTh>}
                                {lineCols.isVisible('billingProfile') && <ResizableTh minWidth={100} className="px-4 py-3 font-semibold">Billing Profile</ResizableTh>}
                                {lineCols.isVisible('invoiceSection') && <ResizableTh minWidth={100} className="px-4 py-3 font-semibold">Invoice Section</ResizableTh>}
                                {lineCols.isVisible('service') && <ResizableTh minWidth={120} className="px-4 py-3 font-semibold">Servicio</ResizableTh>}
                                {lineCols.isVisible('resourceGroup') && <ResizableTh minWidth={120} className="px-4 py-3 font-semibold">Resource Group</ResizableTh>}
                                {lineCols.isVisible('originalCost') && <ResizableTh minWidth={100} className="px-4 py-3 text-right font-semibold">Costo Original USD</ResizableTh>}
                                {lineCols.isVisible('adjustedCost') && <ResizableTh minWidth={100} className="px-4 py-3 text-right font-semibold">Costo Ajustado USD</ResizableTh>}
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {paginatedLines.map((l: any, idx: number) => {
                                const origCost = l.originalCostUSD ?? l.originalCost ?? 0;
                                const adjCost = l.adjustedCostUSD ?? l.adjustedCost ?? 0;
                                const lineDate = l.formattedDate || l.date || l.dateIso || '—';
                                const custName = l.customerName || l.customerDisplayName || (l.customerId === 'unassigned' ? 'Sin identificar' : l.customerId);
                                const serviceName = l.serviceName || l.service || 'Azure General';

                                return (
                                    <tr key={`${l.id || idx}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                        {lineCols.isVisible('date') && (
                                            <td className="px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                                                {lineDate}
                                            </td>
                                        )}
                                        {lineCols.isVisible('customer') && (
                                            <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                                {custName}
                                            </td>
                                        )}
                                        {lineCols.isVisible('billingProfile') && (
                                            <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                                                {l.billingProfileId || '—'}
                                            </td>
                                        )}
                                        {lineCols.isVisible('invoiceSection') && (
                                            <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                                                {l.invoiceSectionId || '—'}
                                            </td>
                                        )}
                                        {lineCols.isVisible('service') && (
                                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                                                {serviceName}
                                            </td>
                                        )}
                                        {lineCols.isVisible('resourceGroup') && (
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-[180px] truncate" title={l.resourceGroup}>
                                                {l.resourceGroup || 'Sin Grupo'}
                                            </td>
                                        )}
                                        {lineCols.isVisible('originalCost') && (
                                            <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                                {fmtUSD(origCost)}
                                            </td>
                                        )}
                                        {lineCols.isVisible('adjustedCost') && (
                                            <td className="px-4 py-3 text-right font-mono font-bold text-[#0078D4] dark:text-blue-400">
                                                {fmtUSD(adjCost)}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                            {paginatedLines.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-400">
                                        {t("noLines")}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>


                {/* PAGINACIÓN ESTÁNDAR CMP */}
                {totalLinesCount > 0 && (
                    <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                        <div className="text-slate-500 dark:text-slate-400">
                            {t("showingLines", { from: (linesPage - 1) * linesPageSize + 1, to: Math.min(linesPage * linesPageSize, totalLinesCount), total: totalLinesCount })}
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5">
                                <span className="text-slate-500">Filas por página:</span>
                                <select
                                    value={linesPageSize}
                                    onChange={(e) => {
                                        setLinesPageSize(Number(e.target.value));
                                        setLinesPage(1);
                                    }}
                                    className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                                >
                                    <option value={15}>15</option>
                                    <option value={30}>30</option>
                                    <option value={45}>45</option>
                                    <option value={60}>60</option>
                                </select>
                            </div>

                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setLinesPage((p) => Math.max(1, p - 1))}
                                    disabled={linesPage === 1}
                                    className="px-3 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 disabled:opacity-40"
                                >
                                    {t("prev")}
                                </button>
                                <span className="px-2 font-medium">
                                    {linesPage} de {totalLinesPages}
                                </span>
                                <button
                                    onClick={() => setLinesPage((p) => Math.min(totalLinesPages, p + 1))}
                                    disabled={linesPage === totalLinesPages}
                                    className="px-3 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 disabled:opacity-40"
                                >
                                    {t("next")}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* MODAL: ASIGNAR CLIENTE VIRTUAL (z-50) */}
            {mappingCustomer && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-1.5" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                                <IconSparkles size={16} className="text-[#0078D4]" />
                                Asignar Cliente Virtual / Unidad
                            </h3>
                            <button
                                onClick={() => setMappingCustomer(null)}
                                className="text-slate-400 hover:text-slate-600"
                            >
                                <IconX size={18} />
                            </button>
                        </div>

                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {t("mappingHint")}
                        </p>

                        <div className="space-y-3 text-xs">
                            <div>
                                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                                    {t("customerName")}
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ej. Finanzas & Analytics Latam"
                                    value={virtualName}
                                    onChange={(e) => setVirtualName(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>

                            <div>
                                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                                    {t("customerId")}
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ej. cust-finanzas-01"
                                    value={virtualId}
                                    onChange={(e) => setVirtualId(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 font-mono focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                onClick={() => setMappingCustomer(null)}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            >
                                {t("cancel")}
                            </button>
                            <button
                                onClick={handleSaveMapping}
                                disabled={isSavingMapping}
                                className="px-4 py-1.5 rounded-lg bg-[#0078D4] text-white text-xs font-semibold hover:bg-[#0060AA] flex items-center gap-1"
                            >
                                {isSavingMapping ? <IconLoader2 size={14} className="animate-spin" /> : <IconCheck size={14} />}
                                {t("saveMapping")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
