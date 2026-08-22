"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { KeyRound, Plus, Trash2, Copy, Loader2, ShieldAlert, Check } from "lucide-react";
import { errorMessage } from '@/lib/apiErrors';

interface KeyRow {
    id: number; key_prefix: string; label: string;
    created_by_email: string; created_at: string;
    last_used_at: string | null; revoked_at: string | null;
}

export default function MCPKeysPage() {
    const t = useTranslations("AdminMcpKeys");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [keys, setKeys] = useState<KeyRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [label, setLabel] = useState("");
    const [newKey, setNewKey] = useState<{ plaintext: string; prefix: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const load = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") { setLoading(false); return; }
        setLoading(true); setError(null);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/admin/mcp-keys?tenantId=${selectedTenant.id}`, { headers });
            const json = await res.json();
            if (!json.success) setError(json.error || t("errorGeneric"));
            else setKeys(json.keys || []);
        } catch (e) { setError(errorMessage(e)); }
        finally { setLoading(false); }
    }, [selectedTenant?.id, authHeaders]);

    useEffect(() => { load(); }, [load]);

    const createKey = async () => {
        if (!label.trim()) { setError(t("errorLabelRequired")); return; }
        if (!selectedTenant?.id) return;
        setCreating(true); setError(null); setNewKey(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/mcp-keys`, {
                method: "POST", headers,
                body: JSON.stringify({ tenantId: selectedTenant.id, label: label.trim() }),
            });
            const json = await res.json();
            if (!json.success) setError(json.error || t("errorCreatingKey"));
            else { setNewKey({ plaintext: json.key, prefix: json.prefix }); setLabel(""); await load(); }
        } catch (e) { setError(errorMessage(e)); }
        finally { setCreating(false); }
    };

    const revoke = async (id: number) => {
        if (!confirm(t("confirmRevokeKey"))) return;
        try {
            const headers = await authHeaders();
            await fetch(`/api/admin/mcp-keys?tenantId=${selectedTenant.id}&keyId=${id}`, { method: "DELETE", headers });
            await load();
        } catch (e) { setError(errorMessage(e)); }
    };

    const copyKey = () => {
        if (!newKey) return;
        navigator.clipboard.writeText(newKey.plaintext);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2"><KeyRound className="w-6 h-6" /> {t("pageTitle")}</h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 text-justify">
                    {t.rich("description", { code: (chunks) => <code>{chunks}</code> })}
                </p>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="font-semibold mb-3">{t("createNewKeyTitle")}</h2>
                <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[200px]">
                        <label className="block text-xs font-medium mb-1">{t("labelFieldLabel")}</label>
                        <input value={label} onChange={e => setLabel(e.target.value)}
                            className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-900" placeholder={t("labelPlaceholder")} />
                    </div>
                    <button onClick={createKey} disabled={creating || !label.trim()}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-50">
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {t("createKeyButton")}
                    </button>
                </div>

                {newKey && (
                    <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 rounded p-3">
                        <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300 mb-2">
                            <ShieldAlert className="w-5 h-5 mt-0.5" />
                            <div>
                                <p className="font-semibold">{t("saveKeyNowTitle")}</p>
                                <p className="text-xs">{t("saveKeyNowDescription")}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded px-3 py-2">
                            <code className="font-mono text-xs flex-1 break-all">{newKey.plaintext}</code>
                            <button onClick={copyKey} className="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-xs">
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {copied ? t("copiedButton") : t("copyButton")}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="font-semibold mb-3">{t("existingKeysTitle", { count: keys.length })}</h2>
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> {t("loadingLabel")}</div>
                ) : keys.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">{t("noKeysMessage")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead><tr className="border-b text-left text-xs uppercase text-gray-500">
                                <th className="py-2 pr-3">{t("colPrefix")}</th>
                                <th className="py-2 pr-3">{t("colLabel")}</th>
                                <th className="py-2 pr-3">{t("colCreatedBy")}</th>
                                <th className="py-2 pr-3">{t("colCreatedAt")}</th>
                                <th className="py-2 pr-3">{t("colLastUsed")}</th>
                                <th className="py-2 pr-3">{t("colStatus")}</th>
                                <th className="py-2"></th>
                            </tr></thead>
                            <tbody>
                                {keys.map(k => (
                                    <tr key={k.id} className="border-b">
                                        <td className="py-2 pr-3 font-mono text-xs">{k.key_prefix}…</td>
                                        <td className="py-2 pr-3 font-medium">{k.label}</td>
                                        <td className="py-2 pr-3 text-xs">{k.created_by_email}</td>
                                        <td className="py-2 pr-3 text-xs">{new Date(k.created_at).toLocaleDateString()}</td>
                                        <td className="py-2 pr-3 text-xs">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : t("neverUsedLabel")}</td>
                                        <td className="py-2 pr-3">
                                            {k.revoked_at
                                                ? <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs">{t("revokedStatus")}</span>
                                                : <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs">{t("activeStatus")}</span>}
                                        </td>
                                        <td className="py-2">
                                            {!k.revoked_at && (
                                                <button onClick={() => revoke(k.id)} className="text-red-600 hover:text-red-700">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 rounded-lg p-4 text-sm">
                <p className="font-semibold mb-2">{t("howToUseTitle")}</p>
                <ul className="list-disc ml-5 space-y-1 text-xs">
                    <li>{t.rich("howToUseItem1", { code: (chunks) => <code>{chunks}</code> })}</li>
                    <li>{t.rich("howToUseItem2", { code: (chunks) => <code>{chunks}</code> })}</li>
                    <li>{t.rich("howToUseItem3", { code: (chunks) => <code>{chunks}</code> })}</li>
                </ul>
            </div>
        </div>
    );
}
