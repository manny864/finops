"use client";
import React, { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
    IconAlertCircle,
    IconCheck,
    IconCircleCheck,
    IconCopy,
    IconHistory,
    IconLoader2,
    IconPlugConnected,
    IconPlugConnectedX,
    IconRefresh,
    IconRobot,
    IconSend,
    IconSparkles,
    IconTrash,
} from "@tabler/icons-react";
import useSWR from "swr";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import InfoTooltip from "@/components/InfoTooltip";
import { errorMessage } from '@/lib/apiErrors';

// ─── Types ────────────────────────────────────────────────────────────────────

type ConnectorStatus = "not_configured" | "provisioning" | "ready" | "error";
type AgentStatus = "READY" | "CONFIGURING" | "DISABLED";

interface M365IndexLog {
    id: string;
    triggerType: "MANUAL" | "SCHEDULED";
    itemsProcessedCount: number;
    durationMs: number;
    httpStatusCode: number | null;
    status: "SUCCESS" | "FAILED";
    errorMessage: string | null;
    createdAtIso: string;
}

interface M365Config {
    tenantId?: string;
    status: ConnectorStatus;
    connectorStatus?: "READY" | "SYNCING" | "ERROR" | "REVOKED" | "NOT_CONFIGURED";
    agentStatus?: AgentStatus;
    connectorId?: string | null;
    connectionName?: string | null;
    copilotStudioAgentId?: string | null;
    indexedRecords?: number;
    totalIndexedRecordsCount?: number | null;
    lastIndexAt?: string | null;
    formattedLastIndexedDate?: string | null;
    lastIndexError?: string | null;
    schemaVersion?: string | null;
    config?: Record<string, any> | null;
}

