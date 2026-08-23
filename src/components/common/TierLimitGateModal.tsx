"use client";

import React from "react";
import Link from "next/link";
import {
  IconCrown,
  IconSparkles,
  IconShieldLock,
  IconArrowRight,
  IconX,
  IconCheck,
  IconLayersLinked,
  IconBuildingStore,
  IconFileExport,
} from "@tabler/icons-react";
import type { SaaSPlanTier, UpgradeModalConfig } from "@/types/tierLimits.types";

export interface TierLimitGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTier: SaaSPlanTier;
  maxAllowedSubscriptions?: number;
  currentSubscriptionsCount?: number;
  config?: UpgradeModalConfig | null;
}

export const TierLimitGateModal: React.FC<TierLimitGateModalProps> = ({
  isOpen,
  onClose,
  currentTier,
  maxAllowedSubscriptions = 2,
  currentSubscriptionsCount = 2,
  config,
}) => {
  if (!isOpen) return null;

  const targetTier: SaaSPlanTier = config?.targetTier || (currentTier === "Professional" ? "Business" : "Enterprise");
  const isQuotaReason = config?.reason !== "RESTRICTED_FEATURE";
  const upgradeUrl = config?.upgradeUrl || "/admin/billing";

  const targetTierBenefits: Record<SaaSPlanTier, { subLimitText: string; features: string[] }> = {
    Professional: {
      subLimitText: "Hasta 2 Suscripciones Azure",
      features: ["Dashboard Ejecutivo", "Limpieza de Zombies básica", "Gobernanza de Tags"],
    },
    Business: {
      subLimitText: "Hasta 3 Suscripciones Azure",
      features: [
        "Exportaciones FOCUS 1.1 (CSV/Parquet)",
        "Facturación CSP/MSP con Markup de reventa",
        "Plantillas Power BI y Webhooks Teams/Slack",
        "Remediación automática de Tags y Zombies",
      ],
    },
    Enterprise: {
      subLimitText: "Suscripciones Azure ILIMITADAS",
      features: [
        "Capacidad de suscripciones sin límite duro",
        "Plataforma completa 100% sin restricciones",
        "Soporte prioritario 24/7 con SLA de 4 horas",
        "Modelos de IA dedicados y acuerdos a medida",
      ],
    },
  };

  const currentBenefits = targetTierBenefits[currentTier];
  const nextBenefits = targetTierBenefits[targetTier];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 text-left relative overflow-hidden transition-all transform"
        role="dialog"
        aria-modal="true"
      >
        {/* Decoración de fondo sutil */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-500/10 dark:bg-blue-500/20 rounded-full blur-2xl pointer-events-none" />

        {/* Botón de Cierre */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Cerrar modal"
        >
          <IconX size={18} />
        </button>

        {/* Cabecera con Icono y Badge */}
        <div className="flex items-start gap-3.5 mb-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-xl text-[#0078D4] shrink-0">
            {isQuotaReason ? <IconLayersLinked size={24} /> : <IconShieldLock size={24} />}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                Plan Actual: {currentTier}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-[#0078D4] border border-blue-200 dark:border-blue-800 flex items-center gap-1">
                <IconCrown size={11} /> Upgrade a {targetTier}
              </span>
            </div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-white leading-snug">
              {config?.title ||
                (isQuotaReason
                  ? `Límite de ${maxAllowedSubscriptions} Suscripciones Alcanzado`
                  : `Funcionalidad Disponible en Plan ${targetTier}`)}
            </h2>
          </div>
        </div>

        {/* Descripción Principal */}
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-5">
          {config?.description ||
            (isQuotaReason
              ? `Tu organización tiene actualmente ${currentSubscriptionsCount} de ${maxAllowedSubscriptions} suscripciones vinculadas en el plan ${currentTier}. Para conectar más suscripciones Azure a la plataforma y habilitar análisis consolidado, mejora tu suscripción al plan ${targetTier}.`
              : `Esta capacidad avanzada está reservada para organizaciones con plan ${targetTier} o superior. Actualiza tu suscripción para desbloquearla de inmediato.`)}
        </p>

        {/* Tarjeta Comparativa / Desglose de Beneficios del Plan Superior */}
        <div className="bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-200 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Capacidad de Suscripciones
            </span>
            <div className="text-xs font-bold text-[#0078D4] flex items-center gap-1">
              <span>{nextBenefits.subLimitText}</span>
            </div>
          </div>

          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-2">
            Beneficios incluidos al actualizar a {targetTier}:
          </span>
          <ul className="space-y-1.5">
            {nextBenefits.features.map((benefit, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                <IconCheck size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Botones de Acción */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            Cerrar
          </button>
          <Link
            href={upgradeUrl}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#0060AA] text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all hover:scale-[1.02]"
          >
            <IconSparkles size={14} className="text-white" />
            <span>Ver Planes y Mejorar Suscripción</span>
            <IconArrowRight size={14} className="text-white" />
          </Link>
        </div>
      </div>
    </div>
  );
};
