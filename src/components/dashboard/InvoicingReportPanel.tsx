"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { Loader2, AlertTriangle, Download, FileText, DollarSign, TrendingUp, Percent, Mail } from "lucide-react";
import { toast } from "sonner";
import { getFreshIdToken } from "@/lib/msalToken";

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
    const opts = [];
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

    const periodOptions = getPeriodOptions();
    const [period, setPeriod] = useState(periodOptions[0].value);
    const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);
    const [sendingEmail, setSendingEmail] = useState<string | null>(null);

    const fetcher = async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error("No hay cuenta autenticada");
        const token = await getFreshIdToken(instance, account);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const j = await res.json();
            throw new Error(j.error || "Error al cargar reporte de facturación");
        }
        return res.json();
    };

    const apiUrl =
        selectedTenant && selectedTenant.id !== "default" && accounts.length > 0
            ? `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=json`
            : null;

    const { data, error, isLoading } = useSWR(apiUrl, fetcher, { revalidateOnFocus: false });

    const handleDownloadCsv = () => {
        if (!selectedTenant || !accounts[0]) return;
        window.open(`/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=csv`, "_blank");
    };

    const handleDownloadJson = () => {
        if (!selectedTenant || !accounts[0]) return;
        window.open(`/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=json`, "_blank");
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
            toast.success("ZIP downloaded successfully");
        } catch (err: any) {
            toast.error(err.message || "Failed to download ZIP");
        } finally {
            setDownloadingPdf(null);
        }
    };

    const handleDownloadPdf = async (customerId: string) => {
        try {
            if (!selectedTenant || !accounts[0]) return;
            setDownloadingPdf(customerId);
            const account = accounts[0];
            const token = await getFreshIdToken(instance, account);
            const res = await fetch(
                `/api/admin/report/invoicing?tenantId=${selectedTenant.id}&period=${period}&format=pdf&customerId=${customerId}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!res.ok) throw new Error("Failed to download PDF");
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `showback-${customerId}-${period}.pdf`;
            a.click();
            window.URL.revokeObjectURL(url);
            toast.success("PDF downloaded successfully");
        } catch (err: any) {
            toast.error(err.message || "Failed to download PDF");
        } finally {
            setDownloadingPdf(null);
        }
    };

    const handleEmailPdf = async (customerId: string) => {
        try {
            setSendingEmail(customerId);
            const account = accounts[0];
            if (!account) throw new Error("No authenticated account");
            const token = await getFreshIdToken(instance, account);
            const recipientEmail = prompt("Enter recipient email address:");
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
                throw new Error(errData.error || "Failed to send email");
            }

            toast.success("Email sent successfully");
        } catch (err: any) {
            toast.error(err.message || "Failed to send email");
        } finally {
            setSendingEmail(null);
        }
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Cargando reporte de facturación...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const { totals, byCustomer, mock, markupPercent, currency } = data;

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
                    <label className="text-sm text-slate-500 dark:text-slate-400">Período:</label>
                    <select
                        value={period}
                        onChange={e => setPeriod(e.target.value)}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                    >
                        {periodOptions.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </div>
                {markupPercent != null && (
                    <div className="flex items-center gap-1.5 text-xs bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50 px-3 py-1.5 rounded-lg">
                        <Percent className="w-3 h-3" />
                        Markup aplicado: <strong>{markupPercent}%</strong>
                    </div>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleDownloadZip}
                        disabled={downloadingPdf !== null}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                    >
                        {downloadingPdf === "zip" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        Download All (ZIP)
                    </button>
                    <button
                        onClick={handleDownloadCsv}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                        <Download className="w-4 h-4" /> Descargar CSV
                    </button>
                    <button
                        onClick={handleDownloadJson}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                    >
                        <Download className="w-4 h-4" /> JSON
                    </button>
                </div>
            </div>

            {/* KPI cards */}
            {totals && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <KpiCard label="Costo Original" value={`$${totals.originalCost.toLocaleString()} ${currency}`} icon={<DollarSign className="w-5 h-5" />} />
                    <KpiCard label="Monto Markup" value={`$${totals.markupAmount.toLocaleString()} ${currency}`} sub={`${markupPercent}% sobre el original`} icon={<Percent className="w-5 h-5" />} accent="amber" />
                    <KpiCard label="Costo Ajustado" value={`$${totals.adjustedCost.toLocaleString()} ${currency}`} icon={<TrendingUp className="w-5 h-5" />} accent="green" />
                </div>
            )}

            {/* By Customer table */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" />
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Facturación por Cliente</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left font-semibold">Cliente</th>
                                <th className="px-4 py-3 text-left font-semibold">Customer ID</th>
                                <th className="px-4 py-3 text-right font-semibold">Costo Original</th>
                                <th className="px-4 py-3 text-right font-semibold">Costo Ajustado</th>
                                <th className="px-4 py-3 text-center font-semibold">Acciones</th>
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
                                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">No hay datos para el período seleccionado.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
