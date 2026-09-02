"use client";

import React, { useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useLocale, useTranslations } from "next-intl";
import { X, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import type { SystemAnnouncement } from "@/types/systemAnnouncements.types";

export default function GlobalAnnouncementPopup() {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const locale = useLocale();
  const t = useTranslations("Announcements");
  const [queue, setQueue] = useState<SystemAnnouncement[]>([]);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    const tenantId = selectedTenant?.id;
    if (!tenantId || tenantId === "default") return;

    let cancelled = false;
    const load = async () => {
      try {
        // El locale va al server: la resolución del idioma (con fallback al
        // base) vive en el servicio, no duplicada acá.
        const url = `/api/announcements/active?tenantId=${encodeURIComponent(tenantId)}&locale=${encodeURIComponent(locale)}`;
        const res = isMockTenant(tenantId)
          ? await fetch(url)
          : await fetchWithAuthRetry(instance, accounts[0], url, {});
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.success) {
          // Sólo popup, y sólo lo que este usuario no descartó ya (el server
          // ya filtra por dismissedByUser, pero se repite acá por claridad y
          // por si algún día active/ deja de filtrar).
          const pending = (json.announcements || []).filter(
            (a: SystemAnnouncement) => a.channels.includes("popup") && !a.dismissedByUser
          );
          setQueue(pending);
        }
      } catch {
        // Best-effort.
      }
    };
    // Mismo pequeño retardo que TelemetryDelayModal: no competir con la
    // animación de carga inicial del shell.
    const timer = setTimeout(load, 1200);
    return () => { cancelled = true; clearTimeout(timer); };
    // `locale` en las deps: cambiar el idioma vuelve a pedir el contenido.
  }, [selectedTenant?.id, instance, accounts, locale]);

  const current = queue[0];
  if (!current) return null;

  const handleClose = async () => {
    setDismissing(true);
    try {
      const tenantId = selectedTenant!.id;
      const url = `/api/announcements/dismiss?tenantId=${encodeURIComponent(tenantId)}`;
      const opts = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announcementId: current.id }),
      };
      if (isMockTenant(tenantId)) await fetch(url, opts);
      else await fetchWithAuthRetry(instance, accounts[0], url, opts);
    } catch {
      // Si el registro de descarte falla, el popup volvería a aparecer la
      // próxima carga -- molesto, pero no bloquea al usuario ahora.
    } finally {
      setDismissing(false);
      setQueue((prev) => prev.slice(1));
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full border border-gray-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-5 bg-slate-50 dark:bg-slate-800/70 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
          {/* `resolved*` viene ya en el idioma activo desde el servicio. */}
          <h3 className="font-bold text-base text-[#1B2A41] dark:text-white font-heading">{current.resolvedTitle ?? current.title}</h3>
          <button
            onClick={handleClose}
            disabled={dismissing}
            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 text-slate-600 hover:border-slate-500 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 transition-all disabled:opacity-50"
            aria-label={t("close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 text-xs leading-relaxed text-slate-600 dark:text-slate-300 markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.resolvedMessage ?? current.message}</ReactMarkdown>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between gap-3">
          {current.actionUrl && (
            <a
              href={current.actionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-[#0054A6] dark:text-blue-300 hover:underline"
            >
              {t("moreInfo")}
            </a>
          )}
          <button
            onClick={handleClose}
            disabled={dismissing}
            className="ml-auto flex items-center gap-1.5 px-5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/30 text-xs font-bold transition-all disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>{t("understood")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
