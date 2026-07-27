"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import {
  Unlock,
  Plus,
  Trash2,
  Copy,
  Loader2,
  ShieldAlert,
  Check,
  ToggleRight,
} from "lucide-react";
import { toast } from "sonner";

interface ApiKeyRow {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_per_min: number;
  enabled: boolean;
  last_used_at: string | null;
  created_by: string | null;
  created_at: string;
}

export default function PublicApiKeysPage() {
  const t = useTranslations("AdminApiKeys");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["read:cost", "read:resources"]);
  const [rateLimit, setRateLimit] = useState(60);
  const [newKey, setNewKey] = useState<{ plaintext: string; prefix: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const allScopes = [
    "read:cost",
    "read:resources",
    "read:budgets",
    "read:recommendations",
    "read:anomalies",
  ];

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
      const res = await fetch(`/api/admin/public-api-keys?tenantId=${selectedTenant.id}`, {
        headers,
      });
      const json = await res.json();
      if (!json.success) setError(json.error || t("errorLoading"));
      else setKeys(json.keys || []);
    } catch (e: any) {
      setError(e?.message);
    } finally {
      setLoading(false);
    }
  }, [selectedTenant?.id, authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const createKey = async () => {
    if (!name.trim()) {
      setError(t("errorNameRequired"));
      return;
    }
    if (!selectedTenant?.id) return;

    setCreating(true);
    setError(null);
    setNewKey(null);

    try {
      const headers = {
        "Content-Type": "application/json",
        ...(await authHeaders()),
      };
      const res = await fetch(`/api/admin/public-api-keys?tenantId=${selectedTenant.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: name.trim(),
          scopes: selectedScopes,
          rate_limit_per_min: rateLimit,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || t("errorCreating"));
      } else {
        setNewKey({ plaintext: json.key, prefix: json.prefix });
        setName("");
        setSelectedScopes(["read:cost", "read:resources"]);
        setRateLimit(60);
        toast.success(t("createdToast"));
        await load();
      }
    } catch (e: any) {
      setError(e?.message);
    } finally {
      setCreating(false);
    }
  };

  const deleteKey = async (id: number) => {
    if (!confirm(t("confirmDelete"))) return;
    if (!selectedTenant?.id) return;

    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/admin/public-api-keys/${id}?tenantId=${selectedTenant.id}`,
        { method: "DELETE", headers }
      );
      const json = await res.json();
      if (!json.success) {
        setError(json.error || t("errorDeleting"));
      } else {
        toast.success(t("deletedToast"));
        await load();
      }
    } catch (e: any) {
      setError(e?.message);
    }
  };

  const toggleKey = async (id: number, enabled: boolean) => {
    if (!selectedTenant?.id) return;

    try {
      const headers = {
        "Content-Type": "application/json",
        ...(await authHeaders()),
      };
      const res = await fetch(
        `/api/admin/public-api-keys/${id}?tenantId=${selectedTenant.id}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ enabled: !enabled }),
        }
      );
      const json = await res.json();
      if (!json.success) {
        setError(json.error || t("errorUpdating"));
      } else {
        toast.success(enabled ? t("disabledToast") : t("enabledToast"));
        await load();
      }
    } catch (e: any) {
      setError(e?.message);
    }
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
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Unlock className="w-6 h-6" /> {t("pageTitle")}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 text-justify">
          {t("pageSubtitle")}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-200 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="font-semibold mb-4">{t("createTitle")}</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">{t("nameLabel")}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-900 dark:text-white"
                placeholder={t("namePlaceholder")}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {t("rateLimitLabel", { rateLimit })}
              </label>
              <input
                type="range"
                min="10"
                max="1000"
                value={rateLimit}
                onChange={(e) => setRateLimit(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-2">{t("scopesLabel")}</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {allScopes.map((scope) => (
                <label
                  key={scope}
                  className="flex items-center gap-2 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedScopes([...selectedScopes, scope]);
                      } else {
                        setSelectedScopes(selectedScopes.filter((s) => s !== scope));
                      }
                    }}
                    className="rounded"
                  />
                  {scope}
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={createKey}
            disabled={creating || !name.trim()}
            className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white px-4 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {creating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {t("createButton")}
          </button>
        </div>
      </div>

      {newKey && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-6 space-y-3">
          <h3 className="font-semibold text-blue-900 dark:text-blue-200">
            {t("newKeyTitle")}
          </h3>
          <div className="bg-white dark:bg-gray-900 border border-blue-300 dark:border-blue-700 rounded px-4 py-3 font-mono text-sm break-all">
            {newKey.plaintext}
          </div>
          <button
            onClick={copyKey}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" /> {t("copied")}
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" /> {t("copyToClipboard")}
              </>
            )}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : keys.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center text-gray-600 dark:text-gray-400">
          {t("noKeys")}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">{t("columnName")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("columnPrefix")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("columnScopes")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("columnRateLimit")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("columnLastUsed")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("columnStatus")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("columnActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {keys.map((key) => (
                <tr key={key.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">{key.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{key.key_prefix}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded text-xs"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{key.rate_limit_per_min}/min</td>
                  <td className="px-4 py-3 text-xs">
                    {key.last_used_at
                      ? new Date(key.last_used_at).toLocaleDateString()
                      : t("never")}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleKey(key.id, key.enabled)}
                      className={`p-1 rounded ${
                        key.enabled
                          ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                          : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                      }`}
                      title={key.enabled ? t("disableTitle") : t("enableTitle")}
                    >
                      <ToggleRight className="w-4 h-4" />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => deleteKey(key.id)}
                      className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 p-1"
                      title={t("deleteTitle")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
