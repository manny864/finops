"use client";

import React, { useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useLocale, useTranslations } from "next-intl";
import { X, AlertTriangle, Wrench, Info, ShieldAlert } from "lucide-react";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import type { SystemAnnouncement } from "@/types/systemAnnouncements.types";

/** Severidad -> icono + clases. Mismo criterio de color que el resto de la
 *  plataforma (crítico=rojo, warning/maintenance=ámbar, info=azul). */
const SEVERITY_STYLE: Record<SystemAnnouncement["severity"], { icon: React.ElementType; className: string }> = {
  info: { icon: Info, className: "bg-[#0E1A2B] border-[#0078D4]" },
  maintenance: { icon: Wrench, className: "bg-amber-900 border-amber-500" },
  warning: { icon: AlertTriangle, className: "bg-amber-900 border-amber-500" },
  critical: { icon: ShieldAlert, className: "bg-rose-900 border-rose-500" },
};

/** El colapso es POR SESIÓN (sessionStorage), no persistido en DB: el banner
 *  vuelve a aparecer la próxima sesión mientras siga vigente. Sólo el popup
 *  tiene "no volver a mostrar" permanente (ver GlobalAnnouncementPopup) --
 *  eso es lo que pide el criterio de aceptación, un banner no descartable
 *  para siempre sería fácil de perder de vista en un mantenimiento real.
 */
function collapsedKey(id: number) {
  return `finops:announcement_banner_collapsed:${id}`;
}

export default function GlobalAnnouncementBanner() {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const locale = useLocale();
  const t = useTranslations("Announcements");
  const [announcements, setAnnouncements] = useState<SystemAnnouncement[]>([]);
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());

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
          setAnnouncements((json.announcements || []).filter((a: SystemAnnouncement) => a.channels.includes("banner")));
        }
      } catch {
        // Best-effort: un anuncio que no carga no debe romper el resto del shell.
      }
    };
    load();
    return () => { cancelled = true; };
    // `locale` en las deps: si el usuario cambia el idioma con el selector, el
    // anuncio se vuelve a pedir y aparece traducido sin recargar la página.
  }, [selectedTenant?.id, instance, accounts, locale]);

  const visible = announcements.filter((a) => {
    if (collapsedIds.has(a.id)) return false;
    try {
      return sessionStorage.getItem(collapsedKey(a.id)) !== "1";
    } catch {
      return true;
    }
  });

  if (visible.length === 0) return null;

  const handleCollapse = (id: number) => {
    try { sessionStorage.setItem(collapsedKey(id), "1"); } catch {}
    setCollapsedIds((prev) => new Set(prev).add(id));
  };

  return (
    <div role="region" aria-label={t("regionLabel")}>
      {visible.map((a) => {
        const { icon: Icon, className } = SEVERITY_STYLE[a.severity];
        return (
          <div
            key={a.id}
            className={`relative z-[85] w-full shrink-0 text-white border-b px-4 py-2 text-xs flex items-center justify-between gap-2 shadow-md animate-in slide-in-from-top duration-200 ${className}`}
            role="banner"
          >
            <div className="flex items-center gap-2 min-w-0">
              {/* !text-white: globals.css fuerza .lucide a color de marca con
                  !important salvo que se lo gane con este prefijo (no con
                  text-white suelto ni con la sintaxis nueva text-white!). */}
              <Icon className="w-4 h-4 shrink-0 !text-white" />
              <p className="truncate leading-tight">
                {/* `resolved*` viene ya en el idioma activo (con fallback al
                    base) desde el servicio; `title`/`message` es el original. */}
                <strong className="font-bold mr-1.5">{a.resolvedTitle ?? a.title}</strong>
                <span className="text-white/85">{a.resolvedMessage ?? a.message}</span>
                {a.actionUrl && (
                  <a href={a.actionUrl} target="_blank" rel="noopener noreferrer" className="ml-2 underline font-semibold whitespace-nowrap">
                    {t("moreInfo")}
                  </a>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleCollapse(a.id)}
              className="p-1 opacity-70 hover:opacity-100 transition-opacity shrink-0"
              aria-label={t("dismiss")}
            >
              <X className="w-4 h-4 !text-white" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
