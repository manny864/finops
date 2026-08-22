"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, FileText } from "lucide-react";
import { errorMessage } from '@/lib/apiErrors';

type HistoryItem = {
    id: number;
    requested_by_email: string;
    scope_subscription_id: string;
    scope_subscription_name: string;
    locale: string;
    created_at: string;
    completed_at: string;
    emailed_to_requester_at: string | null;
};

export default function ExecutiveReportsHistoryPanel() {
    const t = useTranslations("AdminReportHistory");
    const localeT = useTranslations("AdminReport");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [items, setItems] = useState<HistoryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [selectedReport, setSelectedReport] = useState<string>("");
    const [loadingReport, setLoadingReport] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(15);
    const [total, setTotal] = useState(0);
    const [retentionDays, setRetentionDays] = useState(90);

    const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

    const loadList = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") return;
        setLoading(true);
        setError(null);
        try {
            const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : "";
            const res = await fetch(
                `/api/intelligence/executive-report/history?tenantId=${encodeURIComponent(selectedTenant.id)}&page=${page}&pageSize=${pageSize}`,
                { headers: { Authorization: `Bearer ${idToken}` } }
            );
            const json = await res.json();
            if (!res.ok || !json?.success) {
                throw new Error(json?.error || `HTTP ${res.status}`);
            }
            setItems(Array.isArray(json.items) ? json.items : []);
            setTotal(Number(json.total || 0));
            setRetentionDays(Number(json.retentionDays || 90));
        } catch (e) {
            setError(errorMessage(e) || t("loadError"));
            setItems([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [accounts, instance, selectedTenant?.id, page, pageSize, t]);

    const loadReport = useCallback(
        async (id: number) => {
            if (!selectedTenant?.id || selectedTenant.id === "default") return;
            setSelectedId(id);
            setLoadingReport(true);
            setError(null);
            try {
                const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : "";
                const res = await fetch(
                    `/api/intelligence/executive-report/history/${id}?tenantId=${encodeURIComponent(selectedTenant.id)}`,
                    { headers: { Authorization: `Bearer ${idToken}` } }
                );
                const json = await res.json();
                if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
                setSelectedReport(String(json.report || ""));
            } catch (e) {
                setSelectedReport("");
                setError(errorMessage(e) || t("reportLoadError"));
            } finally {
                setLoadingReport(false);
            }
        },
        [accounts, instance, selectedTenant?.id, t]
    );

    useEffect(() => {
        setSelectedId(null);
        setSelectedReport("");
        setPage(1);
    }, [selectedTenant?.id]);

    useEffect(() => {
        void loadList();
    }, [loadList]);

    if (selectedTenant?.id === "default") {
        return <div className="p-6 text-sm text-gray-500">{localeT("selectTenantSubtitle")}</div>;
    }

    return (
        <div className="p-6 space-y-6">
            <div>
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <FileText className="w-6 h-6 text-indigo-600" />
                    {t("title")}
                </h2>
                <p className="text-sm text-gray-500 mt-1">{t("subtitle", { days: retentionDays })}</p>
            </div>

            <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-gray-600">{t("totalLabel", { total })}</div>
                <div className="flex items-center gap-2">
                    <label htmlFor="history-page-size" className="text-xs text-gray-500">
                        {t("pageSize")}
                    </label>
                    <select
                        id="history-page-size"
                        className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm"
                        value={pageSize}
                        onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setPage(1);
                        }}
                    >
                        <option value={15}>15</option>
                        <option value={30}>30</option>
                        <option value={45}>45</option>
                        <option value={60}>60</option>
                    </select>
                </div>
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full min-w-[900px] text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="text-left px-3 py-2">{t("colDate")}</th>
                            <th className="text-left px-3 py-2">{t("colScope")}</th>
                            <th className="text-left px-3 py-2">{t("colRequestedBy")}</th>
                            <th className="text-left px-3 py-2">{t("colEmailSent")}</th>
                            <th className="text-left px-3 py-2">{t("colActions")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                                    <span className="inline-flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
                                    </span>
                                </td>
                            </tr>
                        ) : items.length === 0 ? (
                            <tr>
                                <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                                    {t("empty")}
                                </td>
                            </tr>
                        ) : (
                            items.map((item) => (
                                <tr key={item.id} className="border-b border-gray-100 last:border-0">
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        {new Date(item.created_at).toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2">
                                        {item.scope_subscription_name} ({item.scope_subscription_id})
                                    </td>
                                    <td className="px-3 py-2">{item.requested_by_email}</td>
                                    <td className="px-3 py-2">
                                        {item.emailed_to_requester_at ? t("yes") : t("no")}
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => void loadReport(item.id)}
                                                className="px-2.5 py-1.5 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700"
                                            >
                                                {t("view")}
                                            </button>
                                            <a
                                                href={`/${item.locale || "es"}/admin/reports?tab=executive&reportJob=${item.id}`}
                                                className="px-2.5 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-50"
                                            >
                                                {t("openExecutiveTab")}
                                            </a>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-end gap-2">
                <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 text-sm rounded border border-gray-300 disabled:opacity-50"
                >
                    {t("prev")}
                </button>
                <span className="text-sm text-gray-600">
                    {t("pageLabel", { page, totalPages })}
                </span>
                <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 text-sm rounded border border-gray-300 disabled:opacity-50"
                >
                    {t("next")}
                </button>
            </div>

            {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">{error}</div>}

            {selectedId && (
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <h3 className="text-lg font-semibold mb-3">{t("selectedReportTitle", { id: selectedId })}</h3>
                    {loadingReport ? (
                        <div className="text-sm text-gray-500 inline-flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" /> {t("loadingReport")}
                        </div>
                    ) : (
                        <div className="prose prose-sm max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedReport}</ReactMarkdown>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
