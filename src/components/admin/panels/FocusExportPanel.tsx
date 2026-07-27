"use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { toast } from "sonner";
import { Download, Loader2, FileSpreadsheet, ExternalLink, Clock, Save } from "lucide-react";
import { useTranslations } from "next-intl";

type Format = "csv" | "json" | "ndjson";
type ScheduleFormat = "csv" | "json";

export default function FocusExportPage() {
    const t = useTranslations("AdminFocusExport");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const today = new Date().toISOString().slice(0, 10);
    const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const [from, setFrom] = useState(thirtyAgo);
    const [to, setTo] = useState(today);
    const [subscriptionId, setSubscriptionId] = useState("");
    const [format, setFormat] = useState<Format>("csv");
    const [loading, setLoading] = useState(false);

    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [scheduleFormat, setScheduleFormat] = useState<ScheduleFormat>("csv");
    const [scheduleSubscriptionId, setScheduleSubscriptionId] = useState("");
    const [scheduleEmail, setScheduleEmail] = useState("");
    const [scheduleLastRun, setScheduleLastRun] = useState<string | null>(null);
    const [scheduleLoading, setScheduleLoading] = useState(true);
    const [scheduleSaving, setScheduleSaving] = useState(false);

    async function authHeaders(): Promise<Record<string, string>> {
        if (!selectedTenant || isMockTenant(selectedTenant.id) || accounts.length === 0) return {};
        const idToken = await getFreshIdToken(instance, accounts[0]);
        return idToken ? { Authorization: `Bearer ${idToken}` } : {};
    }

    useEffect(() => {
        const loadSchedule = async () => {
            if (!selectedTenant || selectedTenant.id === "default") {
                setScheduleLoading(false);
                return;
            }
            setScheduleLoading(true);
            try {
                const headers = await authHeaders();
                const res = await fetch(`/api/admin/focus-export/schedule?tenantId=${selectedTenant.id}`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    setScheduleEnabled(Boolean(data.enabled));
                    setScheduleFormat((data.format as ScheduleFormat) || "csv");
                    setScheduleSubscriptionId(data.subscriptionId || "");
                    setScheduleEmail(data.recipientEmail || "");
                    setScheduleLastRun(data.lastRunAt || null);
                }
            } catch (e) {
                console.error("Error loading FOCUS export schedule:", e);
            }
            setScheduleLoading(false);
        };
        loadSchedule();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTenant?.id]);

    async function handleSaveSchedule() {
        if (!selectedTenant || selectedTenant.id === "default") return;
        if (scheduleEnabled && !scheduleEmail.trim()) {
            toast.error(t("errors.recipientEmailRequired"));
            return;
        }

        setScheduleSaving(true);
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch("/api/admin/focus-export/schedule", {
                method: "PATCH",
                headers,
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    enabled: scheduleEnabled,
                    format: scheduleFormat,
                    subscriptionId: scheduleSubscriptionId.trim() || undefined,
                    recipientEmail: scheduleEmail.trim(),
                }),
            });
            if (res.ok) {
                toast.success(t("toasts.scheduleSaved"));
            } else {
                const j = await res.json().catch(() => ({ error: t("errors.saveFailed") }));
                toast.error(j.error || t("errors.saveFailed"));
            }
        } catch (e: any) {
            toast.error(e?.message || t("errors.unexpectedError"));
        } finally {
            setScheduleSaving(false);
        }
    }

    async function handleDownload() {
        if (!selectedTenant || selectedTenant.id === "default") {
            toast.error(t("errors.selectTenantFirst"));
            return;
        }
        if (from > to) {
            toast.error(t("errors.invalidDateRange"));
            return;
        }

        setLoading(true);
        try {
            let headers: Record<string, string> = {};
            if (!isMockTenant(selectedTenant.id) && accounts.length > 0) {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                headers = { Authorization: `Bearer ${idToken}` };
            }

            const params = new URLSearchParams({
                tenantId: selectedTenant.id,
                from,
                to,
                format,
            });
            if (subscriptionId.trim()) params.set("subscriptionId", subscriptionId.trim());

            const res = await fetch(`/api/exports/focus?${params}`, { headers });
            if (!res.ok) {
                const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                toast.error(j.error || t("errors.exportFailed"));
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `focus-${selectedTenant.id}-${from}-${to}.${format === "json" ? "json" : format === "ndjson" ? "ndjson" : "csv"}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success(t("toasts.exportGenerated"));
        } catch (e: any) {
            toast.error(e?.message || t("errors.unexpectedError"));
        } finally {
            setLoading(false);
        }
    }

    if (selectedTenant.id === "default") {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 shadow-sm">
                <span className="text-4xl mb-4">📊</span>
                <h2 className="text-xl font-bold text-gray-700">{t("selectTenant.title")}</h2>
                <p className="text-sm text-gray-500 mt-2">{t("selectTenant.description")}</p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto p-6 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 animate-in fade-in duration-500">
            <div className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <FileSpreadsheet className="text-indigo-600 w-6 h-6" /> {t("title")}
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                    {t.rich("subtitle", { strong: (chunks) => <strong>{chunks}</strong> })}
                </p>
                <a
                    href="https://focus.finops.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-2"
                >
                    {t("viewSpecLink")} <ExternalLink className="w-3 h-3" />
                </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t("dateFrom")}</label>
                    <input
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        max={to}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t("dateTo")}</label>
                    <input
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        min={from}
                        max={today}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t("subscriptionIdOptional")}</label>
                    <input
                        type="text"
                        value={subscriptionId}
                        onChange={(e) => setSubscriptionId(e.target.value)}
                        placeholder={t("subscriptionIdPlaceholder")}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t("format")}</label>
                    <select
                        value={format}
                        onChange={(e) => setFormat(e.target.value as Format)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="csv">{t("formatOptions.csv")}</option>
                        <option value="json">{t("formatOptions.json")}</option>
                        <option value="ndjson">{t("formatOptions.ndjson")}</option>
                    </select>
                </div>
            </div>

            <button
                onClick={handleDownload}
                disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
            >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {t("downloadButton")}
            </button>

            <div className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-800">
                <h2 className="text-sm font-bold flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-indigo-600" /> {t("schedule.heading")}
                </h2>
                <p className="text-xs text-gray-500 mb-4">
                    {t("schedule.description")}
                </p>

                {scheduleLoading ? (
                    <div className="text-xs text-gray-500">{t("schedule.loading")}</div>
                ) : (
                    <div className="space-y-4">
                        <label className="flex items-center justify-between max-w-md cursor-pointer">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("schedule.toggleLabel")}</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={scheduleEnabled}
                                onClick={() => setScheduleEnabled(!scheduleEnabled)}
                                className={`ml-4 shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    scheduleEnabled ? "bg-indigo-600" : "bg-gray-300 dark:bg-slate-700"
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        scheduleEnabled ? "translate-x-6" : "translate-x-1"
                                    }`}
                                />
                            </button>
                        </label>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">{t("schedule.recipientEmail")}</label>
                                <input
                                    type="email"
                                    value={scheduleEmail}
                                    onChange={(e) => setScheduleEmail(e.target.value)}
                                    placeholder="finops@tuempresa.com"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">{t("format")}</label>
                                <select
                                    value={scheduleFormat}
                                    onChange={(e) => setScheduleFormat(e.target.value as ScheduleFormat)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="csv">{t("formatOptions.csv")}</option>
                                    <option value="json">{t("formatOptions.json")}</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">{t("subscriptionIdOptional")}</label>
                                <input
                                    type="text"
                                    value={scheduleSubscriptionId}
                                    onChange={(e) => setScheduleSubscriptionId(e.target.value)}
                                    placeholder={t("subscriptionIdPlaceholder")}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                        </div>

                        {scheduleLastRun && (
                            <p className="text-xs text-gray-500">{t("schedule.lastRun", { datetime: new Date(scheduleLastRun).toLocaleString() })}</p>
                        )}

                        <button
                            onClick={handleSaveSchedule}
                            disabled={scheduleSaving}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 dark:bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-gray-900 dark:hover:bg-slate-600 disabled:opacity-50 transition"
                        >
                            {scheduleSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {t("schedule.saveButton")}
                        </button>
                    </div>
                )}
            </div>

            <div className="mt-6 text-xs text-gray-500 border-t pt-4">
                <p className="mb-1"><strong>{t("apiAccess.heading")}</strong></p>
                <code className="block bg-gray-100 dark:bg-slate-800 p-2 rounded text-[11px] overflow-x-auto">
                    GET /api/exports/focus?tenantId=...&amp;from=YYYY-MM-DD&amp;to=YYYY-MM-DD&amp;format=csv
                </code>
                <p className="mt-2">{t.rich("apiAccess.authDescription", { code: (chunks) => <code>{chunks}</code> })}</p>
            </div>
        </div>
    );
}
