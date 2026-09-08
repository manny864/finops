"use client";
import { useFormatter, useTranslations } from "next-intl";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconBell,
  IconChecklist,
  IconFileReport,
  IconTrendingUp,
  IconKey,
  IconAlertCircle,
  IconShieldExclamation,
  IconTrash,
  IconArrowRight,
  IconInbox,
  IconX,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useTenantNotifications } from "@/hooks/useTenantNotifications";
import type {
  NotificationEventType,
  TenantNotificationItem,
} from "@/types/tenantNotifications.types";
import { textoDeNotificacion } from "@/lib/notificationText";

type FilterTab = "ALL" | "REPORTS" | "ANOMALIES" | "SECURITY";

/**
 * "Hace 5 min" en el idioma del lector. El servidor manda `createdAtIso` y nada
 * mas: antes viajaba tambien un `formattedTimeAgo` armado en castellano como
 * respaldo, pero el servicio siempre construye la fecha con `.toISOString()`,
 * asi que la rama nunca corria — y si corria, mostraba castellano.
 */
function hace(
  item: TenantNotificationItem,
  format: ReturnType<typeof useFormatter>,
): string {
  const fecha = new Date(item.createdAtIso);
  if (Number.isNaN(fecha.getTime())) return "";
  return format.relativeTime(fecha, new Date());
}

export function NotificationBellDropdown() {
  const router = useRouter();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("ALL");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useTenantNotifications(tenantId);
  const t = useTranslations("Notifications");
  const format = useFormatter();

  // Auto-cerrar al hacer clic fuera del dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const filteredNotifications = notifications.filter((n) => {
    if (activeFilter === "REPORTS") return n.type === "REPORT_READY";
    if (activeFilter === "ANOMALIES") return n.type === "ANOMALY_DETECTED" || n.type === "BUDGET_EXCEEDED";
    if (activeFilter === "SECURITY") return n.type === "CREDENTIAL_EXPIRING" || n.type === "SYSTEM_ALERT";
    return true;
  });

  const getEventIcon = (type: NotificationEventType) => {
    switch (type) {
      case "REPORT_READY":
        return (
          <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-[#0078D4] border border-blue-200 dark:border-blue-800">
            <IconFileReport size={18} stroke={1.5} />
          </div>
        );
      case "ANOMALY_DETECTED":
        return (
          <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 border border-amber-200 dark:border-amber-800">
            <IconTrendingUp size={18} stroke={1.5} />
          </div>
        );
      case "CREDENTIAL_EXPIRING":
        return (
          <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 border border-rose-200 dark:border-rose-800">
            <IconKey size={18} stroke={1.5} />
          </div>
        );
      case "BUDGET_EXCEEDED":
        return (
          <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 border border-rose-200 dark:border-rose-800">
            <IconAlertCircle size={18} stroke={1.5} />
          </div>
        );
      case "SYSTEM_ALERT":
      default:
        return (
          <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 border border-purple-200 dark:border-purple-800">
            <IconShieldExclamation size={18} stroke={1.5} />
          </div>
        );
    }
  };

  const handleItemClick = (item: TenantNotificationItem) => {
    if (!item.isRead) {
      markAsRead(item.id);
    }
    if (item.actionUrl) {
      setIsOpen(false);
      router.push(item.actionUrl);
    }
  };

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* Botón de la Campana con Badge */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-600 dark:text-slate-300 hover:text-[#0078D4] dark:hover:text-[#0078D4] transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 focus:outline-none"
        aria-label={t("open")}
      >
        <IconBell size={20} stroke={1.5} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] bg-[#0078D4] text-white text-[10px] font-bold px-1 rounded-full shadow-sm">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Menú Desplegable (Dropdown Popover en z-[100]) */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-[100] animate-in fade-in zoom-in-95 duration-150">
          {/* Cabecera del Dropdown */}
          <div className="px-4 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-white font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                {t("title")}
              </h3>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-950/80 text-[#0078D4] px-1.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">
                  {t("newCount", { count: unreadCount })}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllAsRead()}
                className="text-[11px] font-semibold text-[#0078D4] hover:text-[#0060AA] flex items-center transition-colors hover:underline"
              >
                <IconChecklist size={14} className="inline mr-1 text-[#0078D4]" />
                {t("markRead")}
              </button>
            )}
          </div>

          {/* Pestañas de Filtro */}
          <div className="flex items-center px-3 py-2 border-b border-slate-100 dark:border-slate-800 gap-1 bg-white dark:bg-slate-900">
            {[
              { id: "ALL", label: t("tabAll") },
              { id: "REPORTS", label: t("tabReports") },
              { id: "ANOMALIES", label: t("tabAnomalies") },
              { id: "SECURITY", label: t("tabSecurity") },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilter(tab.id as FilterTab)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all ${
                  activeFilter === tab.id
                    ? "bg-blue-50 text-[#0078D4] dark:bg-blue-950/60 dark:text-blue-300 font-bold"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Lista de Notificaciones con scrollbar visible en macOS */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600">
            {isLoading && notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                {t("loading")}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                  <IconInbox size={20} stroke={1.5} />
                </div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t("empty")}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {t("emptyHint")}
                </p>
              </div>
            ) : (
              filteredNotifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className={`group relative p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${
                    item.isRead
                      ? "hover:bg-slate-50 dark:hover:bg-slate-800/40 opacity-80 hover:opacity-100"
                      : "bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/80 dark:hover:bg-blue-950/40"
                  }`}
                >
                  {/* Icono del tipo de evento */}
                  <div className="shrink-0 mt-0.5">{getEventIcon(item.type)}</div>

                  {/* Contenido descriptivo */}
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 truncate">
                        {textoDeNotificacion(item.titleKey, item.params, item.title, t)}
                      </p>
                      {!item.isRead && (
                        <span className="w-2 h-2 rounded-full bg-[#0078D4] shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                      {textoDeNotificacion(item.messageKey, item.params, item.message, t)}
                    </p>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 block">
                      {hace(item, format)}
                    </span>
                  </div>

                  {/* Botón de eliminar en hover */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotification(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-rose-500 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 absolute top-3 right-2"
                    title={t("delete")}
                  >
                    <IconTrash size={13} stroke={1.5} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Footer del Dropdown */}
          <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 text-center">
            <Link
              href="/admin/audit-trail"
              onClick={() => setIsOpen(false)}
              className="text-[11px] font-bold text-[#0078D4] hover:text-[#0060AA] inline-flex items-center gap-1 transition-colors"
            >
              <span>{t("viewAll")}</span>
              <IconArrowRight size={12} stroke={2} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
