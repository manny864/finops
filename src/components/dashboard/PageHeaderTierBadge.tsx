"use client";
import { useTranslations } from 'next-intl';
import React from 'react';
import { usePathname } from 'next/navigation';
import { getRequiredTierForPath } from '@/lib/routeTiers';
import { TrendingUp, Briefcase, Crown } from 'lucide-react';

export type TierLevel = 'Professional' | 'Business' | 'Enterprise';

const TIER_CONFIG: Record<TierLevel, {
  label: string;
  bg: string;
  text: string;
  border: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  Professional: {
    label: 'Professional',
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    text: 'text-sky-700 dark:text-sky-400',
    border: 'border-sky-200 dark:border-sky-800/60',
    icon: TrendingUp,
  },
  Business: {
    label: 'Business',
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    text: 'text-violet-700 dark:text-violet-400',
    border: 'border-violet-200 dark:border-violet-800/60',
    icon: Briefcase,
  },
  Enterprise: {
    label: 'Enterprise',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800/60',
    icon: Crown,
  },
};

interface PageHeaderTierBadgeProps {
  /**
   * Tier explícito. Si se omite, se calcula automáticamente
   * usando la ruta actual (usePathname) y `ROUTE_TIERS`.
   */
  tier?: TierLevel | string | null;
  /**
   * Clases adicionales para ajustar margen o posición.
   */
  className?: string;
}

/**
 * Badge de Tier para Header de Página.
 * Se muestra junto al subtítulo/descripción de la página para indicar
 * el nivel mínimo necesario de suscripción (Professional, Business, Enterprise).
 */
export default function PageHeaderTierBadge({ tier, className = '' }: PageHeaderTierBadgeProps) {
  const t = useTranslations('Dashboard');
  const pathname = usePathname() || '/';

  // Si no nos pasan un tier explícito, lo inferimos de la ruta (default a 'Professional' si no hay regla específica)
  const resolvedTierRaw = tier || getRequiredTierForPath(pathname) || 'Professional';

  // Normalizar capitalización (ej: "professional" -> "Professional")
  const formattedKey = (
    resolvedTierRaw.charAt(0).toUpperCase() + resolvedTierRaw.slice(1).toLowerCase()
  ) as TierLevel;

  const config = TIER_CONFIG[formattedKey] || TIER_CONFIG.Professional;
  const IconComponent = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${config.bg} ${config.text} ${config.border} ml-2 align-middle transition-colors shadow-xs ${className}`}
      title={t("tierEnabledFrom", { plan: config.label })}
    >
      <IconComponent className="w-3 h-3 shrink-0" />
      <span>{config.label}</span>
    </span>
  );
}