interface ApiResponse {
    success: boolean;
    mock?: boolean;
    config: M365Config;
    logs?: M365IndexLog[];
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
    not_configured: "bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    provisioning: "bg-blue-50 text-[#0054A6] border border-blue-200 animate-pulse dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
    ready: "bg-blue-50 text-[#0054A6] border border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900",
    error: "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900",
};

const STATUS_ICONS: Record<ConnectorStatus, React.ReactNode> = {
    not_configured: <IconPlugConnectedX size={14} stroke={1.5} />,
    provisioning: <IconRefresh size={14} stroke={1.5} className="animate-spin" />,
    ready: <IconCircleCheck size={14} stroke={1.5} />,
    error: <IconAlertCircle size={14} stroke={1.5} />,
};

function StatusBadge({ status, label }: { status: ConnectorStatus; label: string }) {
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[status]}`}>
            {STATUS_ICONS[status]}
            {label}
        </span>
    );
}

function AgentStatusBadge({ status, label }: { status: AgentStatus; label: string }) {
    const styles: Record<AgentStatus, string> = {
        READY: "bg-blue-50 text-[#0054A6] border border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900",
        CONFIGURING: "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900",
        DISABLED: "bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    };
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${styles[status] || styles.DISABLED}`}>
            <IconRobot size={14} stroke={1.5} />
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
                                isLarge ? "text-base font-semibold" : "text-sm",
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
                        <dl key={i} className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm pt-2">
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
    const [actionError, setActionError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
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
            const json = await res.json().catch(() => ({}));
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
    const logs: M365IndexLog[] = data?.logs ?? [];

    const safeStatus: ConnectorStatus = (["not_configured", "provisioning", "ready", "error"].includes(config.status as string)
        ? config.status
        : "not_configured") as ConnectorStatus;
    const safeAgentStatus: AgentStatus = (config.agentStatus || "DISABLED") as AgentStatus;
    const isMock = data?.mock === true;

    // ── Copy helper ────────────────────────────────────────────────────────────
    const handleCopyId = () => {
        if (!config.connectorId) return;
        navigator.clipboard.writeText(config.connectorId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // ── Action handler ─────────────────────────────────────────────────────────
    const handleAction = async (action: "provision" | "reindex" | "revoke") => {
        if (!tenantId) return;
        setActionLoading(action);
        setActionError(null);
        try {
            const token = await getToken();
            const res = await fetch(`/api/copilot-m365/config?tenantId=${tenantId}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(json.error || "Error en la acción con Microsoft Graph");
            }
            await mutate();
        } catch (err: any) {
            console.error("M365 action error:", err);
            setActionError(errorMessage(err));
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
                const json = await res.json().catch(() => ({}));
                throw new Error(json.error || "Error al consultar al agente");
            }
            const json: AskResponse = await res.json();
            setAskResult(json);
        } catch (err) {
            setAskError(errorMessage(err));
        } finally {
            setAskLoading(false);
        }
    };

    if (!tenantId || tenantId === "default") return null;

    return (
        <div className="space-y-6 w-full max-w-full">
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
                    <IconLoader2 size={16} stroke={1.5} className="w-6 h-6 animate-spin text-[#0054A6]" />
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

            {/* Action error banner */}
            {actionError && (
                <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-rose-800 dark:text-rose-200">
                        <IconAlertCircle size={15} stroke={1.5} />
                        {actionError.includes("403") || actionError.includes("ExternalConnection") ? t("permissionErrorTitle") : t("errorLabel")}
                    </div>
                    <p>{actionError}</p>
                    {(actionError.includes("403") || actionError.includes("ExternalConnection")) && (
                        <p className="text-slate-600 dark:text-slate-400 pt-1">
                            {t("permissionErrorHelp")}
                        </p>
                    )}
                </div>
            )}

            {/* Corporate Licensing & Permissions Disclaimer (Directivas 20, 21, 24) */}
            {!isLoading && !error && (
                <div className="p-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/70 rounded-xl text-xs text-[#1B2A41] dark:text-slate-200 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                        <IconInfoCircle size={17} stroke={1.5} className="text-[#0054A6] dark:text-[#00AEEF] shrink-0" />
                        <span>{t("disclaimerTitle")}</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-[11.5px]">
                        {t("disclaimerText")}
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-300 text-[11.5px] pl-1">
                        <li>
                            <strong className="text-[#1B2A41] dark:text-slate-100 font-medium">Licencia M365:</strong> {t("disclaimerReqLicenses")}
                        </li>
                        <li>
                            <strong className="text-[#1B2A41] dark:text-slate-100 font-medium">Permisos Entra ID:</strong> {t("disclaimerReqPermissions")}
                        </li>
                    </ul>
                </div>
            )}

            {/* Main Cards Grid */}
            {!isLoading && !error && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Card 1: Microsoft Graph External Connector */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6 space-y-5 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-1.5">
                                        <h3 className="font-bold text-[#1B2A41] dark:text-slate-100 text-base font-['Montserrat',sans-serif]">
                                            {t("connectorTitle")}
                                        </h3>
                                        <InfoTooltip content={t("connectorDesc")} />
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                        {t("connectorDesc")}
                                    </p>
                                </div>
                                <StatusBadge status={safeStatus} label={t(`statuses.${safeStatus}`)} />
                            </div>

                            {/* Connection ID snippet */}
                            {config.connectorId ? (
                                <div className="flex items-center justify-between gap-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-200">
                                    <div className="truncate">
                                        <span className="text-slate-400 dark:text-slate-500 mr-1.5 font-sans font-medium text-[11px]">{t("connectionIdLabel")}:</span>
                                        <span className="font-bold text-[#0054A6] dark:text-blue-400">{config.connectorId}</span>
                                    </div>
                                    <button
                                        onClick={handleCopyId}
                                        className="inline-flex items-center gap-1 text-[11px] font-sans px-2 py-0.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded hover:bg-slate-100 text-slate-700 dark:text-slate-200 transition-colors"
                                        title={t("copy")}
                                    >
                                        {copied ? <IconCheck size={12} className="text-[#10B981]" /> : <IconCopy size={12} />}
                                        {copied ? t("copied") : t("copy")}
                                    </button>
                                </div>
                            ) : (
                                <div className="text-xs text-slate-500 dark:text-slate-400 italic bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
                                    {t("noConnectionYet")}
                                </div>
                            )}

                            {/* Metrics Grid */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-lg p-3">
                                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("indexedRecords")}</p>
                                    <p className="text-xl font-extrabold text-[#0054A6] dark:text-blue-400 tabular-nums mt-0.5 font-['Montserrat',sans-serif]">
                                        {config.totalIndexedRecordsCount != null
                                            ? config.totalIndexedRecordsCount.toLocaleString()
                                            : "0"}
                                    </p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-lg p-3">
                                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("lastIndex")}</p>
                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1 truncate">
                                        {config.formattedLastIndexedDate || (config.lastIndexAt ? new Date(config.lastIndexAt).toLocaleDateString() : t("neverIndexed"))}
                                    </p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-lg p-3">
                                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("schemaVersion")}</p>
                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1 font-mono">
                                        {config.schemaVersion ? `FOCUS v${config.schemaVersion}` : "FOCUS 1.0"}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Actions (Directiva 21) */}
                        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                            {(!config.connectorId || safeStatus === "not_configured") ? (
                                <ActionButton
                                    label={actionLoading === "provision" ? t("provisionInProgress") : t("provision")}
                                    icon={<IconSparkles size={15} stroke={1.5} className="text-[#0054A6]" />}
                                    loading={actionLoading === "provision"}
                                    onClick={() => handleAction("provision")}
                                    variant="primary"
                                />
                            ) : (
                                <>
                                    <ActionButton
                                        label={actionLoading === "reindex" ? t("reindexInProgress") : t("reindex")}
                                        icon={<IconRefresh size={15} stroke={1.5} className="text-[#0054A6]" />}
                                        loading={actionLoading === "reindex"}
                                        onClick={() => handleAction("reindex")}
                                        variant="primary"
                                    />
                                    <ActionButton
                                        label={t("revoke")}
                                        icon={<IconTrash size={15} stroke={1.5} className="text-rose-600" />}
                                        loading={actionLoading === "revoke"}
                                        onClick={() => handleAction("revoke")}
                                        variant="danger"
                                    />
                                </>
                            )}
                            {safeStatus === "provisioning" && (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-[#0054A6] dark:text-blue-400 flex items-center gap-1.5 font-medium">
                                        <IconLoader2 size={15} stroke={1.5} className="animate-spin text-[#0054A6]" />
                                        {t("provisionInProgress")}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Card 2: Copilot Studio Agent (FinOps Copilot) */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6 space-y-5 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-1.5">
                                        <h3 className="font-bold text-[#1B2A41] dark:text-slate-100 text-base font-['Montserrat',sans-serif]">
                                            {t("studioTitle")}
                                        </h3>
                                        <InfoTooltip content={t("studioDesc")} />
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                        {t("studioDesc")}
                                    </p>
                                </div>
                                <AgentStatusBadge status={safeAgentStatus} label={t(`agentStatuses.${safeAgentStatus}`)} />
                            </div>

                            {/* Agent Metas */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-lg p-3">
                                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("agentStatus")}</p>
                                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">
                                        {t(`agentStatuses.${safeAgentStatus}`)}
                                    </p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-lg p-3">
                                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("groundingSources")}</p>
                                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1 truncate" title={t("groundingSourcesVal")}>
                                        {t("groundingSourcesVal")}
                                    </p>
                                </div>
                            </div>

                            {/* Ask Question Interactive Area */}
                            <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                                    {t("askQuestionLabel")}
                                </label>
                                <textarea
                                    value={question}
                                    onChange={(e) => setQuestion(e.target.value)}
                                    placeholder={t("askPlaceholder")}
                                    rows={3}
                                    className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#0054A6] text-slate-800 dark:text-slate-200 placeholder:text-slate-400"
                                />
                                <div className="flex justify-end">
                                    <ActionButton
                                        label={t("sendButton")}
                                        icon={<IconSend size={14} stroke={1.5} className="text-[#0054A6]" />}
                                        loading={askLoading}
                                        onClick={handleAsk}
                                        variant="primary"
                                    />
                                </div>
                            </div>

                            {askError && (
                                <div className="text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-2 flex items-center gap-2">
                                    <IconAlertCircle size={14} />
                                    <span>{askError}</span>
                                </div>
                            )}

                            {askResult && (
                                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t("answerLabel")}</p>
                                    <p className="text-xs text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 leading-relaxed">
                                        {askResult.answer}
                                    </p>
                                    {askResult.adaptiveCard && (
                                        <AdaptiveCardPreview card={askResult.adaptiveCard} />
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Indexing History / Logs Table (Directiva 19 & 20) */}
            {!isLoading && !error && logs.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <IconHistory size={18} stroke={1.5} className="text-[#0054A6]" />
                            <h4 className="font-bold text-[#1B2A41] dark:text-slate-100 text-sm font-['Montserrat',sans-serif]">
                                {t("logsTitle")}
                            </h4>
                        </div>
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                            {t("logsSubtitle")}
                        </span>
                    </div>

                    <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-semibold bg-slate-50/50 dark:bg-slate-800/40">
                                    <th className="py-2.5 px-3">{t("colDate")}</th>
                                    <th className="py-2.5 px-3">{t("colTrigger")}</th>
                                    <th className="py-2.5 px-3 text-right">{t("colItems")}</th>
                                    <th className="py-2.5 px-3 text-right">{t("colDuration")}</th>
                                    <th className="py-2.5 px-3 text-center">{t("colHttp")}</th>
                                    <th className="py-2.5 px-3 text-center">{t("colStatus")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {logs.map((log) => (
                                    <tr key={log.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 font-medium">
                                            {log.createdAtIso ? new Date(log.createdAtIso).toLocaleString() : "—"}
                                        </td>
                                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                                            {log.triggerType === "SCHEDULED" ? t("triggerScheduled") : t("triggerManual")}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-semibold text-[#0054A6] dark:text-blue-400 tabular-nums">
                                            {log.itemsProcessedCount.toLocaleString()}
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-400 tabular-nums">
                                            {log.durationMs > 1000 ? `${(log.durationMs / 1000).toFixed(1)}s` : `${log.durationMs}ms`}
                                        </td>
                                        <td className="py-2.5 px-3 text-center font-mono text-[11px] text-slate-500">
                                            {log.httpStatusCode ?? "—"}
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                            <span
                                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                                                    log.status === "SUCCESS"
                                                        ? "bg-blue-50 text-[#0054A6] border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800"
                                                        : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800"
                                                }`}
                                            >
                                                {log.status === "SUCCESS" ? t("logSuccess") : t("logFailed")}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Requirements footnote */}
            {!isLoading && !error && (
                <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-4">
                    <IconPlugConnected size={14} stroke={1.5} className="text-slate-400" />
                    <span>{t("requirements")}</span>
                </div>
            )}
        </div>
    );
}

// ─── Action Button (Directiva 21) ─────────────────────────────────────────────

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
    // Directiva 21: Rectangular suave (rounded-lg), Fondo SIEMPRE blanco puro (bg-white dark:bg-slate-900)
    // El color del borde exterior coincide estrictamente con el color del texto e icono.
    const styles = {
        primary: "bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 text-[#0054A6] dark:text-blue-400 border border-[#0054A6] dark:border-blue-500 shadow-sm",
        secondary: "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 shadow-sm",
        danger: "bg-white dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-800 shadow-sm",
    };
    return (
        <button
            onClick={onClick}
            disabled={loading}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 disabled:opacity-50 cursor-pointer ${styles[variant]}`}
        >
            {loading ? <IconLoader2 size={14} stroke={1.5} className="animate-spin text-current" /> : icon}
            <span>{label}</span>
        </button>
    );
}
