"use client";
/**
 * Acciones de soporte del header:
 *  - Link a /support (todos los usuarios, junto al icono de usuario).
 *  - Link a /superadmin/support ("Soporte Global") solo para miembros de
 *    CSCloudSolutions (superadmins) — el server igual re-valida con RBAC.
 *  - Poller (60s) de novedades de soporte: cuando llega un mensaje nuevo
 *    (respuesta de soporte para usuarios; mensaje de cliente para el equipo),
 *    inyecta una notificación en la campanita (actionLogStore) y un toast.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTenant } from "@/components/TenantProvider";
import { useActionLogStore } from "@/store/actionLogStore";
import { isSuperAdmin } from "@/lib/authGuard";
import { isMockTenant } from "@/lib/mockData";
import { LifeBuoy, Headset } from "lucide-react";
import { toast } from "sonner";

const POLL_MS = 60000;

export default function SupportHeaderActions() {
    const t = useTranslations("Support");
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const addAction = useActionLogStore((s) => s.addAction);
    const polling = useRef(false);

    const superAdmin = isSuperAdmin(accounts[0]?.username);

    const poll = useCallback(async () => {
        if (polling.current || accounts.length === 0) return;
        polling.current = true;
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            if (!token) return;
            const headers = { Authorization: `Bearer ${token}` };

            const checks: Array<{ key: string; url: string; notify: (row: { subject: string; authorName: string | null }) => void }> = [];

            if (selectedTenant?.id && selectedTenant.id !== "default" && !isMockTenant(selectedTenant.id)) {
                checks.push({
                    key: `support:lastSeen:${selectedTenant.id}`,
                    url: `/api/support/notifications?tenantId=${selectedTenant.id}`,
                    notify: (row) => {
                        const msg = t("notifNewReply", { subject: row.subject });
                        addAction({ message: msg, status: "info" });
                        toast.info(msg);
                    },
                });
            }
            if (superAdmin) {
                checks.push({
                    key: "support:lastSeen:global",
                    url: "/api/support/notifications?scope=global",
                    notify: (row) => {
                        const msg = t("notifNewCustomerMsg", { subject: row.subject, author: row.authorName || "" });
                        addAction({ message: msg, status: "info" });
                        toast.info(msg);
                    },
                });
            }

            for (const check of checks) {
                const since = localStorage.getItem(check.key);
                const url = since ? `${check.url}${check.url.includes("?") ? "&" : "?"}since=${encodeURIComponent(since)}` : check.url;
                const res = await fetch(url, { headers });
                if (!res.ok) continue;
                const json = await res.json();
                for (const row of (json.latest || []).slice(0, 3)) {
                    check.notify(row);
                }
                localStorage.setItem(check.key, new Date().toISOString());
            }
        } catch {
            // Polling silencioso: nunca romper el header por fallas de red.
        } finally {
            polling.current = false;
        }
    }, [accounts, instance, selectedTenant, superAdmin, addAction, t]);

    useEffect(() => {
        const id = setInterval(poll, POLL_MS);
        // Primer chequeo diferido para no competir con la carga inicial.
        const first = setTimeout(poll, 5000);
        return () => { clearInterval(id); clearTimeout(first); };
    }, [poll]);

    if (accounts.length === 0) return null;

    return (
        <>
            <Link
                href="/support"
                title={t("title")}
                className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
                <LifeBuoy className="w-5 h-5" />
            </Link>
            {superAdmin && (
                <Link
                    href="/superadmin/support"
                    title="Soporte Global (CSCloudSolutions)"
                    className="p-2 text-brand-deep hover:brightness-125 transition-colors"
                >
                    <Headset className="w-5 h-5" />
                </Link>
            )}
        </>
    );
}
