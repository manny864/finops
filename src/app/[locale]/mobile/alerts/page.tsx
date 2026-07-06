"use client";
/**
 * Alertas móvil: estado de las reglas de alerta (Self-Service) y resumen de
 * credenciales por vencer, en tarjetas mobile-first.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { Loader2, BellRing, KeyRound, ChevronRight, ShieldAlert } from "lucide-react";

interface Rule {
    id: number | string;
    ruleName: string;
    ruleType: string;
    thresholdValue: number;
    thresholdUnit: string;
    channel: string;
    enabled: boolean;
    lastTriggeredAt?: string | null;
    triggerCount?: number;
}

export default function MobileAlertsPage() {
    const t = useTranslations("Mobile");
    const ts = useTranslations("AlertsSelfService");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [rules, setRules] = useState<Rule[]>([]);
    const [credCounts, setCredCounts] = useState<{ expired: number; expiring: number } | null>(null);
    const [loading, setLoading] = useState(true);

    const isMock = isMockTenant(selectedTenant?.id || "");

    const load = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            if (isMock) {
                const mock = getMockDataForRoute("alerts", (selectedTenant as { tier?: string }).tier || selectedTenant.id);
                setRules(mock.rules || []);
                setCredCounts({ expired: 1, expiring: 2 });
                return;
            }
            if (accounts.length === 0) return;
            const token = await getFreshIdToken(instance, accounts[0]);
            const headers = { Authorization: `Bearer ${token}` };
            const [rulesRes, credsRes] = await Promise.all([
                fetch(`/api/budgets/alerts?tenantId=${selectedTenant.id}`, { headers }),
                fetch(`/api/governance/expiring-credentials?tenantId=${selectedTenant.id}&daysAhead=3650`, { headers }),
            ]);
            const rulesJson = await rulesRes.json();
            if (rulesRes.ok) setRules(rulesJson.rules || []);
            const credsJson = await credsRes.json();
            if (credsRes.ok && credsJson.items) {
                const items: Array<{ daysTillExpiry: number }> = credsJson.items;
                setCredCounts({
                    expired: items.filter(i => Number(i.daysTillExpiry) < 0).length,
                    expiring: items.filter(i => Number(i.daysTillExpiry) >= 0 && Number(i.daysTillExpiry) <= 30).length,
                });
            }
        } catch {
            // Las tarjetas quedan vacías; el usuario puede reintentar navegando.
        } finally {
            setLoading(false);
        }
    }, [selectedTenant, isMock, accounts, instance]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="max-w-lg mx-auto">
            <h1 className="text-2xl font-extrabold text-ink dark:text-white font-heading mb-4">{t("alertsTitle")}</h1>

            {loading ? (
                <div className="flex items-center gap-2 text-ink-soft py-10 justify-center">
                    <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-base">{t("loading")}</span>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {/* Credenciales */}
                    {credCounts && (credCounts.expired > 0 || credCounts.expiring > 0) && (
                        <Link href="/governance/credentials" className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10 p-4 flex items-center gap-3 active:brightness-95">
                            <KeyRound className="w-7 h-7 text-amber-600 shrink-0" />
                            <div className="flex-1">
                                <div className="text-base font-bold text-amber-800 dark:text-amber-300">{t("credsAttention")}</div>
                                <div className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">
                                    {credCounts.expired > 0 && t("credsExpired", { count: credCounts.expired })}
                                    {credCounts.expired > 0 && credCounts.expiring > 0 && " · "}
                                    {credCounts.expiring > 0 && t("credsExpiring", { count: credCounts.expiring })}
                                </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-amber-500" />
                        </Link>
                    )}

                    {/* Reglas */}
                    {rules.length === 0 ? (
                        <div className="rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-6 text-center">
                            <ShieldAlert className="w-8 h-8 text-ink-soft mx-auto mb-2" />
                            <p className="text-base font-semibold text-ink dark:text-white">{t("noRules")}</p>
                            <p className="text-sm text-ink-soft dark:text-gray-400 mt-1">{t("noRulesDesc")}</p>
                        </div>
                    ) : (
                        rules.map((rule) => {
                            const triggered = !!rule.lastTriggeredAt;
                            return (
                                <div key={rule.id} className="rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4 shadow-sm">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-base font-bold text-ink dark:text-white leading-snug">{rule.ruleName}</div>
                                            <div className="text-sm text-ink-soft dark:text-gray-400 mt-0.5">
                                                {ts(`types.${rule.ruleType}` as `types.budget`)} · {rule.thresholdValue} {rule.thresholdUnit} · {rule.channel}
                                            </div>
                                        </div>
                                        <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${!rule.enabled
                                            ? "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-400"
                                            : triggered
                                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"}`}>
                                            {!rule.enabled ? t("ruleDisabled") : triggered ? t("ruleTriggered") : t("ruleOk")}
                                        </span>
                                    </div>
                                    {triggered && rule.lastTriggeredAt && (
                                        <div className="text-xs text-ink-soft dark:text-gray-500 mt-2">
                                            {t("lastTriggered", { date: new Date(rule.lastTriggeredAt).toLocaleString() })}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}

                    <Link href="/intelligence/alerts" className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-brand-deep/40 p-4 text-base font-bold text-brand-deep dark:text-brand-sky active:bg-brand-soft/30">
                        <BellRing className="w-5 h-5" /> {t("manageRules")}
                    </Link>
                </div>
            )}
        </div>
    );
}
