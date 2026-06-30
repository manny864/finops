"use client";
import React, { useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { toast } from "sonner";
import { Download, Loader2, FileSpreadsheet, ExternalLink } from "lucide-react";

type Format = "csv" | "json" | "ndjson";

export default function FocusExportPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const today = new Date().toISOString().slice(0, 10);
    const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const [from, setFrom] = useState(thirtyAgo);
    const [to, setTo] = useState(today);
    const [subscriptionId, setSubscriptionId] = useState("");
    const [format, setFormat] = useState<Format>("csv");
    const [loading, setLoading] = useState(false);

    async function handleDownload() {
        if (!selectedTenant || selectedTenant.id === "default") {
            toast.error("Seleccioná un tenant primero.");
            return;
        }
        if (from > to) {
            toast.error("La fecha 'desde' no puede ser posterior a 'hasta'.");
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
                toast.error(j.error || "Error al exportar.");
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
            toast.success("Export FOCUS 1.1 generado.");
        } catch (e: any) {
            toast.error(e?.message || "Error inesperado.");
        } finally {
            setLoading(false);
        }
    }

    if (selectedTenant.id === "default") {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 shadow-sm">
                <span className="text-4xl mb-4">📊</span>
                <h2 className="text-xl font-bold text-gray-700">Seleccioná un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Necesitás un tenant para exportar su billing en formato FOCUS.</p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto p-6 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 animate-in fade-in duration-500">
            <div className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <FileSpreadsheet className="text-indigo-600 w-6 h-6" /> FOCUS 1.1 Export
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                    Exportá tu billing en el formato estándar <strong>FinOps Open Cost &amp; Usage Specification 1.1</strong>.
                    Compatible con FOCUS Validator, CCAF, Power BI, OpenCost y la mayoría de herramientas FinOps.
                </p>
                <a
                    href="https://focus.finops.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-2"
                >
                    Ver especificación FOCUS <ExternalLink className="w-3 h-3" />
                </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Desde</label>
                    <input
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        max={to}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Hasta</label>
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
                    <label className="block text-xs font-medium text-gray-700 mb-1">Subscription ID (opcional)</label>
                    <input
                        type="text"
                        value={subscriptionId}
                        onChange={(e) => setSubscriptionId(e.target.value)}
                        placeholder="dejar vacío para todas"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Formato</label>
                    <select
                        value={format}
                        onChange={(e) => setFormat(e.target.value as Format)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="csv">CSV (FOCUS estándar)</option>
                        <option value="json">JSON</option>
                        <option value="ndjson">NDJSON (streaming)</option>
                    </select>
                </div>
            </div>

            <button
                onClick={handleDownload}
                disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
            >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Descargar FOCUS 1.1
            </button>

            <div className="mt-6 text-xs text-gray-500 border-t pt-4">
                <p className="mb-1"><strong>Acceso programático:</strong></p>
                <code className="block bg-gray-100 dark:bg-slate-800 p-2 rounded text-[11px] overflow-x-auto">
                    GET /api/exports/focus?tenantId=...&amp;from=YYYY-MM-DD&amp;to=YYYY-MM-DD&amp;format=csv
                </code>
                <p className="mt-2">Autenticación: <code>Authorization: Bearer mcp_...</code> con MCP API key del tenant.</p>
            </div>
        </div>
    );
}
