"use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { Loader2, AlertCircle, ShieldCheck, Settings } from "lucide-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import { errorMessage } from '@/lib/apiErrors';

function Card({ title, tooltip, className = "", children }: { title?: string; tooltip?: string; className?: string; children: React.ReactNode }) {
    return (
        <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col ${className}`}>
            {title && (
                <div className="flex items-center gap-1.5 mb-3">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
                    {tooltip && <InfoTooltip content={tooltip} position="bottom" align="left" />}
                </div>
            )}
            {children}
        </div>
    );
}

export default function GovernanceScoreBoard() {
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const { instance, accounts } = useMsal();
    const { locale } = useParams();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [complianceScore, setComplianceScore] = useState<number | null>(null);
    const [perTagBreakdown, setPerTagBreakdown] = useState<Array<{ tagKey: string; compliantPct: number }>>([]);
    const [totalItems, setTotalItems] = useState(0);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === "default" || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const headers = { Authorization: `Bearer ${idToken}` };
                const sub = selectedSubscription && selectedSubscription.toLowerCase() !== "all" ? selectedSubscription : "All";

                const [summaryRes, tagsRes] = await Promise.all([
                    fetch(`/api/dashboard/summary?tenantId=${selectedTenant.id}&subscriptionId=${sub}`, { headers }),
                    fetch(`/api/tags?tenantId=${selectedTenant.id}`, { headers }),
                ]);
                const summaryJson = await summaryRes.json();
                const tagsJson = await tagsRes.json();
                if (!summaryRes.ok) throw new Error(summaryJson.error || "Error al cargar auditoría");

                if (typeof summaryJson.complianceScore === "number") {
                    if (!cancelled) { setComplianceScore(summaryJson.complianceScore); setPerTagBreakdown([]); setTotalItems(0); }
                    return;
                }

                const policies = tagsJson.policies || [];
                const auditResults = summaryJson.auditResults || {};
                const allItems = Object.values(auditResults).flat() as any[];
                const requiredKeys: string[] = policies.filter((p: any) => p.required).map((p: any) => p.tag_key);

                if (requiredKeys.length === 0 || allItems.length === 0) {
                    if (!cancelled) { setComplianceScore(requiredKeys.length === 0 ? -1 : 100); setPerTagBreakdown([]); setTotalItems(allItems.length); }
                    return;
                }

                let compliantCount = 0;
                const perTagCompliant: Record<string, number> = {};
                requiredKeys.forEach((k) => { perTagCompliant[k] = 0; });

                allItems.forEach((item: any) => {
                    const itemTagKeys = Object.keys(item.tags || {}).map((k) => k.toLowerCase());
                    const missing = requiredKeys.filter((reqKey) => !itemTagKeys.includes(reqKey.toLowerCase()));
                    if (missing.length === 0) compliantCount++;
                    requiredKeys.forEach((reqKey) => {
                        if (itemTagKeys.includes(reqKey.toLowerCase())) perTagCompliant[reqKey]++;
                    });
                });

                if (!cancelled) {
                    setComplianceScore(Math.round((compliantCount / allItems.length) * 100));
                    setPerTagBreakdown(requiredKeys.map((k) => ({ tagKey: k, compliantPct: Math.round((perTagCompliant[k] / allItems.length) * 100) })).sort((a, b) => a.compliantPct - b.compliantPct));
                    setTotalItems(allItems.length);
                }
            } catch (e) {
                if (!cancelled) setError(errorMessage(e) || "Error al cargar datos");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedTenant?.id, selectedSubscription, accounts.length]);

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Calculando score de gobernanza...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error}</p>
            </div>
        );
    }

    return (
        <div className="w-full space-y-6">
            <Card>
                <div className="flex flex-col items-center justify-center py-10 text-center">
                    <ShieldCheck className={`w-10 h-10 mb-3 ${complianceScore === -1 ? "text-gray-300" : "text-emerald-500"}`} />
                    <div className="flex items-center gap-1.5 justify-center">
                        <p className="text-sm font-medium text-gray-500">Score de Seguridad Financiera</p>
                        <InfoTooltip content="Porcentaje de recursos en cumplimiento con las políticas de etiquetado y gobernanza activas." position="bottom" align="left" />
                    </div>
                    <span className={`text-5xl font-bold mt-2 ${complianceScore === -1 ? "text-gray-400" : "text-emerald-500"}`}>
                        {complianceScore === null ? "…" : complianceScore === -1 ? "Sin configurar" : `${complianceScore}%`}
                    </span>
                    <p className="text-xs text-gray-400 mt-2 max-w-sm">
                        {complianceScore === -1
                            ? "No hay políticas de etiquetado obligatorias configuradas todavía."
                            : `Basado en ${totalItems} recursos auditados y las políticas de etiquetado activas.`}
                    </p>
                    {complianceScore === -1 && (
                        <button
                            onClick={() => router.push(`/${locale}/governance/tags`)}
                            className="mt-4 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold rounded shadow-sm transition-colors inline-flex items-center gap-2"
                        >
                            <Settings className="w-3.5 h-3.5" /> Configurar Políticas
                        </button>
                    )}
                </div>
            </Card>

            {perTagBreakdown.length > 0 && (
                <Card title="Cumplimiento por Etiqueta Requerida" tooltip="Desglose porcentual de recursos que contienen cada una de las etiquetas obligatorias.">
                    <div className="flex flex-col gap-3">
                        {perTagBreakdown.map((t) => (
                            <div key={t.tagKey}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t.tagKey}</span>
                                    <span className={`text-xs font-bold ${t.compliantPct >= 90 ? "text-emerald-600" : t.compliantPct >= 60 ? "text-amber-600" : "text-red-600"}`}>{t.compliantPct}%</span>
                                </div>
                                <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-2.5">
                                    <div
                                        className={`h-2.5 rounded-full ${t.compliantPct >= 90 ? "bg-emerald-500" : t.compliantPct >= 60 ? "bg-amber-500" : "bg-red-500"}`}
                                        style={{ width: `${t.compliantPct}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
}
