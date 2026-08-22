"use client";

import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Trash2, AlertCircle, Loader2, Check } from "lucide-react";
import { errorMessage } from '@/lib/apiErrors';
interface TagPolicy {
    id?: number;
    policyName: string;
    isRequired: boolean;
}

export default function TaggingPoliciesManager() {
    const t = useTranslations("TagsPage");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const [policies, setPolicies] = useState<TagPolicy[]>([]);
    const [newPolicy, setNewPolicy] = useState("");
    const [loading, setLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const fetchPolicies = async () => {
        if (!selectedTenant || selectedTenant.id === "default" || !accounts[0]) return;

        setLoading(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(
                `/api/governance/policies?tenantId=${encodeURIComponent(selectedTenant.id)}`,
                {
                    headers: { Authorization: `Bearer ${idToken}` },
                }
            );

            if (!res.ok) throw new Error("Failed to fetch policies");
            const json = await res.json();
            setPolicies(json.data || []);
        } catch (e) {
            toast.error(errorMessage(e) || "Error loading policies");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedTenant?.id && selectedTenant.id !== "default") {
            fetchPolicies();
        }
    }, [selectedTenant?.id, accounts.length]);

    const addPolicy = async () => {
        if (!newPolicy.trim() || !selectedTenant || selectedTenant.id === "default") return;

        setIsSaving(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/governance/policies", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-tenant-id": selectedTenant.id,
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    policyName: newPolicy.trim(),
                    isRequired: true,
                }),
            });

            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || "Failed to create policy");
            }

            toast.success("Política creada exitosamente");
            setNewPolicy("");
            await fetchPolicies();
        } catch (e) {
            toast.error(errorMessage(e));
        } finally {
            setIsSaving(false);
        }
    };

    const togglePolicyRequired = async (policy: TagPolicy) => {
        if (!policy.id || !selectedTenant || selectedTenant.id === "default") return;

        setIsSaving(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/governance/policies", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "x-tenant-id": selectedTenant.id,
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    id: policy.id,
                    isRequired: !policy.isRequired,
                }),
            });

            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || "Failed to update policy");
            }

            toast.success("Política actualizada");
            await fetchPolicies();
        } catch (e) {
            toast.error(errorMessage(e));
        } finally {
            setIsSaving(false);
        }
    };

    const deletePolicy = async (policyId: number | undefined) => {
        if (!policyId || !selectedTenant || selectedTenant.id === "default") return;

        setIsSaving(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/governance/policies", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    "x-tenant-id": selectedTenant.id,
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ id: policyId }),
            });

            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || "Failed to delete policy");
            }

            toast.success("Política eliminada");
            await fetchPolicies();
        } catch (e) {
            toast.error(errorMessage(e));
        } finally {
            setIsSaving(false);
        }
    };

    if (selectedTenant?.id === "default") return null;

    return (
        <div className="card mt-6">
            <div className="card-h flex items-center justify-between">
                <h3 className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    Configurar Políticas de Etiquetado Obligatorio
                </h3>
            </div>

            <div className="p-[18px]">
                <p className="text-sm text-ink-soft mb-4">
                    Define qué etiquetas son obligatorias para todos los recursos de tu tenant.
                </p>

                {/* Add New Policy */}
                <div className="flex gap-2 mb-4">
                    <input
                        type="text"
                        placeholder="Nombre de la política (ej: Project, Environment, Owner)"
                        value={newPolicy}
                        onChange={(e) => setNewPolicy(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && addPolicy()}
                        disabled={loading || isSaving}
                        className="flex-1 px-3 py-2 rounded-lg border border-line bg-surface text-ink placeholder-ink-soft disabled:opacity-50"
                    />
                    <button
                        onClick={addPolicy}
                        disabled={!newPolicy.trim() || isSaving || loading}
                        className="flex items-center gap-2 px-4 py-2 bg-brand-deep text-white rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    >
                        {isSaving ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Plus className="w-4 h-4" />
                        )}
                        Agregar
                    </button>
                </div>

                {/* Policies List */}
                {loading ? (
                    <div className="flex justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-brand-deep" />
                    </div>
                ) : policies.length === 0 ? (
                    <p className="text-sm text-ink-soft text-center py-4">
                        No hay políticas configuradas aún
                    </p>
                ) : (
                    <div className="space-y-2">
                        {policies.map((policy) => (
                            <div
                                key={policy.id}
                                className="flex items-center justify-between p-3 bg-surface border border-line rounded-lg hover:border-brand-deep/30 transition-colors"
                            >
                                <div className="flex items-center gap-3 flex-1">
                                    <button
                                        onClick={() => togglePolicyRequired(policy)}
                                        disabled={isSaving}
                                        className={`flex items-center justify-center w-6 h-6 rounded-full border-2 transition-colors ${
                                            policy.isRequired
                                                ? "bg-emerald-100 border-emerald-500 text-emerald-600 dark:bg-emerald-900/30 dark:border-emerald-500 dark:text-emerald-400"
                                                : "border-gray-300 bg-white dark:border-gray-600 dark:bg-slate-800 hover:border-emerald-500"
                                        }`}
                                        title={policy.isRequired ? "Obligatorio" : "Opcional"}
                                    >
                                        {policy.isRequired && <Check className="w-4 h-4" />}
                                    </button>
                                    <div>
                                        <h4 className="text-sm font-semibold text-ink">
                                            {policy.policyName}
                                        </h4>
                                        <p className="text-xs text-ink-soft">
                                            {policy.isRequired ? "Obligatorio" : "Opcional"}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => deletePolicy(policy.id)}
                                    disabled={isSaving}
                                    className="p-2 text-danger hover:bg-danger-soft rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Eliminar política"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Default Required Policies Info */}
                {policies.length > 0 && (
                    <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <p className="text-xs text-blue-900 dark:text-blue-300">
                            <strong>Nota:</strong> Las siguientes políticas se crean automáticamente como obligatorias:
                            <span className="block mt-1">
                                • Environment • Role • CostCenter • Department
                            </span>
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
