import pool, { initializeDatabase } from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { ADDON_CATALOG, type AddonProduct } from "@/lib/addonCatalog";

export interface ActiveTenantAddon {
    id: number | string;
    tenantId: string;
    addonKey: string;
    addonType: "recurring" | "pass";
    quantity: number;
    status: "active" | "expired" | "cancelled";
    startsAt: string;
    expiresAt: string | null;
    name?: string;
    description?: string;
    category?: string;
}

// Estado en memoria para tenants Demo / Mocks
const demoAddonsState: Record<string, ActiveTenantAddon[]> = {};

export class TenantAddonsService {
    /**
     * Inicializa la tabla de TenantAddons si no existe.
     */
    static async ensureTableExists(): Promise<void> {
        await initializeDatabase();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS TenantAddons (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                addon_key VARCHAR(100) NOT NULL,
                addon_type ENUM('recurring', 'pass') NOT NULL DEFAULT 'pass',
                status ENUM('active', 'expired', 'cancelled') NOT NULL DEFAULT 'active',
                quantity INT NOT NULL DEFAULT 1,
                starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NULL,
                paddle_subscription_id VARCHAR(255) NULL,
                paddle_transaction_id VARCHAR(255) NULL,
                expiry_notified_at DATETIME NULL DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_tenant_status_expires (tenant_id, status, expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
    }

    /**
     * Obtiene todos los add-ons vigentes para un tenant.
     */
    static async getActiveAddons(tenantId: string): Promise<ActiveTenantAddon[]> {
        if (isMockTenant(tenantId)) {
            if (!demoAddonsState[tenantId]) {
                demoAddonsState[tenantId] = [
                    {
                        id: "demo-addon-1",
                        tenantId,
                        addonKey: "feature_simulator",
                        addonType: "pass",
                        quantity: 1,
                        status: "active",
                        startsAt: new Date(Date.now() - 15 * 86400000).toISOString(),
                        expiresAt: new Date(Date.now() + 75 * 86400000).toISOString(),
                        name: ADDON_CATALOG.feature_simulator?.name,
                        description: ADDON_CATALOG.feature_simulator?.description,
                        category: ADDON_CATALOG.feature_simulator?.category,
                    },
                ];
            }
            return demoAddonsState[tenantId].filter((a) => a.status === "active");
        }

        try {
            await this.ensureTableExists();
            const [rows]: any = await pool.query(
                `SELECT * FROM TenantAddons 
                 WHERE tenant_id = ? 
                   AND status = 'active' 
                   AND (expires_at IS NULL OR expires_at > NOW())
                 ORDER BY starts_at DESC`,
                [tenantId]
            );

            return (rows || []).map((r: any) => {
                const product = ADDON_CATALOG[r.addon_key];
                return {
                    id: r.id,
                    tenantId: r.tenant_id,
                    addonKey: r.addon_key,
                    addonType: r.addon_type,
                    quantity: Number(r.quantity || 1),
                    status: r.status,
                    startsAt: new Date(r.starts_at).toISOString(),
                    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
                    name: product?.name || r.addon_key,
                    description: product?.description,
                    category: product?.category,
                };
            });
        } catch (e) {
            console.warn("[TenantAddonsService] Error querying active addons:", e);
            return [];
        }
    }

    /**
     * Registra la adquisición de un add-on o pase temporal para el tenant.
     */
    static async purchaseAddon(
        tenantId: string,
        addonKey: string,
        addonType: "recurring" | "pass",
        months: number = 1,
        transactionId?: string
    ): Promise<ActiveTenantAddon> {
        const product = ADDON_CATALOG[addonKey];
        if (!product) {
            throw new Error(`Add-on no reconocido: ${addonKey}`);
        }

        const startsAt = new Date();
        const expiresAt = addonType === "pass" 
            ? new Date(startsAt.getTime() + months * 30 * 86400000) 
            : null;

        if (isMockTenant(tenantId)) {
            const newItem: ActiveTenantAddon = {
                id: `demo-addon-${Date.now()}`,
                tenantId,
                addonKey,
                addonType,
                quantity: product.extraQuantity || 1,
                status: "active",
                startsAt: startsAt.toISOString(),
                expiresAt: expiresAt ? expiresAt.toISOString() : null,
                name: product.name,
                description: product.description,
                category: product.category,
            };
            if (!demoAddonsState[tenantId]) demoAddonsState[tenantId] = [];
            demoAddonsState[tenantId].push(newItem);
            return newItem;
        }

        await this.ensureTableExists();

        // Un add-on RECURRENTE se cobra todos los meses, y cada cobro llega como
        // su propio `transaction.completed`. Sin esto, la renovacion nº12 dejaba
        // 12 filas activas del mismo modulo -- y para los add-ons de cuota
        // (`getExtraQuota` suma las filas) eso le habria regalado 12 slots al
        // que paga uno. El pase temporal si se apila a proposito: comprar otro
        // extiende el acceso.
        if (addonType === "recurring") {
            const [yaActivo]: any = await pool.query(
                `SELECT id FROM TenantAddons
                  WHERE tenant_id = ? AND addon_key = ? AND addon_type = 'recurring' AND status = 'active'
                  LIMIT 1`,
                [tenantId, addonKey]
            );
            if (Array.isArray(yaActivo) && yaActivo.length > 0) {
                await pool.query(
                    "UPDATE TenantAddons SET paddle_transaction_id = ?, expiry_notified_at = NULL WHERE id = ?",
                    [transactionId || null, yaActivo[0].id]
                );
                return {
                    id: yaActivo[0].id,
                    tenantId,
                    addonKey,
                    addonType,
                    quantity: product.extraQuantity || 1,
                    status: "active",
                    startsAt: startsAt.toISOString(),
                    expiresAt: null,
                    name: product.name,
                    description: product.description,
                    category: product.category,
                };
            }
        }

        const [result]: any = await pool.query(
            `INSERT INTO TenantAddons (tenant_id, addon_key, addon_type, status, quantity, starts_at, expires_at, paddle_transaction_id)
             VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
            [
                tenantId,
                addonKey,
                addonType,
                product.extraQuantity || 1,
                startsAt,
                expiresAt,
                transactionId || null,
            ]
        );

        return {
            id: result.insertId,
            tenantId,
            addonKey,
            addonType,
            quantity: product.extraQuantity || 1,
            status: "active",
            startsAt: startsAt.toISOString(),
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            name: product.name,
            description: product.description,
            category: product.category,
        };
    }

    /**
     * Verifica si el tenant tiene acceso a una feature por tier base O por add-on activo.
     */
    static async hasFeatureOrAddonAccess(
        tenantId: string,
        tier: string,
        featureKey: string,
        requiredTier: string
    ): Promise<boolean> {
        const { hasAccess } = await import("@/lib/tierLogic");
        if (hasAccess(tier, requiredTier)) return true;

        const active = await this.getActiveAddons(tenantId);
        return active.some((a) => a.addonKey === featureKey && a.status === "active");
    }

    /**
     * Calcula la cuota adicional contratada para un recurso (ej. suscripciones o asientos).
     */
    static async getExtraQuota(tenantId: string, quotaKey: string): Promise<number> {
        const active = await this.getActiveAddons(tenantId);
        return active
            .filter((a) => a.addonKey === quotaKey && a.status === "active")
            .reduce((sum, a) => sum + (a.quantity || 1), 0);
    }
}
