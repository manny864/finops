/**
 * Middleware y Motor de Enforcement de Límites por Tier y Cuotas de Suscripción (Transversal).
 *
 * Aplica las restricciones contractuales:
 *  - Professional: Hasta 2 suscripciones Azure. Módulos base.
 *  - Business: Hasta 3 suscripciones Azure. Módulos base + FOCUS 1.1 Export, CSP Markup, PowerBI Templates.
 *  - Enterprise: Suscripciones ilimitadas (sin tope duro). Plataforma completa 100% + Soporte 24/7.
 */

import { NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { normalizeTier } from "@/lib/tierLogic";
import { countStoredSubscriptions, getEffectiveSubscriptionLimit } from "@/lib/subscriptionQuota";
import type {
  SaaSPlanTier,
  RestrictedFeatureKey,
  TierLimitStatus,
  TierQuotaExceededError,
} from "@/types/tierLimits.types";

export class TierLimitException extends Error {
  public readonly errorPayload: TierQuotaExceededError;
  public readonly httpStatus: number;

  constructor(payload: TierQuotaExceededError, httpStatus = 402) {
    super(payload.message);
    this.name = "TierLimitException";
    this.errorPayload = payload;
    this.httpStatus = httpStatus;
  }
}

const TIER_FEATURES: Record<SaaSPlanTier, RestrictedFeatureKey[]> = {
  Professional: [],
  Business: [
    "FOCUS_EXPORT",
    "CSP_MARKUP",
    "POWERBI_TEMPLATES",
    "ZOMBIE_REMEDIATION",
    "TAG_REMEDIATION",
  ],
  Enterprise: [
    "CSP_MARKUP",
    "FOCUS_EXPORT",
    "POWERBI_TEMPLATES",
    "UNLIMITED_SUBS",
    "ZOMBIE_REMEDIATION",
    "TAG_REMEDIATION",
    "ADVANCED_AI",
    "PRIORITY_SUPPORT",
  ],
};

export function getFeaturesForTier(tier: SaaSPlanTier): RestrictedFeatureKey[] {
  return TIER_FEATURES[tier] || [];
}

export function isFeatureIncludedInTier(
  tier: SaaSPlanTier,
  feature: RestrictedFeatureKey
): boolean {
  const allowed = TIER_FEATURES[tier] || [];
  return allowed.includes(feature);
}

export function getNextUpgradeTier(currentTier: SaaSPlanTier): SaaSPlanTier {
  if (currentTier === "Professional") return "Business";
  return "Enterprise";
}

/**
 * Obtiene el estado consolidado de límites por tier y uso de cuota de suscripciones para un tenant.
 */
export async function getTenantTierLimitStatus(
  tenantId: string
): Promise<TierLimitStatus> {
  const isMock = isMockTenant(tenantId);

  if (isMock) {
    return {
      tenantId,
      planTier: "Enterprise",
      maxAllowedSubscriptions: 9999,
      currentSubscriptionsCount: 1,
      isSubscriptionLimitReached: false,
      canAddMoreSubscriptions: true,
      allowedFeatures: TIER_FEATURES.Enterprise,
      subscriptionQuotaPercentage: 0,
      upgradeTargetTier: undefined,
      upgradeUrl: "/admin/billing",
    };
  }

  let planTier: SaaSPlanTier = "Professional";
  let currentSubscriptionsCount = 0;

  try {
    await initializeDatabase();

    // 1. Obtener el Tier del Tenant (con herencia de contrato si tiene parent_tenant_id)
    try {
      const [tenantRows]: any = await pool.query(
        `SELECT COALESCE(t.tier, p.tier, 'Professional') as tier,
                COALESCE(t.subscription_status, p.subscription_status, 'ACTIVE') as subscription_status
         FROM Tenants t
         LEFT JOIN Tenants p ON t.parent_tenant_id = p.tenant_id
         WHERE t.tenant_id = ?
         LIMIT 1`,
        [tenantId]
      );
      if (Array.isArray(tenantRows) && tenantRows.length > 0 && tenantRows[0]?.tier) {
        const normalized = normalizeTier(tenantRows[0].tier);
        if (normalized === "Enterprise" || normalized === "Business" || normalized === "Professional") {
          planTier = normalized;
        }
      }
    } catch {
      try {
        const [simpleRows]: any = await pool.query(
          `SELECT tier, subscription_status FROM Tenants WHERE tenant_id = ? LIMIT 1`,
          [tenantId]
        );
        if (Array.isArray(simpleRows) && simpleRows.length > 0 && simpleRows[0]?.tier) {
          const normalized = normalizeTier(simpleRows[0].tier);
          if (normalized === "Enterprise" || normalized === "Business" || normalized === "Professional") {
            planTier = normalized;
          }
        }
      } catch { /* noop */ }
    }

    // 2. Conteo de suscripciones de Azure.
    //
    // Antes contaba `TenantSubscriptions`, que es el registro de FACTURACIÓN y
    // no tiene columna `subscription_id`: la consulta tiraba "Unknown column",
    // los dos catch se lo tragaban y el contador quedaba en 0 para todos los
    // tenants. `countStoredSubscriptions` usa la misma fuente que el truncado
    // de `azure.ts`, así que el medidor y el límite real coinciden.
    currentSubscriptionsCount = await countStoredSubscriptions(tenantId);
  } catch (err: any) {
    console.warn(`[tierLimitsGuard] Error resolviendo tier para tenant ${tenantId}:`, err?.message);
  }

  // Tope efectivo: incluye los slots comprados, no sólo el del plan.
  const rawMax = await getEffectiveSubscriptionLimit(tenantId, planTier);
  const maxAllowedSubscriptions = Number.isFinite(rawMax) ? rawMax : 9999;
  const isSubscriptionLimitReached = currentSubscriptionsCount >= maxAllowedSubscriptions;
  const canAddMoreSubscriptions = currentSubscriptionsCount < maxAllowedSubscriptions;
  const allowedFeatures = getFeaturesForTier(planTier);
  const subscriptionQuotaPercentage =
    maxAllowedSubscriptions >= 9999
      ? 0
      : Math.min(100, Math.round((currentSubscriptionsCount / maxAllowedSubscriptions) * 100));

  const upgradeTargetTier = isSubscriptionLimitReached
    ? getNextUpgradeTier(planTier)
    : undefined;

  return {
    tenantId,
    planTier,
    maxAllowedSubscriptions,
    currentSubscriptionsCount,
    isSubscriptionLimitReached,
    canAddMoreSubscriptions,
    allowedFeatures,
    subscriptionQuotaPercentage,
    upgradeTargetTier,
    upgradeUrl: "/admin/billing",
  };
}

/**
 * Interceptor de backend para validación de cuota de suscripciones.
 * Si el tenant intenta vincular una suscripción superando el límite del plan (ej. 3ra en Pro o 4ta en Business),
 * lanza una excepción estructurada `TierLimitException` (HTTP 402).
 */
export async function assertTenantSubscriptionQuota(tenantId: string): Promise<void> {
  if (isMockTenant(tenantId)) return;

  const status = await getTenantTierLimitStatus(tenantId);

  if (status.isSubscriptionLimitReached) {
    const targetTier = getNextUpgradeTier(status.planTier);
    const errorPayload: TierQuotaExceededError = {
      errorCode: "TIER_SUBSCRIPTION_LIMIT_REACHED",
      currentTier: status.planTier,
      message: `Has alcanzado el límite máximo de ${status.maxAllowedSubscriptions} suscripción(es) permitidas en el plan ${status.planTier}. Para vincular suscripciones adicionales, actualiza al plan ${targetTier}.`,
      maxAllowed: status.maxAllowedSubscriptions,
      currentCount: status.currentSubscriptionsCount,
      upgradeTargetTier: targetTier,
      upgradeUrl: "/admin/billing",
    };

    throw new TierLimitException(errorPayload, 402);
  }
}

/**
 * Interceptor de backend para validación de acceso a features restringidas por tier.
 * Si el tenant no tiene la feature habilitada en su plan, lanza `TierLimitException` (HTTP 403 / 402).
 */
export async function assertFeatureAccess(
  tenantId: string,
  featureKey: RestrictedFeatureKey
): Promise<void> {
  if (isMockTenant(tenantId)) return;

  const status = await getTenantTierLimitStatus(tenantId);

  if (!isFeatureIncludedInTier(status.planTier, featureKey)) {
    const targetTier = getNextUpgradeTier(status.planTier);
    const errorPayload: TierQuotaExceededError = {
      errorCode: "FEATURE_NOT_INCLUDED_IN_TIER",
      currentTier: status.planTier,
      message: `La funcionalidad solicitada (${featureKey}) requiere el plan ${targetTier} o superior. Tu plan actual es ${status.planTier}.`,
      requiredFeature: featureKey,
      upgradeTargetTier: targetTier,
      upgradeUrl: "/admin/billing",
    };

    throw new TierLimitException(errorPayload, 403);
  }
}

/**
 * Helper para formatear la respuesta JSON de error de límite o cuota.
 */
export function createTierLimitResponse(
  error: TierQuotaExceededError,
  httpStatus = 402
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: error.message,
      errorCode: error.errorCode,
      currentTier: error.currentTier,
      maxAllowed: error.maxAllowed,
      currentCount: error.currentCount,
      requiredFeature: error.requiredFeature,
      upgradeTargetTier: error.upgradeTargetTier,
      upgradeUrl: error.upgradeUrl || "/admin/billing",
    },
    { status: httpStatus }
  );
}
