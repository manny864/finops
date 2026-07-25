"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { Link } from "@/i18n/routing";
import { useTenant } from "@/components/TenantProvider";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import type { CloudProviderId } from "@/lib/providerPolicy";

/**
 * Aviso de la ventana de gracia posterior a un downgrade de Enterprise con
 * `provider = 'both'`: uno de los dos proveedores quedó archivado (sólo
 * lectura) y se purga en N días.
 *
 * Sin este banner el tenant sólo se entera por email y por la notificación
 * in-app de T-30/T-7 — insuficiente para una acción irreversible. Acá tiene las
 * tres salidas: exportar, invertir cuál se retiene, o volver a Enterprise.
 *
 * El color escala con la urgencia: ámbar mientras sobra tiempo, rojo dentro de
 * los últimos 7 días (el mismo umbral del segundo recordatorio por mail).
 *
 * RBAC: el GET usa `requireTenantAccess` (cualquier miembro puede VER que sus
 * datos están por borrarse). El botón de invertir la elección sólo se muestra a
 * Admin/Owner, que es lo que exige el POST — mostrarlo a un Reader sería
 * ofrecerle un botón que siempre devuelve 403.
 */

interface TransitionState {
    provider: CloudProviderId;
    purgeAt: string;
    daysLeft: number;
}

const LABELS: Record<CloudProviderId, string> = { azure: "Azure", aws: "AWS" };

export default function ProviderGraceBanner() {
    const t = useTranslations("provider");
    const { selectedTenant, userRole } = useTenant();
    const { instance, accounts } = useMsal();

    const [state, setState] = useState<TransitionState | null>(null);
    const [busy, setBusy] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    const tenantId = selectedTenant?.id;
    const isMock = isMockTenant(tenantId || "");
    // Invertir la elección decide qué dataset se borra: sólo Admin/Owner, que
    // es lo que exige el POST. Mostrárselo a un Reader sería ofrecerle un botón
    // que siempre devuelve 403. En los tenants de demo tampoco: el POST está
    // interceptado y no cambiaría nada.
    const canElect = (userRole === "Admin" || userRole === "Owner") && !isMock;

    const load = useCallback(async () => {
        if (!tenantId || tenantId === "default") {
            setState(null);
            return;
        }
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(`/api/admin/provider-transition?tenantId=${encodeURIComponent(tenantId)}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) return;
            const data = await res.json();
            if (!data?.archived) {
                setState(null);
                return;
            }
            setState({
                provider: data.archived.provider,
                purgeAt: data.archived.purgeAt,
                daysLeft: data.archived.daysLeft,
            });
        } catch {
            // Silencioso a propósito: es un aviso, no una funcionalidad. Si la
            // llamada falla el usuario sigue recibiendo los emails de T-30/T-7.
        }
    }, [tenantId, instance, accounts]);

    useEffect(() => {
        void load();
    }, [load]);

    const invert = async () => {
        if (!state || !tenantId) return;
        const retained = state.provider; // se retiene el que hoy está archivado
        if (!window.confirm(t("invertConfirm", { retained: LABELS[retained] }))) return;
        setBusy(true);
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/admin/provider-transition", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ tenantId, retained }),
            });
            if (res.ok) {
                // Recarga dura: cambia qué proveedor ve el Sidebar entero.
                window.location.reload();
            }
        } finally {
            setBusy(false);
        }
    };

    if (!state || dismissed) return null;

    const urgent = state.daysLeft <= 7;
    const archivedLabel = LABELS[state.provider];
    const retainedLabel = LABELS[state.provider === "aws" ? "azure" : "aws"];

    return (
        <div
            role="alert"
            className={`mb-4 rounded-xl border px-4 py-3 ${
                urgent
                    ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                    : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
            }`}
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                    <AlertTriangle
                        className={`mt-0.5 h-5 w-5 shrink-0 ${urgent ? "text-red-600" : "text-amber-600"}`}
                        aria-hidden="true"
                    />
                    <div className="text-sm">
                        <p className={`font-bold ${urgent ? "text-red-800 dark:text-red-200" : "text-amber-800 dark:text-amber-200"}`}>
                            {t("graceTitle", { provider: archivedLabel, days: state.daysLeft })}
                        </p>
                        <p className="mt-1 text-ink-soft">
                            {t("graceBody", {
                                archived: archivedLabel,
                                retained: retainedLabel,
                                date: new Date(state.purgeAt).toLocaleDateString(),
                            })}
                        </p>
                    </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Link
                        href="/admin/focus-export"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-deep px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
                    >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("exportCta")}
                    </Link>
                    {canElect && (
                        <button
                            type="button"
                            onClick={invert}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink hover:bg-surface-2 disabled:opacity-50"
                        >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            {t("invertCta", { provider: archivedLabel })}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setDismissed(true)}
                        className="rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-soft hover:text-ink"
                    >
                        {t("dismiss")}
                    </button>
                </div>
            </div>
        </div>
    );
}
