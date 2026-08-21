"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { Bell, Plus, Trash2, Loader2, MessageCircle, Mail, Zap, X, Pencil } from "lucide-react";
import { toast } from "sonner";

interface Channel {
    id: number;
    type: "slack" | "teams" | "email";
    name: string;
    config_json?: { webhook_url?: string; recipients?: string[] };
    severity_filter: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

export default function NotificationsPage() {
    const t = useTranslations("AdminNotifications");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [channels, setChannels] = useState<Channel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [selectedType, setSelectedType] = useState<"slack" | "teams" | "email" | null>(null);
    const [formData, setFormData] = useState<{
        name: string;
        webhookUrl?: string;
        recipients?: string[];
        severityFilter: string;
    }>({ name: "", severityFilter: "info,warning,error" });
    const [creating, setCreating] = useState(false);
    // editingId: null = modo creación; number = editando ese canal existente.
    const [editingId, setEditingId] = useState<number | null>(null);
    const [testing, setTesting] = useState<number | null>(null);
    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [togglingMaster, setTogglingMaster] = useState(false);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const loadChannels = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") {
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/admin/notifications/channels?tenantId=${selectedTenant.id}`, { headers });
            const json = await res.json();
            if (!json.success) setError(json.error || t("errors.loadFailed"));
            else {
                setChannels(json.channels || []);
                setNotificationsEnabled(json.notificationsEnabled ?? true);
            }
        } catch (e: any) {
            setError(e?.message);
        } finally {
            setLoading(false);
        }
    }, [selectedTenant?.id, authHeaders]);

    useEffect(() => {
        loadChannels();
    }, [loadChannels]);

    const createChannel = async () => {
        if (!selectedType || !formData.name.trim()) {
            setError(t("errors.nameRequired"));
            return;
        }

        if (!selectedTenant?.id) return;

        let config_json: any = {};

        if (selectedType === "slack" || selectedType === "teams") {
            if (!formData.webhookUrl?.trim()) {
                setError(t("errors.webhookUrlRequired"));
                return;
            }
            config_json = { webhook_url: formData.webhookUrl.trim() };
        } else if (selectedType === "email") {
            const recipientList = formData.recipients?.filter((r) => r.trim()) || [];
            if (recipientList.length === 0) {
                setError(t("errors.recipientRequired"));
                return;
            }
            config_json = { recipients: recipientList };
        }

        setCreating(true);
        setError(null);

        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/notifications/channels`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    type: selectedType,
                    name: formData.name.trim(),
                    config_json,
                    severity_filter: formData.severityFilter,
                }),
            });

            const json = await res.json();
            if (!json.success) {
                setError(json.error || t("errors.createFailed"));
            } else {
                toast.success(t("toasts.channelCreated"));
                setShowModal(false);
                setSelectedType(null);
                setFormData({ name: "", severityFilter: "info,warning,error" });
                await loadChannels();
            }
        } catch (e: any) {
            setError(e?.message);
        } finally {
            setCreating(false);
        }
    };

    const openEdit = (ch: Channel) => {
        setEditingId(ch.id);
        setSelectedType(ch.type);
        setError(null);
        setFormData({
            name: ch.name,
            webhookUrl: ch.config_json?.webhook_url || "",
            recipients: ch.config_json?.recipients?.length ? [...ch.config_json.recipients] : [""],
            severityFilter: ch.severity_filter || "info,warning,error",
        });
        setShowModal(true);
    };

    const updateChannel = async () => {
        if (editingId == null || !selectedType || !formData.name.trim()) {
            setError(t("errors.nameRequired"));
            return;
        }
        if (!selectedTenant?.id) return;

        let config_json: any = {};
        if (selectedType === "slack" || selectedType === "teams") {
            if (!formData.webhookUrl?.trim()) {
                setError(t("errors.webhookUrlRequired"));
                return;
            }
            config_json = { webhook_url: formData.webhookUrl.trim() };
        } else if (selectedType === "email") {
            const recipientList = formData.recipients?.filter((r) => r.trim()) || [];
            if (recipientList.length === 0) {
                setError(t("errors.recipientRequired"));
                return;
            }
            config_json = { recipients: recipientList };
        }

        setCreating(true);
        setError(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/notifications/channels/${editingId}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    name: formData.name.trim(),
                    config_json,
                    severity_filter: formData.severityFilter,
                }),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error || t("errors.updateFailed"));
            } else {
                toast.success(t("toasts.channelUpdated"));
                closeModal();
                await loadChannels();
            }
        } catch (e: any) {
            setError(e?.message);
        } finally {
            setCreating(false);
        }
    };

    const deleteChannel = async (id: number) => {
        if (!confirm(t("deleteConfirm"))) return;

        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/admin/notifications/channels/${id}?tenantId=${selectedTenant?.id}`, {
                method: "DELETE",
                headers,
            });

            const json = await res.json();
            if (!json.success) {
                toast.error(json.error || t("errors.deleteFailed"));
            } else {
                toast.success(t("toasts.channelDeleted"));
                await loadChannels();
            }
        } catch (e: any) {
            toast.error(e?.message);
        }
    };

    const closeModal = () => {
        setShowModal(false);
        setSelectedType(null);
        setEditingId(null);
        setFormData({ name: "", severityFilter: "info,warning,error" });
        setError(null);
    };

    const testChannel = async (id: number) => {
        if (!selectedTenant?.id) return;

        setTesting(id);
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/notifications/channels/${id}/test`, {
                method: "POST",
                headers,
                body: JSON.stringify({ tenantId: selectedTenant.id }),
            });

            const json = await res.json();
            if (json.success) {
                toast.success(t("toasts.testSent"));
            } else {
                toast.error(json.error || t("errors.testFailed"));
            }
        } catch (e: any) {
            toast.error(e?.message);
        } finally {
            setTesting(null);
        }
    };

    const toggleChannel = async (channel: Channel) => {
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/notifications/channels/${channel.id}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({ tenantId: selectedTenant?.id, enabled: !channel.enabled }),
            });

            const json = await res.json();
            if (json.success) {
                toast.success(channel.enabled ? t("toasts.channelDisabled") : t("toasts.channelEnabled"));
                await loadChannels();
            } else {
                toast.error(json.error || t("errors.toggleFailed"));
            }
        } catch (e: any) {
            toast.error(e?.message);
        }
    };

    const toggleMasterSwitch = async () => {
        if (!selectedTenant?.id) return;
        const next = !notificationsEnabled;
        setTogglingMaster(true);
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/notifications/channels`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ tenantId: selectedTenant.id, notificationsEnabled: next }),
            });
            const json = await res.json();
            if (json.success) {
                setNotificationsEnabled(next);
                toast.success(next ? t("toasts.notificationsEnabled") : t("toasts.notificationsDisabled"));
            } else {
                toast.error(json.error || t("errors.toggleMasterFailed"));
            }
        } catch (e: any) {
            toast.error(e?.message);
        } finally {
            setTogglingMaster(false);
        }
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case "slack":
                return <MessageCircle className="w-4 h-4" />;
            case "teams":
                return <MessageCircle className="w-4 h-4" />;
            case "email":
                return <Mail className="w-4 h-4" />;
            default:
                return <Bell className="w-4 h-4" />;
        }
    };

    const getTypeColor = (type: string) => {
        switch (type) {
            case "slack":
                return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
            case "teams":
                return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
            case "email":
                return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
            default:
                return "bg-gray-100 text-gray-800";
        }
    };

    if (loading) {
        return (
            <div className="p-6 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Bell className="w-6 h-6" />
                    {t("title")}
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {t("subtitle")}
                </p>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <label className="flex items-center justify-between cursor-pointer">
                    <div>
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{t("masterSwitch.label")}</div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {t("masterSwitch.description")}
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={notificationsEnabled}
                        disabled={togglingMaster}
                        onClick={toggleMasterSwitch}
                        className={`ml-4 shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                            notificationsEnabled ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                notificationsEnabled ? "translate-x-6" : "translate-x-1"
                            }`}
                        />
                    </button>
                </label>
            </div>

            <div className={`bg-white dark:bg-gray-800 rounded-lg shadow p-6 ${!notificationsEnabled ? "opacity-50" : ""}`}>
                <h2 className="font-semibold mb-3">{t("activeChannels.title")}</h2>
                {channels.length === 0 ? (
                    <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">{t("activeChannels.empty")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-b">
                                <tr className="text-left">
                                    <th className="py-2 px-2">{t("activeChannels.columns.name")}</th>
                                    <th className="py-2 px-2">{t("activeChannels.columns.type")}</th>
                                    <th className="py-2 px-2">{t("activeChannels.columns.severityFilter")}</th>
                                    <th className="py-2 px-2">{t("activeChannels.columns.status")}</th>
                                    <th className="py-2 px-2">{t("activeChannels.columns.actions")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {channels.map((ch) => (
                                    <tr key={ch.id} className="border-b hover:bg-gray-50 dark:hover:bg-gray-700">
                                        <td className="py-3 px-2">{ch.name}</td>
                                        <td className="py-3 px-2">
                                            <span
                                                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${getTypeColor(
                                                    ch.type
                                                )}`}
                                            >
                                                {getTypeIcon(ch.type)}
                                                {ch.type}
                                            </span>
                                        </td>
                                        <td className="py-3 px-2 text-xs text-gray-600 dark:text-gray-400">{ch.severity_filter}</td>
                                        <td className="py-3 px-2">
                                            <button
                                                onClick={() => toggleChannel(ch)}
                                                className={`text-xs px-2 py-1 rounded ${
                                                    ch.enabled
                                                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                                        : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                                                }`}
                                            >
                                                {ch.enabled ? t("activeChannels.statusEnabled") : t("activeChannels.statusDisabled")}
                                            </button>
                                        </td>
                                        <td className="py-3 px-2 flex gap-2">
                                            <button
                                                onClick={() => testChannel(ch.id)}
                                                disabled={testing === ch.id}
                                                className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 hover:bg-blue-200 disabled:opacity-50 flex items-center gap-1"
                                            >
                                                {testing === ch.id ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                    <Zap className="w-3 h-3" />
                                                )}
                                                {t("activeChannels.test")}
                                            </button>
                                            <button
                                                onClick={() => openEdit(ch)}
                                                aria-label={t("editChannel")}
                                                title={t("editChannel")}
                                                className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200"
                                            >
                                                <Pencil className="w-3 h-3" />
                                            </button>
                                            <button
                                                onClick={() => deleteChannel(ch.id)}
                                                className="text-xs px-2 py-1 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-200"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <button
                onClick={() => setShowModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2"
            >
                <Plus className="w-4 h-4" />
                {t("addChannel")}
            </button>

            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-md w-full mx-4 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">{editingId != null ? t("modal.editTitle") : t("modal.title")}</h3>
                            <button
                                onClick={closeModal}
                                aria-label={t("modal.close")}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded p-1 -m-1"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {!selectedType ? (
                            <div className="space-y-3">
                                <p className="text-sm text-gray-600 dark:text-gray-400">{t("modal.selectType")}</p>
                                <button
                                    onClick={() => {
                                        setSelectedType("slack");
                                        setFormData({ name: "", severityFilter: "info,warning,error" });
                                    }}
                                    className="w-full border rounded p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                                >
                                    <MessageCircle className="w-5 h-5 text-purple-600" />
                                    <div>
                                        <div className="font-medium">{t("modal.slack.name")}</div>
                                        <div className="text-xs text-gray-600 dark:text-gray-400">{t("modal.slack.description")}</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => {
                                        setSelectedType("teams");
                                        setFormData({ name: "", severityFilter: "info,warning,error" });
                                    }}
                                    className="w-full border rounded p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                                >
                                    <MessageCircle className="w-5 h-5 text-blue-600" />
                                    <div>
                                        <div className="font-medium">{t("modal.teams.name")}</div>
                                        <div className="text-xs text-gray-600 dark:text-gray-400">{t("modal.teams.description")}</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => {
                                        setSelectedType("email");
                                        setFormData({ name: "", recipients: [""], severityFilter: "info,warning,error" });
                                    }}
                                    className="w-full border rounded p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                                >
                                    <Mail className="w-5 h-5 text-orange-600" />
                                    <div>
                                        <div className="font-medium">{t("modal.email.name")}</div>
                                        <div className="text-xs text-gray-600 dark:text-gray-400">{t("modal.email.description")}</div>
                                    </div>
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {editingId == null && (
                                    <button
                                        onClick={() => setSelectedType(null)}
                                        className="text-sm text-blue-600 hover:text-blue-800 mb-2"
                                    >
                                        {t("modal.back")}
                                    </button>
                                )}

                                <div>
                                    <label className="block text-xs font-medium mb-1">{t("modal.channelNameLabel")}</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder={t("modal.channelNamePlaceholder")}
                                        className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-900"
                                    />
                                </div>

                                {(selectedType === "slack" || selectedType === "teams") && (
                                    <div>
                                        <label className="block text-xs font-medium mb-1">{t("modal.webhookUrlLabel")}</label>
                                        <input
                                            type="text"
                                            value={formData.webhookUrl || ""}
                                            onChange={(e) => setFormData({ ...formData, webhookUrl: e.target.value })}
                                            placeholder="https://hooks.slack.com/services/..."
                                            className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-900 font-mono text-xs"
                                        />
                                    </div>
                                )}

                                {selectedType === "email" && (
                                    <div>
                                        <label className="block text-xs font-medium mb-1">{t("modal.recipientEmailsLabel")}</label>
                                        {(formData.recipients || []).map((email, idx) => (
                                            <div key={idx} className="mb-2">
                                                <input
                                                    type="email"
                                                    value={email}
                                                    onChange={(e) => {
                                                        const updated = [...(formData.recipients || [])];
                                                        updated[idx] = e.target.value;
                                                        setFormData({ ...formData, recipients: updated });
                                                    }}
                                                    placeholder="email@example.com"
                                                    className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-900"
                                                />
                                            </div>
                                        ))}
                                        <button
                                            onClick={() => setFormData({ ...formData, recipients: [...(formData.recipients || []), ""] })}
                                            className="text-xs text-blue-600 hover:text-blue-800"
                                        >
                                            {t("modal.addAnotherEmail")}
                                        </button>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-xs font-medium mb-1">{t("modal.severityFilterLabel")}</label>
                                    <input
                                        type="text"
                                        value={formData.severityFilter}
                                        onChange={(e) => setFormData({ ...formData, severityFilter: e.target.value })}
                                        placeholder="info,warning,error"
                                        className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-900"
                                    />
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t("modal.severityFilterHint")}</p>
                                </div>

                                <div className="flex gap-2 pt-2">
                                    <button
                                        onClick={closeModal}
                                        className="flex-1 border rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                                    >
                                        {t("modal.cancel")}
                                    </button>
                                    <button
                                        onClick={editingId != null ? updateChannel : createChannel}
                                        disabled={creating || !formData.name.trim()}
                                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : (editingId != null ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />)}
                                        {editingId != null ? t("modal.save") : t("modal.create")}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
