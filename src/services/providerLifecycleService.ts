import pool from "@/modules/storage/db";
import { normalizeProviderSetting, safeTier, type CloudProviderId, type TenantProviderSetting } from "@/lib/providerPolicy";

/**
 * Estado de proveedor de un tenant. El producto es Azure-only: ya no existe
 * "both" ni un segundo proveedor que archivar/purgar tras un downgrade, así
 * que este módulo quedó reducido a un shim de compatibilidad para los
 * callers que todavía preguntan "¿qué proveedor tiene este tenant?" (los
 * webhooks de Paddle/Azure Marketplace en cada cambio de tier, y el guard de
 * ingesta de `POST /api/tenants`).
 *
 * RBAC: este modulo NO valida identidad; lo llaman rutas que ya corrieron su
 * guard de `requestAuth`.
 */

export interface TenantProviderState {
    tenantId: string;
    tier: string;
    provider: TenantProviderSetting;
    archivedProvider: null;
    purgeAt: null;
}

export async function getTenantProviderState(
    tenantId: string
): Promise<TenantProviderState | null> {
    const [rows] = await pool.query(
        `SELECT tenant_id, tier, provider FROM Tenants WHERE tenant_id = ? LIMIT 1`,
        [tenantId]
    );
    const row = (rows as any[])[0];
    if (!row) return null;

    return {
        tenantId: row.tenant_id,
        tier: safeTier(row.tier),
        provider: normalizeProviderSetting(row.provider),
        archivedProvider: null,
        purgeAt: null,
    };
}

export interface TierChangeResult {
    action: "none";
}

/**
 * Antes reconciliaba el modelo multi-proveedor en cada cambio de tier
 * (Paddle, Azure Marketplace, PATCH de superadmin). Sin un segundo proveedor
 * no hay nada que archivar ni restaurar: queda como no-op para no tener que
 * tocar los 3 callers que la invocan tras cada `UPDATE Tenants.tier`.
 */
export async function applyTierChange(_params: {
    tenantId: string;
    previousTier: string;
    nextTier: string;
    actor?: string | null;
}): Promise<TierChangeResult> {
    return { action: "none" };
}

/**
 * Error de negocio: el tenant no puede ingerir datos de este proveedor.
 * Ya no se lanza en la práctica (un solo proveedor, siempre habilitado), pero
 * se mantiene exportada porque `POST /api/tenants` la captura por `instanceof`.
 */
export class ProviderDisabledError extends Error {
    readonly status = 409;
    constructor(
        message: string,
        readonly provider: CloudProviderId,
        readonly purgeAt: Date | null
    ) {
        super(message);
        this.name = "ProviderDisabledError";
    }
}

/**
 * Guard de ingesta por proveedor. Con un solo proveedor siempre disponible,
 * es un no-op — se mantiene como punto de choque único por si el modelo de
 * proveedores vuelve a crecer.
 */
export async function assertProviderIngestable(
    _tenantId: string,
    _provider: CloudProviderId
): Promise<void> {
    return;
}
