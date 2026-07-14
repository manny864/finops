"use client";
import { useEffect, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useActionLogStore } from "@/store/actionLogStore";

const POLL_MS = 60_000;
const LAST_SEEN_KEY_PREFIX = "finops_notifications_last_seen_";

/**
 * Polling de la bandeja server-side de notificaciones (tabla Notifications,
 * ver src/lib/notify.ts) mientras haya una pestaña abierta con un tenant real
 * seleccionado. Por cada notificación nueva:
 *  - la agrega al store del Centro de Acciones (bell del header), con `href`
 *    para poder navegar a la página que la generó.
 *  - si el usuario otorgó permiso (Notification.permission === 'granted'),
 *    dispara además una notificación real del navegador — el click navega a
 *    `href`.
 * El permiso se pide explícitamente en otro lado (botón en
 * ActionCenterDrawer) — nunca se pide automáticamente acá, para no violar
 * las normas de UX de la Notification API (requiere gesto del usuario).
 */
export function useBrowserNotifications(tenantId: string | undefined) {
    const { instance, accounts } = useMsal();
    const addAction = useActionLogStore((s) => s.addAction);
    const lastSeenIdRef = useRef<number>(0);

    useEffect(() => {
        if (!tenantId || tenantId === "default" || isMockTenant(tenantId)) return;

        const storageKey = `${LAST_SEEN_KEY_PREFIX}${tenantId}`;
        const stored = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
        lastSeenIdRef.current = stored ? Number(stored) || 0 : 0;

        let cancelled = false;

        const poll = async () => {
            if (accounts.length === 0) return;
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const res = await fetch(`/api/notifications?tenantId=${tenantId}&sinceId=${lastSeenIdRef.current}`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                });
                if (!res.ok) return;
                const data = await res.json();
                const items: Array<{ id: number; title: string; message: string; href: string | null; severity: string }> = data.notifications || [];
                if (cancelled || items.length === 0) return;

                // La API devuelve más nuevo primero; procesamos en orden cronológico.
                for (const n of [...items].reverse()) {
                    addAction({
                        message: n.title,
                        status: n.severity === "critical" ? "error" : n.severity === "warning" ? "info" : "info",
                        href: n.href || undefined,
                    });
                    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
                        const browserNotif = new Notification(n.title, { body: n.message, tag: `finops-notif-${n.id}` });
                        if (n.href) {
                            browserNotif.onclick = () => {
                                window.focus();
                                window.location.href = n.href!;
                            };
                        }
                    }
                }

                const maxId = Math.max(...items.map((n) => n.id));
                lastSeenIdRef.current = maxId;
                window.localStorage.setItem(storageKey, String(maxId));
            } catch (e) {
                console.error("[useBrowserNotifications] poll failed:", e);
            }
        };

        void poll();
        const intervalId = setInterval(poll, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, [tenantId, accounts.length, instance, addAction]);
}

/** Estado actual del permiso del navegador, o null si la API no existe (SSR/navegadores viejos). */
export function getNotificationPermission(): NotificationPermission | null {
    if (typeof window === "undefined" || !("Notification" in window)) return null;
    return Notification.permission;
}

/** Pide permiso — DEBE llamarse desde un handler de click (gesto del usuario). */
export async function requestNotificationPermission(): Promise<NotificationPermission | null> {
    if (typeof window === "undefined" || !("Notification" in window)) return null;
    return Notification.requestPermission();
}
