/**
 * Servicio de backend para Gobernanza y Gestión Global de Tenants (SuperAdmin).
 */

import pool from "@/modules/storage/db";
import {
    SuperAdminTenantItem,
    CreateManualTenantPayload,
    UpdateCommercialDealPayload,
    UpdateTenantTierPayload,
    GeneratePaddleLinkPayload,
    GeneratePaddleLinkResponse,
    SaaSPlanTier,
    TenantSubscriptionStatus,
} from "@/types/superAdminTenants.types";

const MOCK_SUPERADMIN_TENANTS: SuperAdminTenantItem[] = [
    {
        tenantId: "tenant-acme-prod",
        entraTenantId: "01234567-89ab-cdef-0123-456789abcdef",
        organizationName: "ACME Corporation",
        subscriptionStatus: "ACTIVE",
        planTier: "Enterprise",
        salesRepName: "Juan Manuel Chavez",
        salesCommissionPercent: 15.0,
        paddlePriceId: "pri_01h8acme_ent",
        isManualBypass: true,
        createdAtIso: "2026-01-15T10:00:00.000Z",
    },
    {
        tenantId: "tenant-globex-latam",
        entraTenantId: "11223344-5566-7788-99aa-bbccddeeff00",
        organizationName: "Globex Corporation LATAM",
        subscriptionStatus: "ACTIVE",
        planTier: "Enterprise",
        salesRepName: "Carlos Rodriguez",
        salesCommissionPercent: 12.5,
        paddlePriceId: "pri_01h8globex_ent",
        isManualBypass: true,
        createdAtIso: "2026-02-01T14:30:00.000Z",
    },
    {
        tenantId: "tenant-initech-sec",
        entraTenantId: "22334455-6677-8899-aabb-ccddeeff0011",
        organizationName: "Initech Financial Services",
        subscriptionStatus: "ACTIVE",
        planTier: "Business",
        salesRepName: "Mariana Lopez",
        salesCommissionPercent: 10.0,
        paddlePriceId: "pri_01h8initech_bus",
        isManualBypass: false,
        createdAtIso: "2026-03-10T09:15:00.000Z",
    },
    {
        tenantId: "tenant-umbrella-bio",
        entraTenantId: "33445566-7788-99aa-bbcc-ddeeff001122",
        organizationName: "Umbrella BioPharma Global",
        subscriptionStatus: "ACTIVE",
        planTier: "Enterprise",
        salesRepName: "Martin Gomez",
        salesCommissionPercent: 15.0,
        paddlePriceId: "pri_01h8umbrella_ent",
        isManualBypass: true,
        createdAtIso: "2026-04-05T16:45:00.000Z",
    },
    {
        tenantId: "tenant-stark-energy",
        entraTenantId: "44556677-8899-aabb-ccdd-eeff00112233",
        organizationName: "Stark Energy Solutions",
        subscriptionStatus: "ACTIVE",
        planTier: "Enterprise",
        salesRepName: "Juan Manuel Chavez",
        salesCommissionPercent: 18.0,
        paddlePriceId: "pri_01h8stark_ent",
        isManualBypass: true,
        createdAtIso: "2026-05-18T11:20:00.000Z",
    },
    {
        tenantId: "tenant-wayne-corp",
        entraTenantId: "55667788-99aa-bbcc-ddee-ff0011223344",
        organizationName: "Wayne Enterprises",
        subscriptionStatus: "TRIAL",
        planTier: "Enterprise",
        salesRepName: "Carlos Rodriguez",
        salesCommissionPercent: 15.0,
        paddlePriceId: "pri_01h8wayne_ent",
        isManualBypass: false,
        createdAtIso: "2026-06-22T08:00:00.000Z",
    },
    {
        tenantId: "tenant-cyberdyne-ai",
        entraTenantId: "66778899-aabb-ccdd-eeff-001122334455",
        organizationName: "Cyberdyne Systems AI",
        subscriptionStatus: "ACTIVE",
        planTier: "Professional",
        salesRepName: "Mariana Lopez",
        salesCommissionPercent: 8.0,
        paddlePriceId: "pri_01h8cyber_pro",
        isManualBypass: false,
        createdAtIso: "2026-07-04T13:10:00.000Z",
    },
];

/**
 * Retorna la lista global de todos los tenants para SuperAdmin.
 */
