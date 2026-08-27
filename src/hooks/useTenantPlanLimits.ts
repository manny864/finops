"use client";

import { useState, useEffect, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import type {
  SaaSPlanTier,
  RestrictedFeatureKey,
  TierLimitStatus,
  UpgradeModalConfig,
} from "@/types/tierLimits.types";

export interface UseTenantPlanLimitsResult {
  limits: TierLimitStatus | null;
  planTier: SaaSPlanTier;
  maxAllowedSubscriptions: number;
  currentActiveSubscriptions: number;
  isAtLimit: boolean;
  canAddMoreSubscriptions: boolean;
  subscriptionQuotaPercentage: number;
  allowedFeatures: RestrictedFeatureKey[];
  hasFeatureAccess: (feature: RestrictedFeatureKey) => boolean;
  isUpgradeModalOpen: boolean;
  upgradeModalConfig: UpgradeModalConfig | null;
  openUpgradeModal: (config?: UpgradeModalConfig) => void;
  closeUpgradeModal: () => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTenantPlanLimits(
  tenantId: string | null | undefined,
  fallbackTier?: SaaSPlanTier
): UseTenantPlanLimitsResult {
  const [limits, setLimits] = useState<TierLimitStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState<boolean>(false);
  const [upgradeModalConfig, setUpgradeModalConfig] = useState<UpgradeModalConfig | null>(null);

  const { instance, accounts } = useMsal();
  const isMock = isMockTenant(tenantId || "");

  const fetchLimits = useCallback(async () => {
    if (!tenantId || tenantId === "default") {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      let headers: Record<string, string> = {};
      if (!isMock && accounts.length > 0) {
        try {
          const token = await getFreshIdToken(instance, accounts[0]);
          if (token) {
            headers = { Authorization: `Bearer ${token}` };
          }
        } catch (tokErr) {
          console.warn("[useTenantPlanLimits] Warning fetching MSAL token:", tokErr);
        }
      }

      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/tier-limits`, {
        headers,
      });

      if (!res.ok) {
        throw new Error(`Error ${res.status}: no se pudieron obtener los límites del plan`);
      }
      const data = await res.json();
      if (data.success) {
        setLimits(data);
      } else {
        throw new Error(data.error || "Fallo en la respuesta de límites");
      }
    } catch (err: any) {
      setError(err?.message || "Error al consultar límites del plan");
      if (isMock || tenantId?.startsWith("demo-") || tenantId?.startsWith("mock-")) {
        setLimits({
          tenantId,
          planTier: "Enterprise",
          maxAllowedSubscriptions: 9999,
          currentSubscriptionsCount: 1,
          isSubscriptionLimitReached: false,
          canAddMoreSubscriptions: true,
          allowedFeatures: [
            "CSP_MARKUP",
            "FOCUS_EXPORT",
            "POWERBI_TEMPLATES",
            "UNLIMITED_SUBS",
            "ZOMBIE_REMEDIATION",
            "TAG_REMEDIATION",
            "ADVANCED_AI",
            "PRIORITY_SUPPORT",
          ],
          subscriptionQuotaPercentage: 0,
          upgradeUrl: "/admin/billing",
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, isMock, accounts, instance]);

  useEffect(() => {
    fetchLimits();
  }, [fetchLimits]);

  const planTier: SaaSPlanTier = limits?.planTier || fallbackTier || "Professional";
  const maxAllowedSubscriptions: number = limits?.maxAllowedSubscriptions ?? (planTier === "Enterprise" ? 9999 : planTier === "Business" ? 3 : 2);
  const currentActiveSubscriptions: number = limits?.currentSubscriptionsCount ?? 0;
  const isAtLimit: boolean = limits?.isSubscriptionLimitReached ?? (currentActiveSubscriptions >= maxAllowedSubscriptions);
  const canAddMoreSubscriptions: boolean = limits?.canAddMoreSubscriptions ?? (currentActiveSubscriptions < maxAllowedSubscriptions);
  const subscriptionQuotaPercentage: number = limits?.subscriptionQuotaPercentage ?? 0;
  const allowedFeatures: RestrictedFeatureKey[] = limits?.allowedFeatures ?? [];

  const hasFeatureAccess = useCallback(
    (feature: RestrictedFeatureKey): boolean => {
      if (planTier === "Enterprise") return true;
      return allowedFeatures.includes(feature);
    },
    [planTier, allowedFeatures]
  );

  const openUpgradeModal = useCallback(
    (config?: UpgradeModalConfig) => {
      const targetTier: SaaSPlanTier = planTier === "Professional" ? "Business" : "Enterprise";
      const defaultConfig: UpgradeModalConfig = {
        title: config?.title || "Límite de Suscripciones Alcanzado",
        description:
          config?.description ||
          `Has alcanzado el límite de ${maxAllowedSubscriptions} suscripciones en tu plan ${planTier}. Actualiza a ${targetTier} para desbloquear más capacidad.`,
        reason: config?.reason || "SUBSCRIPTION_QUOTA",
        featureKey: config?.featureKey,
        targetTier: config?.targetTier || targetTier,
        upgradeUrl: config?.upgradeUrl || "/admin/billing",
      };
      setUpgradeModalConfig(defaultConfig);
      setIsUpgradeModalOpen(true);
    },
    [planTier, maxAllowedSubscriptions]
  );

  const closeUpgradeModal = useCallback(() => {
    setIsUpgradeModalOpen(false);
  }, []);

  return {
    limits,
    planTier,
    maxAllowedSubscriptions,
    currentActiveSubscriptions,
    isAtLimit,
    canAddMoreSubscriptions,
    subscriptionQuotaPercentage,
    allowedFeatures,
    hasFeatureAccess,
    isUpgradeModalOpen,
    upgradeModalConfig,
    openUpgradeModal,
    closeUpgradeModal,
    isLoading,
    error,
    refetch: fetchLimits,
  };
}
