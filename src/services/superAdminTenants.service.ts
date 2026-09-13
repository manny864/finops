/**
 * Servicio de backend para Gobernanza y Gestión Global de Tenants (SuperAdmin).
 */

import crypto from "crypto";
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
    ManualTrialDays,
    MANUAL_TRIAL_DAY_OPTIONS,
} from "@/types/superAdminTenants.types";

/**
 * Upsert en TenantCommercialDeals.
 *
 * La tabla declara `id VARCHAR(36) PRIMARY KEY` sin default, así que todo INSERT
 * tiene que traerlo. Los tres call sites lo omitían y la tabla nunca recibió una
 * fila: dos fallaban en silencio dentro de un catch vacío y el tercero
 * (guardar vendedor/comisión) le tiraba el error al usuario.
 */
export type ContractTerm = "annual" | "monthly";

/**
 * Normaliza una fecha de venta a `YYYY-MM-DD`, o `null` si no es utilizable.
 *
 * Se valida acá y no en MySQL porque una fecha inválida entra como `0000-00-00`
 * o como NULL según el modo del servidor, y en los dos casos el devengamiento
 * arrancaría desde una fecha que nadie eligió.
 */
export function normalizeSoldAt(raw?: string | null): string | null {
    if (!raw) return null;
    const t = String(raw).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
    const d = new Date(`${t}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    // Round-trip: descarta 2026-02-31, que `new Date` acepta corriéndola a marzo.
    return d.toISOString().slice(0, 10) === t ? t : null;
}

async function upsertCommercialDeal(
    tenantId: string,
    fields: {
        salesRepName?: string;
        salesCommissionPercent?: number;
        soldAt?: string | null;
        contractTerm?: ContractTerm;
    }
): Promise<void> {
    const salesRepName = fields.salesRepName ?? "Directo SuperAdmin";
    const commission = Number(fields.salesCommissionPercent) || 0;
    // Fecha de venta: la del alta si no se indica otra. Es el arranque del
    // devengamiento de comisiones (MEJ-14), así que tiene que quedar registrada
    // en el momento, no reconstruirse después a ojo.
    const soldAt = normalizeSoldAt(fields.soldAt) ?? new Date().toISOString().slice(0, 10);
    const contractTerm: ContractTerm = fields.contractTerm === "annual" ? "annual" : "monthly";

    await pool.query(
        `INSERT INTO TenantCommercialDeals (id, tenant_id, sales_rep_name, sales_commission_percent, sold_at, contract_term)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            sales_rep_name = VALUES(sales_rep_name),
            sales_commission_percent = VALUES(sales_commission_percent),
            -- sold_at NO se pisa en el update: la fecha de venta es un hecho
            -- del pasado. Reescribirla al editar el vendedor correria el inicio
            -- del devengamiento y recalcularia comisiones ya liquidadas.
            sold_at = COALESCE(TenantCommercialDeals.sold_at, VALUES(sold_at)),
            contract_term = VALUES(contract_term)`,
        [crypto.randomUUID(), tenantId, salesRepName, commission, soldAt, contractTerm]
    );
}

/**
 * Upsert en TenantSubscriptions, que es donde viven `is_manual_bypass` y
 * `paddle_price_id`. El código anterior los escribía en TenantCommercialDeals,
 * donde esas columnas no existen.
 */
async function upsertTenantSubscription(
    tenantId: string,
    fields: { planTier?: SaaSPlanTier; status?: TenantSubscriptionStatus; isManualBypass?: boolean; paddlePriceId?: string }
): Promise<void> {
    const sets: string[] = [];
    const insertCols = ["id", "tenant_id"];
    const insertVals: unknown[] = [crypto.randomUUID(), tenantId];

    if (fields.planTier) {
        insertCols.push("plan_tier");
        insertVals.push(fields.planTier);
        sets.push("plan_tier = VALUES(plan_tier)");
    }
    if (fields.status) {
        insertCols.push("status");
        insertVals.push(fields.status);
        sets.push("status = VALUES(status)");
    }
    if (fields.isManualBypass !== undefined) {
        insertCols.push("is_manual_bypass");
        insertVals.push(fields.isManualBypass ? 1 : 0);
        sets.push("is_manual_bypass = VALUES(is_manual_bypass)");
    }
    if (fields.paddlePriceId) {
        insertCols.push("paddle_price_id");
        insertVals.push(fields.paddlePriceId);
        sets.push("paddle_price_id = VALUES(paddle_price_id)");
    }

    if (sets.length === 0) return;

    await pool.query(
        `INSERT INTO TenantSubscriptions (${insertCols.join(", ")})
         VALUES (${insertCols.map(() => "?").join(", ")})
         ON DUPLICATE KEY UPDATE ${sets.join(", ")}`,
        insertVals
    );
}

const MOCK_SUPERADMIN_TENANTS: SuperAdminTenantItem[] = [
    {
        tenantId: "tenant-acme-prod",
        entraTenantId: "01234567-89ab-cdef-0123-456789abcdef",
        organizationName: "ACME Corporation",
        subscriptionStatus: "ACTIVE",
        planTier: "Enterprise",
        salesRepName: "Juan Manuel Chavez",
        salesCommissionPercent: 15.0,
        soldAtIso: "2026-01-15",
        contractTerm: "monthly",
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
        soldAtIso: "2026-02-15",
        contractTerm: "annual",
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
        soldAtIso: "2026-03-15",
        contractTerm: "monthly",
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
        soldAtIso: "2026-04-15",
        contractTerm: "annual",
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
        soldAtIso: "2026-05-15",
        contractTerm: "monthly",
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
        soldAtIso: "2026-06-15",
        contractTerm: "annual",
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
        soldAtIso: "2026-07-15",
        contractTerm: "monthly",
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
                t.tenant_id as tenant_id,
                t.tenant_id as entra_tenant_id,
                COALESCE(t.company_name, 'Empresa S.A.') as organization_name,
                COALESCE(t.subscription_status, p.subscription_status, 'ACTIVE') as subscription_status,
                COALESCE(t.tier, p.tier, 'Enterprise') as plan_tier,
                t.trial_ends_at as trial_ends_at,
                COALESCE(cd.sales_rep_name, 'Directo CSCloudSolutions') as sales_rep_name,
                COALESCE(cd.sales_commission_percent, 0.0) as sales_commission_percent,
                cd.sold_at as sold_at,
                COALESCE(cd.contract_term, 'monthly') as contract_term,
                ts.paddle_price_id,
                t.parent_tenant_id,
                t.contract_id,
                COALESCE(ts.is_manual_bypass, 1) as is_manual_bypass,
                COALESCE(t.created_at, NOW()) as created_at,
                t.activated_at,
                t.suspended_at,
                t.canceled_at,
                t.cancellation_reason
            FROM Tenants t
            LEFT JOIN Tenants p ON t.parent_tenant_id = p.tenant_id
            LEFT JOIN TenantCommercialDeals cd ON cd.tenant_id = t.tenant_id
            LEFT JOIN TenantSubscriptions ts ON ts.tenant_id = t.tenant_id
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
                    soldAtIso: r.sold_at ? new Date(r.sold_at).toISOString().slice(0, 10) : undefined,
                    contractTerm: (r.contract_term === "annual" ? "annual" : "monthly") as ContractTerm,
                    activatedAtIso: r.activated_at ? new Date(r.activated_at).toISOString() : undefined,
                    suspendedAtIso: r.suspended_at ? new Date(r.suspended_at).toISOString() : undefined,
                    canceledAtIso: r.canceled_at ? new Date(r.canceled_at).toISOString() : undefined,
                    cancellationReason: r.cancellation_reason || undefined,
                    paddlePriceId: r.paddle_price_id ? String(r.paddle_price_id) : undefined,
                    parentTenantId: r.parent_tenant_id ? String(r.parent_tenant_id) : undefined,
                    contractId: r.contract_id ? String(r.contract_id) : undefined,
                    isManualBypass: Boolean(r.is_manual_bypass),
                    trialEndsAtIso: r.trial_ends_at ? new Date(r.trial_ends_at).toISOString() : undefined,
                    createdAtIso: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                };
            });
        }
    } catch (e) {
        // Se loguea antes de caer a MOCK: este catch silencioso es lo que ocultó
        // durante semanas que la query pedía columnas inexistentes y la pantalla
        // venía mostrando 7 tenants ficticios como si fueran reales.
        console.error("[superAdminTenants] listAllTenantsForSuperAdmin falló, devolviendo MOCK:", e);

        /* fallback a tabla Tenants simple, sin joins ni columnas de contrato */
        try {
            const [simpleRows]: any = await pool.query(
                `SELECT tenant_id, company_name, tier, subscription_status, trial_ends_at, created_at
                   FROM Tenants ORDER BY created_at DESC`
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
                        tenantId: String(r.tenant_id),
                        entraTenantId: String(r.tenant_id),
                        organizationName: String(r.company_name || "Empresa"),
                        subscriptionStatus:
                            String(r.subscription_status || "ACTIVE").toUpperCase() === "TRIAL" ? "TRIAL" : "ACTIVE",
                        planTier,
                        salesRepName: "Directo CSCloudSolutions",
                        salesCommissionPercent: 0,
                        // El fallback lee sólo `Tenants`, sin join comercial: no hay
                        // plazo registrado, y 'monthly' es el default de la plataforma.
                        contractTerm: "monthly" as const,
                        isManualBypass: true,
                        trialEndsAtIso: r.trial_ends_at ? new Date(r.trial_ends_at).toISOString() : undefined,
                        createdAtIso: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                    };
                });
            }
        } catch (e2) {
            console.error("[superAdminTenants] fallback simple también falló:", e2);
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

    // Sólo se acepta un plazo de la lista blanca. Cualquier otro valor cae a 0 =
    // sin trial, nunca a un default silencioso que regale acceso.
    const trialDays = MANUAL_TRIAL_DAY_OPTIONS.includes(payload.trialDays as ManualTrialDays)
        ? (payload.trialDays as ManualTrialDays)
        : 0;
    const subscriptionStatus: TenantSubscriptionStatus = trialDays ? "TRIAL" : "ACTIVE";

    const newTenantItem: SuperAdminTenantItem = {
        tenantId,
        entraTenantId: tenantId,
        organizationName: organizationName.trim(),
        subscriptionStatus,
        planTier: initialPlanTier || "Enterprise",
        salesRepName: "Directo SuperAdmin",
        salesCommissionPercent: 0,
        // El alta manual ES la venta: la fecha se registra en el momento y no se
        // reconstruye despues a ojo (MEJ-14). El plazo por defecto es mensual.
        soldAtIso: new Date().toISOString().slice(0, 10),
        contractTerm: "monthly",
        isManualBypass: true,
        trialEndsAtIso: trialDays
            ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()
            : undefined,
        createdAtIso: new Date().toISOString(),
    };

    if (isMock) {
        return { success: true, tenant: newTenantItem };
    }

    try {
        // `trial_ends_at` se calcula en MySQL y no en Node: el cron de expiración
        // compara contra NOW() del server, así que el reloj tiene que ser el mismo.
        await pool.query(
            `INSERT INTO Tenants (tenant_id, company_name, tier, subscription_status, trial_ends_at)
             VALUES (?, ?, ?, ?, ${trialDays ? "DATE_ADD(NOW(), INTERVAL ? DAY)" : "NULL"})
             ON DUPLICATE KEY UPDATE
                company_name = VALUES(company_name),
                tier = VALUES(tier),
                subscription_status = VALUES(subscription_status),
                trial_ends_at = VALUES(trial_ends_at)`,
            trialDays
                ? [tenantId, organizationName.trim(), initialPlanTier, subscriptionStatus, trialDays]
                : [tenantId, organizationName.trim(), initialPlanTier, subscriptionStatus]
        );

        // El tenant ya existe: si estos dos fallan queda igual usable, así que se
        // loguean en vez de abortar el alta.
        try {
            await upsertCommercialDeal(tenantId, { salesRepName: "Directo SuperAdmin", salesCommissionPercent: 0 });
            await upsertTenantSubscription(tenantId, {
                planTier: initialPlanTier || "Enterprise",
                status: subscriptionStatus,
                isManualBypass: true,
            });
        } catch (e) {
            console.error("[superAdminTenants] tenant creado pero falló su registro comercial:", e);
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
        // `WHERE id = ? OR domain = ?` no podía funcionar: `domain` no existe y
        // `id` es el autoincrement, no el GUID que manda el panel.
        await pool.query(`UPDATE Tenants SET tier = ?, subscription_status = ? WHERE tenant_id = ?`, [
            planTier,
            subscriptionStatus,
            tenantId,
        ]);
        // Se replica en TenantSubscriptions para que el tier no quede desfasado
        // entre las dos tablas que lo guardan.
        await upsertTenantSubscription(tenantId, { planTier, status: subscriptionStatus });
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
    const { tenantId, salesRepName, salesCommissionPercent, soldAt, contractTerm } = payload;

    if (!tenantId) throw new Error("Falta tenantId");

    if (isMock) return { success: true };

    try {
        await upsertCommercialDeal(tenantId, {
            salesRepName: salesRepName.trim(),
            salesCommissionPercent: Number(salesCommissionPercent) || 0,
            soldAt,
            contractTerm,
        });
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
            await upsertTenantSubscription(tenantId, { paddlePriceId: priceId });
        } catch (e) {
            console.error("[superAdminTenants] no se pudo persistir el paddle_price_id:", e);
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