export async function listAllTenantsForSuperAdmin(isMock = false): Promise<SuperAdminTenantItem[]> {
    if (isMock) {
        return [...MOCK_SUPERADMIN_TENANTS];
    }

    try {
        const [rows]: any = await pool.query(`
            SELECT 
                t.id as tenant_id,
                COALESCE(t.domain, t.id) as entra_tenant_id,
                COALESCE(t.name, t.company_name, 'Empresa S.A.') as organization_name,
                COALESCE(t.subscription_status, 'ACTIVE') as subscription_status,
                COALESCE(t.tier, 'Enterprise') as plan_tier,
                COALESCE(cd.sales_rep_name, 'Directo CSCloudSolutions') as sales_rep_name,
                COALESCE(cd.sales_commission_percent, 0.0) as sales_commission_percent,
                cd.paddle_price_id,
                COALESCE(cd.is_manual_bypass, 1) as is_manual_bypass,
                COALESCE(t.created_at, NOW()) as created_at
            FROM Tenants t
            LEFT JOIN TenantCommercialDeals cd ON cd.tenant_id = t.id
            ORDER BY t.created_at DESC
        `);

        if (Array.isArray(rows) && rows.length > 0) {
            return rows.map((r: any) => {
                const rawTier = String(r.plan_tier || "Enterprise").toLowerCase();
                const planTier: SaaSPlanTier = rawTier.includes("pro")
                    ? "Professional"
                    : rawTier.includes("bus")
                    ? "Business"
                    : "Enterprise";

                const rawStatus = String(r.subscription_status || "ACTIVE").toUpperCase();
                const subscriptionStatus: TenantSubscriptionStatus =
                    rawStatus === "TRIAL"
                        ? "TRIAL"
                        : rawStatus === "PAST_DUE"
                        ? "PAST_DUE"
                        : rawStatus === "CANCELED"
                        ? "CANCELED"
                        : "ACTIVE";

                return {
                    tenantId: String(r.tenant_id),
                    entraTenantId: String(r.entra_tenant_id),
                    organizationName: String(r.organization_name),
                    subscriptionStatus,
                    planTier,
                    salesRepName: String(r.sales_rep_name),
                    salesCommissionPercent: Number(r.sales_commission_percent) || 0,
                    paddlePriceId: r.paddle_price_id ? String(r.paddle_price_id) : undefined,
                    isManualBypass: Boolean(r.is_manual_bypass),
                    createdAtIso: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                };
            });
        }
    } catch {
        /* noop: fallback a tabla Tenants simple */
        try {
            const [simpleRows]: any = await pool.query(
                `SELECT id, domain, name, tier, subscription_status, created_at FROM Tenants ORDER BY created_at DESC`
            );
            if (Array.isArray(simpleRows) && simpleRows.length > 0) {
                return simpleRows.map((r: any) => {
                    const rawTier = String(r.tier || "Enterprise").toLowerCase();
                    const planTier: SaaSPlanTier = rawTier.includes("pro")
                        ? "Professional"
                        : rawTier.includes("bus")
                        ? "Business"
                        : "Enterprise";

                    return {
                        tenantId: String(r.id),
                        entraTenantId: String(r.domain || r.id),
                        organizationName: String(r.name || "Empresa"),
                        subscriptionStatus: "ACTIVE",
                        planTier,
                        salesRepName: "Directo CSCloudSolutions",
                        salesCommissionPercent: 0,
                        isManualBypass: true,
                        createdAtIso: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                    };
                });
            }
        } catch {
            /* noop */
        }
    }

    return [...MOCK_SUPERADMIN_TENANTS];
}

/**
 * Crea un nuevo tenant manualmente evadiendo la pasarela de pagos con tier inicial asignado.
 */
