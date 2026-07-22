"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { isMockTenant } from "@/lib/mockData";
import { Loader2, AlertTriangle, Download, FileText, DollarSign, TrendingUp, Percent, Mail, FileSpreadsheet, Receipt, Layers } from "lucide-react";
import { toast } from "sonner";
import { getFreshIdToken } from "@/lib/msalToken";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import Pagination, { usePagination } from "@/components/Pagination";

function KpiCard({ label, value, sub, icon, accent = "blue" }: { label: string; value: string; sub?: string; icon: React.ReactNode; accent?: string }) {
    const bg = accent === "green" ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" : accent === "amber" ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400" : "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400";
    return (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-3">
            <div className={`p-2 rounded-lg shrink-0 ${bg}`}>{icon}</div>
            <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
                <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p>
                {sub && <p className="text-xs text-slate-400">{sub}</p>}
            </div>
        </div>
    );
}

function getPeriodOptions(): { value: string; label: string }[] {
    const opts: { value: string; label: string }[] = [
        { value: "last3m", label: "Últimos 3 meses" },
    ];
    const now = new Date();
    for (let i = 0; i < 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = d.toLocaleString("es-AR", { month: "long", year: "numeric" });
        opts.push({ value, label });
    }
    return opts;
}

export default function InvoicingReportPanel() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tMock = useTranslations("Mock");
    const t = useTranslations("Invoicing");

    const periodOptions = getPeriodOptions();
    const [period, setPeriod] = useState(periodOptions[0].value);
    const [customMonth, setCustomMonth] = useState("");
    const [subscriptionId, setSubscriptionId] = useState("");
    const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);
    const [sendingEmail, setSendingEmail] = useState<string | null>(null);
    const [downloadingPbit, setDownloadingPbit] = useState(false);

    // Ventana de retención de Azure Cost Management — más atrás que esto no
    // hay datos para traer aunque se elija el mes en el picker.
    const MIN_MONTH = (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 13);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const MAX_MONTH = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();

    const authHeaders = async (): Promise<Record<string, string>> => {
        // Tenants demo/mock no tienen cuenta MSAL real (login demo/demo,
        // ver setDemoSession) — la API server-side ya salta requireTenantRole
        // para isMockTenant, así que acá alcanza con no mandar Authorization.
        if (isMockTenant(selectedTenant?.id || "")) return {};
        const account = accounts[0];
        if (!account) throw new Error(t("noAccount"));
        const token = await getFreshIdToken(instance, account);
        return { Authorization: `Bearer ${token}` };
    };

    const fetcher = async (url: string) => {
        const headers = await authHeaders();
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const j = await res.json();
            throw new Error(j.error || t("toastLoadError"));
        }
        return res.json();
    };

    // Descarga un archivo autenticado vía fetch+blob. window.open() no puede
    // adjuntar el header Authorization, así que en tenants reales (no mock)
    // esas descargas devolvían 401 en silencio — con fetch se ve el error.
    const downloadFile = async (url: string, filename: string) => {
        const headers = await authHeaders();
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error || t("toastDownloadError", { filename }));
        }
        const blob = await res.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(objectUrl);
    };

    const apiUrl =
        selectedTenant && selectedTenant.id !== "default" && (isMockTenant(selectedTenant.id) || accounts.length > 0)
            ? `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=json${subscriptionId ? `&subscriptionId=${encodeURIComponent(subscriptionId)}` : ""}`
            : null;

    const { data, error, isLoading } = useSWR(apiUrl, fetcher, { revalidateOnFocus: false });

    const sectionsPagination = usePagination(data?.byInvoiceSection, 10);
    const subscriptionsPagination = usePagination(data?.bySubscription, 10);
    const linesPagination = usePagination(data?.lines, 25);

    const handleExportPbit = async () => {
        try {
            if (!selectedTenant) return;
            setDownloadingPbit(true);
            await downloadFile(
                `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=pbit`,
                `invoicing-${period}.pbids`
            );
            toast.success(t("toastPbidsSuccess"));
        } catch (err: any) {
            toast.error(err.message || t("toastPbidsError"));
        } finally {
            setDownloadingPbit(false);
        }
    };

    const subParam = subscriptionId ? `&subscriptionId=${encodeURIComponent(subscriptionId)}` : "";

    const handleDownloadCsv = async () => {
        if (!selectedTenant) return;
        try {
            await downloadFile(
                `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=csv${subParam}`,
                `invoicing-${period}.csv`
            );
        } catch (err: any) {
            toast.error(err.message || t("toastCsvError"));
        }
    };

    const handleDownloadJson = async () => {
        if (!selectedTenant) return;
        try {
            await downloadFile(
                `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=json${subParam}`,
                `invoicing-${period}.json`
            );
        } catch (err: any) {
            toast.error(err.message || t("toastJsonError"));
        }
    };

    const handleDownloadZip = async () => {
        try {
            if (!selectedTenant || !accounts[0]) return;
            setDownloadingPdf("zip");
            const account = accounts[0];
            const token = await getFreshIdToken(instance, account);
            const res = await fetch(
                `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=pdf`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!res.ok) throw new Error("Failed to download PDF ZIP");
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `showback-${period}.zip`;
            a.click();
            window.URL.revokeObjectURL(url);
            toast.success(t("toastZipSuccess"));
        } catch (err: any) {
            toast.error(err.message || t("toastZipError"));
        } finally {
            setDownloadingPdf(null);
        }
    };

    const handleDownloadPdf = async (customerId: string) => {
        try {
            if (!selectedTenant || !accounts[0]) return;
            // customerId puede llegar null/undefined si el navegador tiene un
            // fetch stale de antes de que el backend empezara a devolver
            // siempre un customerId (ver NO_CUSTOMER_ID en route.ts) — sin
            // este guard se mandaba "customerId=null" literal y el backend
            // respondía 404/400 sin contexto.
            if (!customerId) {
                toast.error(t("toastStaleData"));
                return;
            }
            setDownloadingPdf(customerId);
            const account = accounts[0];
            const token = await getFreshIdToken(instance, account);
            const res = await fetch(
                `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=pdf&customerId=${customerId}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!res.ok) throw new Error(t("toastPdfError"));
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `showback-${customerId}-${period}.pdf`;
            a.click();
            window.URL.revokeObjectURL(url);
            toast.success(t("toastPdfSuccess"));
        } catch (err: any) {
            toast.error(err.message || t("toastPdfError"));
        } finally {
            setDownloadingPdf(null);
        }
    };

    const handleEmailPdf = async (customerId: string) => {
        if (!customerId) {
            toast.error(t("toastStaleData"));
            return;
        }
        try {
            setSendingEmail(customerId);
            const account = accounts[0];
            if (!account) throw new Error(t("noAccount"));
            const token = await getFreshIdToken(instance, account);
            const recipientEmail = prompt(t("promptRecipientEmail"));
            if (!recipientEmail) return;

            const res = await fetch("/api/admin/report/invoicing/email", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    tenantId: selectedTenant?.id,
                    period,
                    customerId,
                    recipientEmail,
                }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || t("toastEmailError"));
            }

            toast.success(t("toastEmailSuccess"));
        } catch (err: any) {
            toast.error(err.message || t("toastEmailError"));
        } finally {
            setSendingEmail(null);
        }
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t("tierFeatureName")} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {t("errorTitle")}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const { totals, byCustomer, byInvoiceSection, bySubscription, availableSubscriptions, lines, mock, markupPercent, currency } = data;

    return (
        <div className="w-full space-y-6">
            {/* Mock banner */}
            {mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-300 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span><strong>{tMock("badge")}</strong> — {tMock("description")}</span>
                </div>
            )}

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-500 dark:text-slate-400">{t("periodLabel")}</label>
                    <select
                        value={customMonth ? "" : period}
                        onChange={e => {
                            setCustomMonth("");
                            setPeriod(e.target.value);
                        }}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                    >
                        {periodOptions.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-500 dark:text-slate-400">{t("monthLabel")}</label>
                    <input
                        type="month"
                        value={customMonth}
                        min={MIN_MONTH}
                        max={MAX_MONTH}
                        onChange={e => {
                            const v = e.target.value;
                            setCustomMonth(v);
                            if (v) setPeriod(v);
                        }}
                        title={t("monthTooltip")}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                    />
                </div>
                {availableSubscriptions && availableSubscriptions.length > 1 && (
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-500 dark:text-slate-400">{t("subscriptionLabel")}</label>
                        <select
                            value={subscriptionId}
                            onChange={e => setSubscriptionId(e.target.value)}
                            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        >
                            <option value="">{t("allSubscriptions")}</option>
                            {availableSubscriptions.map((s: { id: string; name: string }) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                )}
                {markupPercent != null && (
                    <div className="flex items-center gap-1.5 text-xs bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50 px-3 py-1.5 rounded-lg">
                        <Percent className="w-3 h-3" />
                        {t("markupApplied")} <strong>{markupPercent}%</strong>
                    </div>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleDownloadZip}
                        disabled={downloadingPdf !== null}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                    >
                        {downloadingPdf === "zip" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {t("downloadZip")}
                    </button>
                    <button
                        onClick={handleDownloadCsv}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                        <Download className="w-4 h-4" /> {t("downloadCsv")}
                    </button>
                    <button
                        onClick={handleDownloadJson}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                    >
                        <Download className="w-4 h-4" /> JSON
                    </button>
                    <button
                        onClick={handleExportPbit}
                        disabled={downloadingPbit}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                        title={t("pbidsTooltip")}
                    >
                        {downloadingPbit ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                        Power BI (.pbids)
                    </button>
                </div>
            </div>

            {/* KPI cards */}
            {totals && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <KpiCard label={t("kpiOriginalCost")} value={`$${totals.originalCost.toLocaleString()} ${currency}`} icon={<DollarSign className="w-5 h-5" />} />
                    <KpiCard label={t("kpiMarkupAmount")} value={`$${totals.markupAmount.toLocaleString()} ${currency}`} sub={t("kpiMarkupSub", { percent: markupPercent })} icon={<Percent className="w-5 h-5" />} accent="amber" />
                    <KpiCard label={t("kpiAdjustedCost")} value={`$${totals.adjustedCost.toLocaleString()} ${currency}`} icon={<TrendingUp className="w-5 h-5" />} accent="green" />
                </div>
            )}

            {/* By Customer table */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" />
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("tableByCustomer")}</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left font-semibold">{t("colCustomer")}</th>
                                <th className="px-4 py-3 text-left font-semibold">Customer ID</th>
                                <th className="px-4 py-3 text-right font-semibold">{t("colOriginalCost")}</th>
                                <th className="px-4 py-3 text-right font-semibold">{t("colAdjustedCost")}</th>
                                <th className="px-4 py-3 text-center font-semibold">{t("colActions")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                            {(byCustomer ?? []).map((c: any) => (
                                <tr key={c.customerId} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{c.customerName || c.customerId}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.customerId}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">${c.originalCost.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">${c.adjustedCost.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => handleDownloadPdf(c.customerId)}
                                                disabled={downloadingPdf !== null}
                                                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                                title="Download PDF"
                                            >
                                                {downloadingPdf === c.customerId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                                PDF
                                            </button>
                                            <button
                                                onClick={() => handleEmailPdf(c.customerId)}
                                                disabled={sendingEmail !== null}
                                                className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-50"
                                                title="Email PDF"
                                            >
                                                {sendingEmail === c.customerId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                                                Email
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {(!byCustomer || byCustomer.length === 0) && (
                                <tr>
                                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">{t("noDataPeriod")}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* By Invoice Section table */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-blue-500" />
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("tableByInvoiceSection")}</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left font-semibold">Invoice Section ID</th>
                                <th className="px-4 py-3 text-left font-semibold">Customer ID</th>
                                <th className="px-4 py-3 text-right font-semibold">{t("colCost")}</th>
                                <th className="px-4 py-3 text-right font-semibold">{t("colAdjusted")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                            {sectionsPagination.paged.map((s: any) => (
                                <tr key={s.invoiceSectionId} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">{s.invoiceSectionId}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{s.customerId}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">${s.cost.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">${s.adjusted.toLocaleString()}</td>
                                </tr>
                            ))}
                            {(!byInvoiceSection || byInvoiceSection.length === 0) && (
                                <tr>
                                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">{t("noDataPeriod")}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {byInvoiceSection && byInvoiceSection.length > 10 && (
                    <div className="px-4 py-2 border-t border-gray-100 dark:border-slate-800">
                        <Pagination {...sectionsPagination} />
                    </div>
                )}
            </div>

            {/* By Subscription table */}
            {bySubscription && bySubscription.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
                        <Layers className="w-4 h-4 text-blue-500" />
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("tableBySubscription")}</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs">
                                <tr>
                                    <th className="px-4 py-3 text-left font-semibold">{t("colSubscription")}</th>
                                    <th className="px-4 py-3 text-right font-semibold">{t("colOriginalCost")}</th>
                                    <th className="px-4 py-3 text-right font-semibold">{t("colAdjustedCost")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                {subscriptionsPagination.paged.map((s: any) => (
                                    <tr key={s.subscriptionId} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200" title={s.subscriptionId}>{s.subscriptionName || s.subscriptionId}</td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">${s.originalCost.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">${s.adjustedCost.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-gray-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-200 font-semibold border-t-2 border-gray-200 dark:border-slate-700">
                                <tr>
                                    <td className="px-4 py-3 text-left">{t("totalSubscriptions", { count: bySubscription.length })}</td>
                                    <td className="px-4 py-3 text-right font-mono">${bySubscription.reduce((sum: number, s: any) => sum + s.originalCost, 0).toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-400">${bySubscription.reduce((sum: number, s: any) => sum + s.adjustedCost, 0).toLocaleString()}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    {bySubscription.length > 10 && (
                        <div className="px-4 py-2 border-t border-gray-100 dark:border-slate-800">
                            <Pagination {...subscriptionsPagination} />
                        </div>
                    )}
                </div>
            )}

            {/* Line-level detail table (billing profile + invoice section + customer) */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" />
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("tableLines")}</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left font-semibold">{t("colDate")}</th>
                                <th className="px-4 py-3 text-left font-semibold">Customer</th>
                                <th className="px-4 py-3 text-left font-semibold">Billing Profile</th>
                                <th className="px-4 py-3 text-left font-semibold">Invoice Section</th>
                                <th className="px-4 py-3 text-left font-semibold">{t("colService")}</th>
                                <th className="px-4 py-3 text-left font-semibold">Resource Group</th>
                                <th className="px-4 py-3 text-right font-semibold">{t("colOriginalCost")}</th>
                                <th className="px-4 py-3 text-right font-semibold">{t("colAdjustedCost")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                            {linesPagination.paged.map((l: any, idx: number) => (
                                <tr key={`${l.date}-${l.customerId}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{l.date}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{l.customerName || l.customerId}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{l.billingProfileId || "—"}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{l.invoiceSectionId || "—"}</td>
                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{l.service}</td>
                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{l.resourceGroup}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">${l.originalCost.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">${l.adjustedCost.toLocaleString()}</td>
                                </tr>
                            ))}
                            {(!lines || lines.length === 0) && (
                                <tr>
                                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">{t("noLinesPeriod")}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {lines && lines.length > 0 && (
                    <div className="px-4 py-2 border-t border-gray-100 dark:border-slate-800">
                        <Pagination {...linesPagination} />
                    </div>
                )}
            </div>
        </div>
    );
}
