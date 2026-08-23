"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import type {
  TenantNotificationItem,
  NotificationSummaryResponse,
} from "@/types/tenantNotifications.types";

export interface UseTenantNotificationsResult {
  notifications: TenantNotificationItem[];
  unreadCount: number;
  totalCount: number;
  isLoading: boolean;
  error: string | null;
  markAsRead: (notificationId: string | number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string | number) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useTenantNotifications(
  tenantId: string | null | undefined,
  pollIntervalMs = 15000
): UseTenantNotificationsResult {
  const { instance, accounts } = useMsal();
  const [notifications, setNotifications] = useState<TenantNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const activeTenantRef = useRef<string | null | undefined>(tenantId);
  useEffect(() => {
    activeTenantRef.current = tenantId;
  }, [tenantId]);

  const fetchNotifications = useCallback(async (isBackground = false) => {
    const tid = activeTenantRef.current;
    if (!tid || tid === "default") {
      setIsLoading(false);
      return;
    }

    try {
      if (!isBackground) setIsLoading(true);
      setError(null);

      const headers: Record<string, string> = {};
      if (!isMockTenant(tid) && accounts.length > 0) {
        const token = await getFreshIdToken(instance, accounts[0]).catch(() => "");
        if (token) headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/notifications?tenantId=${encodeURIComponent(tid)}&limit=20`, {
        headers,
      });

      if (!res.ok) {
        throw new Error(`Error ${res.status}: no se pudieron cargar las notificaciones`);
      }

      const data: NotificationSummaryResponse = await res.json();
      if (data.success) {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
        setTotalCount(data.totalCount || 0);
      }
    } catch (err: any) {
      if (!isBackground) {
        setError(err?.message || "Error al cargar notificaciones");
      }
    } finally {
      if (!isBackground) setIsLoading(false);
    }
  }, [instance, accounts]);

  // Initial fetch and polling loop
  useEffect(() => {
    fetchNotifications(false);

    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    const interval = setInterval(() => {
      fetchNotifications(true);
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [fetchNotifications, pollIntervalMs, tenantId]);

  // Marcar una notificación individual como leída (Optimista)
  const markAsRead = useCallback(
    async (notificationId: string | number) => {
      const tid = activeTenantRef.current;
      if (!tid) return;

      // Actualización optimista inmediata
      setNotifications((prev) =>
        prev.map((n) =>
          String(n.id) === String(notificationId)
            ? { ...n, isRead: true, readAtIso: new Date().toISOString() }
            : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (!isMockTenant(tid) && accounts.length > 0) {
          const token = await getFreshIdToken(instance, accounts[0]).catch(() => "");
          if (token) headers["Authorization"] = `Bearer ${token}`;
        }

        await fetch("/api/notifications/mark-read", {
          method: "PATCH",
          headers,
          body: JSON.stringify({ tenantId: tid, notificationId }),
        });
      } catch (err) {
        console.error("[useTenantNotifications] Error marking notification as read:", err);
      }
    },
    [instance, accounts]
  );

  // Marcar todas como leídas (Optimista)
  const markAllAsRead = useCallback(async () => {
    const tid = activeTenantRef.current;
    if (!tid) return;

    // Actualización optimista inmediata
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, isRead: true, readAtIso: new Date().toISOString() }))
    );
    setUnreadCount(0);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (!isMockTenant(tid) && accounts.length > 0) {
        const token = await getFreshIdToken(instance, accounts[0]).catch(() => "");
        if (token) headers["Authorization"] = `Bearer ${token}`;
      }

      await fetch("/api/notifications/mark-read", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ tenantId: tid, markAllAsRead: true }),
      });
    } catch (err) {
      console.error("[useTenantNotifications] Error marking all notifications as read:", err);
    }
  }, [instance, accounts]);

  // Eliminar notificación del historial (Optimista)
  const deleteNotification = useCallback(
    async (notificationId: string | number) => {
      const tid = activeTenantRef.current;
      if (!tid) return;

      const target = notifications.find((n) => String(n.id) === String(notificationId));
      if (target && !target.isRead) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
      setNotifications((prev) => prev.filter((n) => String(n.id) !== String(notificationId)));
      setTotalCount((prev) => Math.max(0, prev - 1));

      try {
        const headers: Record<string, string> = {};
        if (!isMockTenant(tid) && accounts.length > 0) {
          const token = await getFreshIdToken(instance, accounts[0]).catch(() => "");
          if (token) headers["Authorization"] = `Bearer ${token}`;
        }

        await fetch(
          `/api/notifications?tenantId=${encodeURIComponent(tid)}&id=${encodeURIComponent(
            String(notificationId)
          )}`,
          {
            method: "DELETE",
            headers,
          }
        );
      } catch (err) {
        console.error("[useTenantNotifications] Error deleting notification:", err);
      }
    },
    [instance, accounts, notifications]
  );

  return {
    notifications,
    unreadCount,
    totalCount,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refetch: () => fetchNotifications(false),
  };
}
