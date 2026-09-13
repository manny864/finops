import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireTenantAccess, hasSystemRole, requireRequestIdentity } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { normalizeTier, SUBSCRIPTION_LIMITS, USER_LIMITS } from "@/lib/tierLogic";
import { getTenantSlotUsage } from "@/lib/subscriptionQuota";

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        const body = await request.json();
        const { parentTenantId, newTenantId, organizationName } = body;

        if (!parentTenantId || !newTenantId || !organizationName) {
            return NextResponse.json(
                { error: "Faltan parámetros obligatorios: parentTenantId, newTenantId y organizationName son requeridos." },
                { status: 400 }
            );
        }

        const cleanParent = String(parentTenantId).trim();
        const cleanNew = String(newTenantId).trim().toLowerCase();
        const cleanName = String(organizationName).trim();

        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(cleanNew)) {
            return NextResponse.json(
                { error: "El identificador del nuevo tenant (newTenantId) debe ser un GUID válido de Microsoft Entra ID." },
                { status: 400 }
            );
        }

        // 1. Validar permisos del actor sobre el tenant titular del contrato
        const identity = await requireTenantAccess(request, cleanParent, { allowSuperAdmin: true });
        const isSuperAdmin = identity.isCorporateDomain && await hasSystemRole(identity.email, "SUPERADMIN");

        if (!isSuperAdmin) {
            const [roleRows]: any = await pool.query(
                `SELECT role FROM Users WHERE (entra_oid = ? OR email = ?) AND tenant_id = ? LIMIT 1`,
                [identity.claims.oid || "", identity.email, cleanParent]
            );
            const userRole = roleRows?.[0]?.role;
            if (userRole !== "Admin" && userRole !== "Owner") {
                return NextResponse.json(
                    { error: "Solo los administradores o propietarios del contrato pueden vincular nuevos tenants." },
                    { status: 403 }
                );
            }
        }

        // 2. Obtener datos y Tier del contrato titular
        const [parentRows]: any = await pool.query(
            `SELECT tier, subscription_status, company_name, additional_tenant_slots, contract_id
             FROM Tenants
             WHERE tenant_id = ? LIMIT 1`,
            [cleanParent]
        );

        if (!Array.isArray(parentRows) || parentRows.length === 0) {
            return NextResponse.json({ error: "El tenant titular del contrato no existe." }, { status: 404 });
        }

        const parent = parentRows[0];
        const effectiveTier = normalizeTier(parent.tier) || "Professional";
        const effectiveStatus = parent.subscription_status || "ACTIVE";
        const contractId = parent.contract_id || null;

        // 3. Verificar que el newTenantId no esté registrado previamente
        const [existingRows]: any = await pool.query(
            `SELECT tenant_id FROM Tenants WHERE tenant_id = ? LIMIT 1`,
            [cleanNew]
        );

        if (Array.isArray(existingRows) && existingRows.length > 0) {
            return NextResponse.json(
                { error: "El tenant indicado ya se encuentra registrado en la plataforma." },
                { status: 409 }
            );
        }

        // 3.b Cobrar el slot: sin uno libre no se agrega el tenant.
        //
        // Professional y Business compran el slot (Mi cuenta -> Facturacion, o
        // la tarjeta "Tenant Adicional" del marketplace): tienen precio de lista
        // y price ID en Paddle, asi que el tope es accionable por el cliente.
        //
        // Enterprise queda afuera del tope A PROPOSITO: su capacidad va en el
        // contrato negociado --`ADDON_PRICE_USD.extraTenant.Enterprise` es null
        // y el panel de capacidad le responde "se ajusta por contrato"--, o sea
        // que no tiene forma de comprar un slot. Topearlo aca lo dejaria sin
        // salida por autoservicio para algo que su contrato ya le da.
        //
        // El SuperAdmin tampoco paga tope: es quien carga esos contratos a mano.
        if (!isSuperAdmin && effectiveTier !== "Enterprise") {
            const { used, limit } = await getTenantSlotUsage(cleanParent);
            if (used >= limit) {
                return NextResponse.json(
                    {
                        error: limit === 0
                            ? "Tu contrato no tiene tenants adicionales incluidos. Comprá un slot en Mi cuenta → Facturación para agregarlo."
                            : `Ya usaste los ${limit} tenant(s) adicional(es) de tu contrato. Comprá otro en Mi cuenta → Facturación para agregar uno más.`,
                        slots: { used, limit },
                    },
                    { status: 409 }
                );
            }
        }

        // 4. Insertar el nuevo tenant vinculado al contrato
        await pool.query(
            `INSERT INTO Tenants (
                tenant_id,
                company_name,
                parent_tenant_id,
                contract_id,
                tier,
                subscription_status,
                status,
                is_onboarded
            ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0)`,
            [
                cleanNew,
                cleanName,
                cleanParent,
                contractId,
                effectiveTier,
                effectiveStatus,
            ]
        );

        // 5. Vincular al usuario actor como Admin/Owner en Users para el nuevo tenant
        await pool.query(
            `INSERT INTO Users (entra_oid, email, tenant_id, role, display_name, system_role)
             VALUES (?, ?, ?, 'Owner', ?, ?)
             ON DUPLICATE KEY UPDATE role = 'Owner'`,
            [
                identity.claims.oid || identity.email,
                identity.email,
                cleanNew,
                identity.email.split("@")[0] || cleanName,
                isSuperAdmin ? "SUPERADMIN" : "USER",
            ]
        );

        // 6. Registrar en ActionLogs
        try {
            await pool.query(
                `INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status)
                 VALUES (?, ?, 'CONTRACT_TENANT_ADDED', ?, 'SUCCESS')`,
                [cleanParent, identity.email, cleanNew]
            );
        } catch {
            // non-blocking
        }

        return NextResponse.json({
            success: true,
            message: `Tenant "${cleanName}" agregado exitosamente al contrato (${effectiveTier}).`,
            tenant: {
                id: cleanNew,
                name: cleanName,
                parentTenantId: cleanParent,
                tier: effectiveTier,
                subscriptionLimit: SUBSCRIPTION_LIMITS[effectiveTier] ?? 2,
                userLimit: USER_LIMITS[effectiveTier] ?? 3,
            },
        });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        console.error("API POST /api/admin/tenants/contract-tenant error:", error);
        return NextResponse.json({ error: "Fallo al agregar tenant al contrato." }, { status: 500 });
    }
}
