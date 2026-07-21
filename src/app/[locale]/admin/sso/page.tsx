"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import {
    ShieldCheck,
    Plus,
    Trash2,
    Copy,
    Loader2,
    ShieldAlert,
    Check,
    ExternalLink,
} from "lucide-react";

interface SsoConfig {
    tenant_id: string;
    workos_org_id: string | null;
    workos_connection_id: string | null;
    domain: string | null;
    enabled: boolean;
}

export default function SsoPage() {
    const t = useTranslations('AdminSso');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [config, setConfig] = useState<SsoConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [generatingLink, setGeneratingLink] = useState(false);
    const [portaltLink, setPortalLink] = useState<string | null>(null);

    // Form fields
    const [domain, setDomain] = useState("");
    const [workosOrgId, setWorkosOrgId] = useState("");
    const [workosConnectionId, setWorkosConnectionId] = useState("");
    const [enabled, setEnabled] = useState(false);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const load = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") {
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/admin/sso?tenantId=${selectedTenant.id}`, {
                headers,
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error || t('errors.generic'));
            } else {
                setConfig(json.config || null);
                setDomain(json.config?.domain || "");
                setWorkosOrgId(json.config?.workos_org_id || "");
                setWorkosConnectionId(json.config?.workos_connection_id || "");
                setEnabled(json.config?.enabled || false);
            }
        } catch (e: any) {
            setError(e?.message);
        } finally {
            setLoading(false);
        }
    }, [selectedTenant?.id, authHeaders, t]);

    useEffect(() => {
        load();
    }, [load]);

    const saveConfig = async () => {
        if (!selectedTenant?.id) return;
        setSaving(true);
        setError(null);
        try {
            const headers = {
                "Content-Type": "application/json",
                ...(await authHeaders()),
            };
            const res = await fetch(`/api/admin/sso`, {
                method: "PUT",
                headers,
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    domain: domain.trim() || null,
                    workos_org_id: workosOrgId.trim() || null,
                    workos_connection_id: workosConnectionId.trim() || null,
                    enabled,
                }),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error || t('errors.saveFailed'));
            } else {
                await load();
            }
        } catch (e: any) {
            setError(e?.message);
        } finally {
            setSaving(false);
        }
    };

    const generatePortalLink = async () => {
        if (!selectedTenant?.id) return;
        setGeneratingLink(true);
        setError(null);
        setPortalLink(null);
        try {
            const headers = {
                "Content-Type": "application/json",
                ...(await authHeaders()),
            };
            const res = await fetch(`/api/admin/sso/portal-link`, {
                method: "POST",
                headers,
                body: JSON.stringify({ tenantId: selectedTenant.id }),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error || t('errors.linkFailed'));
            } else {
                setPortalLink(json.link);
                // Auto-open link in new tab
                if (json.link) {
                    window.open(json.link, "_blank");
                }
            }
        } catch (e: any) {
            setError(e?.message);
        } finally {
            setGeneratingLink(false);
        }
    };

    const testSso = () => {
        if (!selectedTenant?.id) return;
        const url = `/api/auth/sso/start?tenantId=${selectedTenant.id}&domain=${domain}`;
        window.open(url, "_blank");
    };

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6" /> {t('title')}
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 text-justify">
                    {t('subtitle')}
                </p>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> {t('loading')}
                </div>
            ) : (
                <>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                        <h2 className="font-semibold mb-4">{t('configSection.heading')}</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">
                                    {t('configSection.domainLabel')}
                                </label>
                                <input
                                    type="text"
                                    value={domain}
                                    onChange={(e) => setDomain(e.target.value)}
                                    placeholder="acme.com"
                                    className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-900"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">
                                    {t('configSection.workosOrgIdLabel')}
                                </label>
                                <input
                                    type="text"
                                    value={workosOrgId}
                                    onChange={(e) => setWorkosOrgId(e.target.value)}
                                    placeholder="org_..."
                                    className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-900"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">
                                    {t('configSection.workosConnectionIdLabel')}
                                </label>
                                <input
                                    type="text"
                                    value={workosConnectionId}
                                    onChange={(e) => setWorkosConnectionId(e.target.value)}
                                    placeholder="connection_..."
                                    className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-900"
                                />
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={(e) => setEnabled(e.target.checked)}
                                    className="rounded"
                                    id="sso-enabled"
                                />
                                <label htmlFor="sso-enabled" className="text-sm font-medium">
                                    {t('configSection.enableSsoLabel')}
                                </label>
                            </div>

                            <div className="flex gap-2 pt-2">
                                <button
                                    onClick={saveConfig}
                                    disabled={saving}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-50"
                                >
                                    {saving ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Check className="w-4 h-4" />
                                    )}
                                    {t('actions.save')}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                        <h2 className="font-semibold mb-4">{t('actionsSection.heading')}</h2>
                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={generatePortalLink}
                                disabled={generatingLink || !workosOrgId}
                                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-50"
                            >
                                {generatingLink ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <ExternalLink className="w-4 h-4" />
                                )}
                                {t('actions.generateAdminPortal')}
                            </button>

                            <button
                                onClick={testSso}
                                disabled={!domain || !workosConnectionId}
                                className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-50"
                            >
                                <ExternalLink className="w-4 h-4" />
                                {t('actions.testSso')}
                            </button>
                        </div>

                        {portaltLink && (
                            <div className="mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 rounded p-3">
                                <div className="flex items-start gap-2 text-green-700 dark:text-green-300 mb-2">
                                    <Check className="w-5 h-5 mt-0.5" />
                                    <div>
                                        <p className="font-semibold">{t('actionsSection.portalLinkGenerated')}</p>
                                        <p className="text-xs">{t('actionsSection.portalLinkOpened')}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 rounded-lg p-4 text-sm">
                        <p className="font-semibold mb-2">{t('howTo.heading')}</p>
                        <ul className="list-disc ml-5 space-y-1 text-xs">
                            <li>
                                {t('howTo.step1')}
                            </li>
                            <li>
                                {t('howTo.step2', { portalButton: t('actions.generateAdminPortal') })}
                            </li>
                            <li>{t('howTo.step3')}</li>
                            <li>{t('howTo.step4')}</li>
                        </ul>
                    </div>
                </>
            )}
        </div>
    );
}
