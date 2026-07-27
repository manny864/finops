import { normalizeTier } from "@/lib/tierLogic";

/**
 * Politica de proveedor por tenant.
 *
 * El producto es Azure-only: no hay mas "both" ni segundo proveedor que
 * archivar/purgar. Este modulo queda reducido al tipo y a un par de helpers
 * que los llamadores todavia usan para no tener que tipar "azure" a mano en
 * cada sitio.
 *
 * RBAC: no aplica, no hay I/O.
 */

export type CloudProviderId = "azure";
export type TenantProviderSetting = CloudProviderId;

export function isCloudProviderId(value: unknown): value is CloudProviderId {
    return value === "azure";
}

export function normalizeProviderSetting(_value: unknown): TenantProviderSetting {
    return "azure";
}

/** Tier normalizado o 'Essential' — helper para logs/persistencia. */
export function safeTier(tier: string | null | undefined): string {
    return normalizeTier(tier || "") || "Essential";
}