export async function createManualTenant(
    payload: CreateManualTenantPayload,
    isMock = false
): Promise<{ success: boolean; tenant: SuperAdminTenantItem }> {
    const { entraTenantId, organizationName, initialPlanTier } = payload;
    const tenantId = entraTenantId.trim();

    if (!tenantId || !organizationName.trim()) {
        throw new Error("Entra ID y Nombre Comercial son requeridos");
    }

    const newTenantItem: SuperAdminTenantItem = {
        tenantId,
        entraTenantId: tenantId,
        organizationName: organizationName.trim(),
        subscriptionStatus: "ACTIVE",
        planTier: initialPlanTier || "Enterprise",
        salesRepName: "Directo SuperAdmin",
        salesCommissionPercent: 0,
        isManualBypass: true,
        createdAtIso: new Date().toISOString(),
    };

    if (isMock) {
        return { success: true, tenant: newTenantItem };
    }

    try {
        await pool.query(
            `INSERT INTO Tenants (id, domain, name, tier, subscription_status)
             VALUES (?, ?, ?, ?, 'ACTIVE')
             ON DUPLICATE KEY UPDATE name = VALUES(name), tier = VALUES(tier), subscription_status = 'ACTIVE'`,
            [tenantId, tenantId, organizationName.trim(), initialPlanTier]
        );

        // Crear registro en TenantCommercialDeals
        try {
            await pool.query(
                `INSERT INTO TenantCommercialDeals (tenant_id, sales_rep_name, sales_commission_percent, is_manual_bypass)
                 VALUES (?, 'Directo SuperAdmin', 0, 1)
                 ON DUPLICATE KEY UPDATE is_manual_bypass = 1`,
                [tenantId]
            );
        } catch {
            /* noop */
        }
    } catch (e: any) {
        throw new Error(`Error al registrar tenant en la base de datos: ${e.message}`);
    }

    return { success: true, tenant: newTenantItem };
}

/**
 * Actualiza el Tier y/o Estado de suscripción de un tenant.
 */
export async function updateTenantTierAndStatus(
    payload: UpdateTenantTierPayload,
    isMock = false
): Promise<{ success: boolean }> {
    const { tenantId, planTier, subscriptionStatus = "ACTIVE" } = payload;

    if (!tenantId) throw new Error("Falta tenantId");

    if (isMock) return { success: true };

    try {
        await pool.query(
            `UPDATE Tenants SET tier = ?, subscription_status = ? WHERE id = ? OR domain = ?`,
            [planTier, subscriptionStatus, tenantId, tenantId]
        );
    } catch (e: any) {
        throw new Error(`Error al actualizar el tier del tenant: ${e.message}`);
    }

    return { success: true };
}

/**
 * Actualiza el vendedor y comisión comercial pactada para un tenant.
 */
export async function updateCommercialDeal(
    payload: UpdateCommercialDealPayload,
    isMock = false
): Promise<{ success: boolean }> {
    const { tenantId, salesRepName, salesCommissionPercent } = payload;

    if (!tenantId) throw new Error("Falta tenantId");

    if (isMock) return { success: true };

    try {
        await pool.query(
            `INSERT INTO TenantCommercialDeals (tenant_id, sales_rep_name, sales_commission_percent)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE sales_rep_name = VALUES(sales_rep_name), sales_commission_percent = VALUES(sales_commission_percent)`,
            [tenantId, salesRepName.trim(), Number(salesCommissionPercent) || 0]
        );
    } catch (e: any) {
        throw new Error(`Error al actualizar datos comerciales: ${e.message}`);
    }

    return { success: true };
}

/**
 * Genera el enlace de checkout personalizado de Paddle para cobrar un deal Enterprise.
 */
export async function generatePaddleCheckoutLink(
    payload: GeneratePaddleLinkPayload,
    isMock = false
): Promise<GeneratePaddleLinkResponse> {
    const { tenantId, paddlePriceId } = payload;

    if (!tenantId || !paddlePriceId) {
        throw new Error("tenantId y paddlePriceId son obligatorios");
    }

    const priceId = paddlePriceId.trim();
    const customData = encodeURIComponent(JSON.stringify({ tenantId }));
    const baseUrl = process.env.PADDLE_CHECKOUT_URL || "https://buy.paddle.com/checkout";
    const checkoutUrl = `${baseUrl}?price_id=${priceId}&custom_data=${customData}`;

    if (!isMock) {
        try {
            await pool.query(
                `INSERT INTO TenantCommercialDeals (tenant_id, paddle_price_id)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE paddle_price_id = VALUES(paddle_price_id)`,
                [tenantId, priceId]
            );
        } catch {
            /* noop */
        }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 86400000); // 7 días de validez

    return {
        checkoutUrl,
        priceId,
        tenantId,
        expiresAtIso: expiresAt.toISOString(),
    };
}
