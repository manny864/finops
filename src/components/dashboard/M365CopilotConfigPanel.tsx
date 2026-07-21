"use client";
import React, { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { Loader2, CheckCircle2, AlertCircle, Clock, WifiOff, RefreshCw, Trash2, Zap, Send } from "lucide-react";
import useSWR from "swr";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConnectorStatus = "not_configured" | "provisioning" | "ready" | "error";

interface M365Config {
    tenantId?: string;
    status: ConnectorStatus;
    connectorId?: string | null;
    copilotStudioAgentId?: string | null;
    indexedRecords?: number;
    lastIndexAt?: string | null;
    config?: Record<string, any> | null;
}

interface ApiResponse {
    success: boolean;
    mock?: boolean;
    config: M365Config;
}

interface AskResponse {
    success: boolean;
    mock?: boolean;
    question: string;
    answer: string;
    adaptiveCard?: {
        type: string;
        version: string;
        body: Array<{
            type: string;
            text?: string;
            weight?: string;
            size?: string;
            spacing?: string;
            color?: string;
            facts?: Array<{ title: string; value: string }>;
        }>;
    };
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ConnectorStatus, string> = {
    not_configured: "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400",
    provisioning: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400",
    ready: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400",
    error: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400",
};

const STATUS_ICONS: Record<ConnectorStatus, React.ReactNode> = {
    not_configured: <WifiOff className="w-3.5 h-3.5" />,
    provisioning: <Clock className="w-3.5 h-3.5 animate-pulse" />,
    ready: <CheckCircle2 className="w-3.5 h-3.5" />,
    error: <AlertCircle className="w-3.5 h-3.5" />,
};

function StatusBadge({ status, label }: { status: ConnectorStatus; label: string }) {
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[status]}`}>
            {STATUS_ICONS[status]}
            {label}
        </span>
    );
}

// ─── Adaptive Card Renderer ───────────────────────────────────────────────────

function AdaptiveCardPreview({ card }: { card: AskResponse["adaptiveCard"] }) {
    if (!card) return null;
    return (
        <div className="mt-3 border border-gray-200 dark:border-slate-700 rounded-xl p-4 bg-white dark:bg-slate-900 space-y-3">
            {card.body.map((block, i) => {
                if (block.type === "TextBlock") {
                    const isWarning = block.color === "Warning";
                    const isBolder = block.weight === "Bolder";
                    const isLarge = block.size === "Large";
                    return (
                        <p
                            key={i}
                            className={[
                                isLarge ? "text-base" : "text-sm",
                                isBolder ? "font-bold" : "font-normal",
                                isWarning ? "text-amber-600 dark:text-amber-400" : "text-slate-800 dark:text-slate-200",
                                block.spacing === "Medium" ? "mt-3" : "",
                            ].join(" ")}
                        >
                            {block.text}
                        </p>
                    );
                }
                if (block.type === "FactSet" && block.facts) {
                    return (
                        <dl key={i} className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                            {block.facts.map((f, j) => (
                                <React.Fragment key={j}>
                                    <dt className="text-slate-500 dark:text-slate-400">{f.title}</dt>
                                    <dd className="font-semibold text-slate-800 dark:text-slate-200">{f.value}</dd>
                                </React.Fragment>
                            ))}
                        </dl>
                    );
                }
                return null;
            })}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function M365CopilotConfigPanel() {
    const t = useTranslations("CopilotM365");
    const tMock = useTranslations("Mock");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [question, setQuestion] = useState("");
    const [askResult, setAskResult] = useState<AskResponse | null>(null);
    const [askLoading, setAskLoading] = useState(false);
    const [askError, setAskError] = useState<string | null>(null);

    const tenantId = selectedTenant?.id;

    // ── Auth helper ────────────────────────────────────────────────────────────
    const getToken = useCallback(async (): Promise<string> => {
        const account = accounts[0];
        if (!account) throw new Error("No hay cuenta autenticada");
        const resp = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
        return resp.idToken;
    }, [instance, accounts]);

    // ── SWR fetcher ────────────────────────────────────────────────────────────
    const fetcher = useCallback(async (url: string) => {
        const token = await getToken();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || "Error al cargar configuración");
        }
        return res.json() as Promise<ApiResponse>;
    }, [getToken]);

    const { data, error, isLoading, mutate } = useSWR<ApiResponse>(
        tenantId && tenantId !== "default" && accounts.length > 0
            ? `/api/copilot-m365/config?tenantId=${tenantId}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const config: M365Config = data?.config ?? { status: "not_configured", indexedRecords: 0, lastIndexAt: null };
    // Defensa: si la API devuelve un status no esperado o undefined → tratar como not_configured
    const safeStatus: ConnectorStatus = (["not_configured", "provisioning", "ready", "error"].includes(config.status as string)
        ? config.status
        : "not_configured") as ConnectorStatus;
    const isMock = data?.mock === true;

    // ── Action handler ─────────────────────────────────────────────────────────
    const handleAction = async (action: "provision" | "reindex" | "revoke") => {
        if (!tenantId) return;
        setActionLoading(action);
        try {
            const token = await getToken();
            const res = await fetch(`/api/copilot-m365/config?tenantId=${tenantId}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || "Error en la acción");
            }
            await mutate();
        } catch (err: any) {
            console.error("M365 action error:", err);
        } finally {
            setActionLoading(null);
        }
    };

    // ── Ask handler ────────────────────────────────────────────────────────────
    const handleAsk = async () => {
        if (!tenantId || !question.trim()) return;
        setAskLoading(true);
        setAskError(null);
        setAskResult(null);
        try {
            const token = await getToken();
            const res = await fetch("/api/copilot-m365/ask", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId, question }),
            });
            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || "Error al consultar");
            }
            const json: AskResponse = await res.json();
            setAskResult(json);
        } catch (err: any) {
            setAskError(err.message);
        } finally {
            setAskLoading(false);
        }
    };

    if (!tenantId || tenantId === "default") return null;

    return (
        <div className="space-y-6">
            {/* Mock banner */}
            {isMock && (
                <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-sm">
                    <span className="font-bold text-xs px-2 py-0.5 bg-amber-200 dark:bg-amber-800 rounded-full">
                        {tMock("badge")}
                    </span>
                    <span>{tMock("description")}</span>
                </div>
            )}

            {/* Loading / error states */}
            {isLoading && (
                <div className="flex items-center gap-3 py-10 justify-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="text-sm">{t("loading")}</span>
                </div>
            )}
            {error && !isLoading && (
                parseTierRequiredError(error.message) ? (
                    <TierLockedNotice requiredTier={parseTierRequiredError(error.message)!} currentTier={(selectedTenant as any)?.tier} featureName="M365 Copilot" />
                ) : (
                    <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-100 dark:border-red-900/50 text-sm">
                        <p className="font-bold">{t("errorLabel")}</p>
                        <p>{error.message}</p>
                    </div>
                )
            )}

            {/* Cards */}
            {!isLoading && !error && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Card 1: Graph Connector */}
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-5 space-y-4">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                                    {t("connectorTitle")}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {t("connectorDesc")}
                                </p>
                            </div>
                            <StatusBadge status={safeStatus} label={t(`statuses.${safeStatus}`)} />
                        </div>

                        {config.connectorId && (
                            <div className="text-xs font-mono bg-gray-50 dark:bg-slate-800 rounded px-3 py-2 text-slate-600 dark:text-slate-300 break-all">
                                {config.connectorId}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-3">
                                <p className="text-xs text-slate-500 dark:text-slate-400">{t("indexedRecords")}</p>
                                <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                                    {(config.indexedRecords ?? 0).toLocaleString()}
                                </p>
                            </div>
                            <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-3">
                                <p className="text-xs text-slate-500 dark:text-slate-400">{t("lastIndex")}</p>
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-0.5 break-all">
                                    {config.lastIndexAt
                                        ? new Date(config.lastIndexAt).toLocaleString()
                                        : "—"}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {safeStatus === "not_configured" && (
                                <ActionButton
                                    label={t("provision")}
                                    icon={<Zap className="w-3.5 h-3.5" />}
                                    loading={actionLoading === "provision"}
                                    onClick={() => handleAction("provision")}
                                    variant="primary"
                                />
                            )}
                            {safeStatus === "ready" && (
                                <>
                                    <ActionButton
                                        label={t("reindex")}
                                        icon={<RefreshCw className="w-3.5 h-3.5" />}
                                        loading={actionLoading === "reindex"}
                                        onClick={() => handleAction("reindex")}
                                        variant="secondary"
                                    />
                                    <ActionButton
                                        label={t("revoke")}
                                        icon={<Trash2 className="w-3.5 h-3.5" />}
                                        loading={actionLoading === "revoke"}
                                        onClick={() => handleAction("revoke")}
                                        variant="danger"
                                    />
                                </>
                            )}
                            {safeStatus === "provisioning" && (
                                <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Provisionando…
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Card 2: Copilot Studio Agent */}
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-5 space-y-4">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                                    {t("studioTitle")}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {t("studioDesc")}
                                </p>
                            </div>
                            <StatusBadge status={safeStatus} label={t(`statuses.${safeStatus}`)} />
                        </div>

                        {config.copilotStudioAgentId && (
                            <div className="text-xs font-mono bg-gray-50 dark:bg-slate-800 rounded px-3 py-2 text-slate-600 dark:text-slate-300 break-all">
                                {config.copilotStudioAgentId}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-3">
                                <p className="text-xs text-slate-500 dark:text-slate-400">{t("indexedRecords")}</p>
                                <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                                    {(config.indexedRecords ?? 0).toLocaleString()}
                                </p>
                            </div>
                            <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-3">
                                <p className="text-xs text-slate-500 dark:text-slate-400">{t("lastIndex")}</p>
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-0.5 break-all">
                                    {config.lastIndexAt
                                        ? new Date(config.lastIndexAt).toLocaleString()
                                        : "—"}
                                </p>
                            </div>
                        </div>

                        {/* Try a question */}
                        <div className="space-y-2 pt-1 border-t border-gray-100 dark:border-slate-800">
                            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                                Hacer una pregunta al agente
                            </label>
                            <textarea
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                placeholder="Ej: ¿Cuál fue el costo total del último mes?"
                                rows={3}
                                className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-800 dark:text-slate-200 placeholder:text-slate-400"
                            />
                            <button
                                onClick={handleAsk}
                                disabled={askLoading || !question.trim()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors"
                            >
                                {askLoading ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <Send className="w-3.5 h-3.5" />
                                )}
                                Enviar
                            </button>
                        </div>

                        {askError && (
                            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                                {askError}
                            </div>
                        )}

                        {askResult && (
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t("answerLabel")}</p>
                                <p className="text-sm text-slate-800 dark:text-slate-200 bg-gray-50 dark:bg-slate-800/60 rounded-xl px-4 py-3 leading-relaxed">
                                    {askResult.answer}
                                </p>
                                {askResult.adaptiveCard && (
                                    <>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                            Adaptive Card Preview:
                                        </p>
                                        <AdaptiveCardPreview card={askResult.adaptiveCard} />
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Requirements footnote */}
            {!isLoading && !error && (
                <p className="text-xs text-slate-400 dark:text-slate-500 border-t border-gray-100 dark:border-slate-800 pt-4">
                    {t("requirements")}
                </p>
            )}
        </div>
    );
}

// ─── Action Button helper ─────────────────────────────────────────────────────

function ActionButton({
    label,
    icon,
    loading,
    onClick,
    variant,
}: {
    label: string;
    icon: React.ReactNode;
    loading: boolean;
    onClick: () => void;
    variant: "primary" | "secondary" | "danger";
}) {
    const styles = {
        primary: "bg-blue-600 hover:bg-blue-700 text-white",
        secondary: "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200",
        danger: "bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800",
    };
    return (
        <button
            onClick={onClick}
            disabled={loading}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 ${styles[variant]}`}
        >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
            {label}
        </button>
    );
}
