"use client";
import React, { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { Tag, Play, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import Pagination, { usePagination } from "@/components/Pagination";
import FeatureGuard from "@/components/FeatureGuard";

interface PreviewRow {
    resourceId: string;
    resourceName: string;
    resourceType: string;
    resourceGroupName: string;
    location: string;
    existingTags: Record<string, string>;
    rgTags: Record<string, string>;
    missingTags: Record<string, string>;
}

export default function TagInheritancePanel() {
    const t = useTranslations("TagInheritance");
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const { instance, accounts } = useMsal();

    // Los endpoints de tags pasan por requireTenantAccess → exigen Bearer token.
    // Sin este header, el fetch devolvía 401 al pulsar "Analizar".
    const getToken = async () => {
        return getFreshIdToken(instance, accounts[0], ["User.Read"]);
    };

    const [tagKeys, setTagKeys] = useState("");
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [rows, setRows] = useState<PreviewRow[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [applyResult, setApplyResult] = useState<{ applied: number; failed: number } | null>(null);

    const runPreview = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") {
            setError(t("errorSelectTenant"));
            return;
        }
        setLoading(true); setError(null); setApplyResult(null);
        try {
            const params = new URLSearchParams({
                tenantId: selectedTenant.id,
                subscriptionId: selectedSubscription || "All",
            });
            if (tagKeys.trim()) params.set("tagKeys", tagKeys.trim());

            const token = await getToken();
            const res = await fetch(`/api/governance/tags/inheritance-preview?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error || t("errorPreview"));
                setRows([]);
            } else {
                // Dedupe defensivo por resourceId: aunque el join del backend ya se
                // scopea por subscripción, garantizamos keys únicas en el render.
                const seen = new Set<string>();
                const unique = ((json.rows || []) as PreviewRow[]).filter((r) => {
                    if (seen.has(r.resourceId)) return false;
                    seen.add(r.resourceId);
                    return true;
                });
                setRows(unique);
                setSelected(new Set(unique.map((r) => r.resourceId)));
            }
        } catch (e: any) {
            setError(e?.message || t("errorNetworkGeneric"));
        } finally {
            setLoading(false);
        }
    }, [selectedTenant, selectedSubscription, tagKeys, t]);

    const toggle = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelected(next);
    };

    const applyAll = useCallback(async (dryRun = false) => {
        if (!selectedTenant?.id) return;
        const ops = rows
            .filter(r => selected.has(r.resourceId))
            .map(r => ({ resourceId: r.resourceId, tagsToMerge: r.missingTags }));
        if (ops.length === 0) { setError(t("errorSelectResource")); return; }

        setApplying(true); setError(null);
        try {
            // Batch de 200 max por endpoint
            const chunks: typeof ops[] = [];
            for (let i = 0; i < ops.length; i += 200) chunks.push(ops.slice(i, i + 200));

            let applied = 0, failed = 0;
            for (const chunk of chunks) {
                const token = await getToken();
                const res = await fetch(`/api/governance/tags/apply-inheritance`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ tenantId: selectedTenant.id, ops: chunk, dryRun }),
                });
                const json = await res.json();
                if (!json.success) {
                    setError(json.error || t("errorApply"));
                    setApplying(false); return;
                }
                applied += json.applied || 0;
                failed += json.failed || 0;
            }
            setApplyResult({ applied, failed });
            if (!dryRun) {
                // Refresh preview tras aplicar
                await runPreview();
            }
        } catch (e: any) {
            setError(e?.message || t("errorNetworkGeneric"));
        } finally {
            setApplying(false);
        }
    }, [rows, selected, selectedTenant, runPreview, t]);

    // Paginación del resultado de "Analizar".
    const preview = usePagination(rows, 10);

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mt-6">
            <div className="flex items-center gap-2 mb-4">
                <Tag className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold">Herencia de tags desde Resource Group</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 text-justify">
                Detecta recursos cuyos Resource Groups tienen tags que los recursos hijos no heredaron.
                Aplica los faltantes con política <strong>Merge</strong> (nunca sobrescribe tags ya definidos en el recurso).
            </p>

            <div className="flex flex-wrap gap-3 items-end mb-4">
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium mb-1">Tag keys (coma sep, vacío = todas)</label>
                    <input
                        type="text"
                        value={tagKeys}
                        onChange={(e) => setTagKeys(e.target.value)}
                        placeholder="Environment,CostCenter,Owner"
                        className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-900"
                    />
                </div>
                <button
                    onClick={runPreview}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-50"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Analizar
                </button>
            </div>

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 text-red-700 dark:text-red-300 px-3 py-2 rounded text-sm mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> {error}
                </div>
            )}

            {applyResult && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 text-green-700 dark:text-green-300 px-3 py-2 rounded text-sm mb-4 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    {applyResult.applied} aplicados, {applyResult.failed} fallidos.
                </div>
            )}

            {rows.length > 0 && (
                <>
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                            {rows.length} recurso(s) con tags faltantes — {selected.size} seleccionado(s)
                        </span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => applyAll(true)}
                                disabled={applying}
                                className="border px-3 py-1.5 rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                            >
                                Dry-run
                            </button>
                            <FeatureGuard requiredTier="Business" featureName="Remediación de Etiquetas" className="inline-block">
                                <button
                                    onClick={() => applyAll(false)}
                                    disabled={applying || selected.size === 0}
                                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm flex items-center gap-2 disabled:opacity-50"
                                >
                                    {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                    Aplicar a Azure
                                </button>
                            </FeatureGuard>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-xs uppercase text-gray-500">
                                    <th className="py-2 pr-2"></th>
                                    <th className="py-2 pr-2">Recurso</th>
                                    <th className="py-2 pr-2">Tipo</th>
                                    <th className="py-2 pr-2">RG</th>
                                    <th className="py-2 pr-2">Tags a heredar</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.paged.map((r) => (
                                    <tr key={r.resourceId} className="border-b hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                        <td className="py-2 pr-2">
                                            <input
                                                type="checkbox"
                                                checked={selected.has(r.resourceId)}
                                                onChange={() => toggle(r.resourceId)}
                                            />
                                        </td>
                                        <td className="py-2 pr-2 font-medium">{r.resourceName}</td>
                                        <td className="py-2 pr-2 text-xs text-gray-600 dark:text-gray-400 font-mono">{r.resourceType.split("/").slice(-1)[0]}</td>
                                        <td className="py-2 pr-2">{r.resourceGroupName}</td>
                                        <td className="py-2 pr-2">
                                            <div className="flex flex-wrap gap-1">
                                                {Object.entries(r.missingTags).map(([k, v]) => (
                                                    <span key={k} className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded text-xs">
                                                        {k}={v}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Pagination
                            page={preview.page} setPage={preview.setPage}
                            pageSize={preview.pageSize} setPageSize={preview.setPageSize}
                            total={preview.total} totalPages={preview.totalPages}
                        />
                    </div>
                </>
            )}

            {!loading && rows.length === 0 && !error && (
                <p className="text-sm text-gray-500 italic">Sin datos. Pulsá "Analizar" para empezar.</p>
            )}
        </div>
    );
}
