"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { IconShieldLock, IconLogout, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import type { ImpersonationSessionData } from "@/types/sessionImpersonation.types";

export function ImpersonationBanner() {
  const t = useTranslations("SuperAdminImpersonation");
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<ImpersonationSessionData | null>(null);
  const [isStopping, setIsStopping] = useState<boolean>(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/superadmin/impersonate/status");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.isImpersonating && data.session) {
          setSession(data.session);
        } else {
          setSession(null);
        }
      }
    } catch {
      // Ignorar errores silenciosos
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus, pathname]);

  const handleStopImpersonation = async () => {
    try {
      setIsStopping(true);
      const res = await fetch("/api/superadmin/impersonate/stop", {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("No se pudo finalizar la impersonación");
      }

      const data = await res.json();
      toast.success(data.message || "Sesión de impersonación finalizada. Has regresado al panel de SuperAdmin.");
      setSession(null);

      // Redirección inmediata al panel de tenants de SuperAdmin
      router.push("/superadmin/tenants");
      setTimeout(() => {
        window.location.href = "/superadmin/tenants";
      }, 300);
    } catch (err: any) {
      toast.error(err?.message || "Error al salir de la sesión de impersonación");
    } finally {
      setIsStopping(false);
    }
  };

  if (!session || !session.isImpersonating) {
    return null;
  }

  return (
    <div
      className="relative z-[90] w-full shrink-0 bg-slate-900 text-white border-b border-[#0078D4] px-4 py-2 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-md animate-in slide-in-from-top duration-200"
      role="banner"
      aria-label={t("regionLabel")}
    >
      {/* Lado Izquierdo: Información y Tenant */}
      <div className="flex items-center gap-2 min-w-0">
        <IconShieldLock size={18} className="text-[#0078D4] shrink-0 animate-pulse" />
        <p className="truncate leading-tight">
          <strong className="text-white font-bold mr-1.5">{t("activeMode")}</strong>
          <span className="text-slate-300">
            {t.rich("browsingAs", {
              tenant: () => <span className="text-blue-400 font-semibold">{session.targetTenantName}</span>,
              id: () => <span className="text-slate-400 font-mono text-[11px]">({session.targetTenantId})</span>,
            })}
          </span>
        </p>
      </div>

      {/* Lado Derecho: Botón de Salir */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleStopImpersonation}
          disabled={isStopping}
          className="inline-flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#0060AA] text-white px-3 py-1 rounded-md font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
        >
          {isStopping ? (
            <IconLoader2 size={14} className="animate-spin text-white" />
          ) : (
            <IconLogout size={14} className="text-white" />
          )}
          <span>{isStopping ? t("exiting") : t("exit")}</span>
        </button>
      </div>
    </div>
  );
}
