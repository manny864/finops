import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { isWorkOSConfigured } from "@/lib/workosClient";
import { isMockTenant } from "@/lib/mockData";
import {
    isValidDomain,
    isValidWorkosConnectionId,
    isValidWorkosOrgId,
    mapSsoConfig,
    normalizeDomain,
    toIdpProvider,
    toJitRole,
    type RawSsoRow,
} from "@/services/tenantSso.service";
import type { TenantSsoPayload } from "@/types/tenantSso.types";

/**
 * GET /api/admin/sso?tenantId=xxx
 * Retrieve TenantSSO configuration for the tenant
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json(
                { success: false, error: "Missing tenantId" },
                { status: 400 }
            );
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        const [rows] = await pool.query(
            `SELECT id, tenant_id, workos_org_id, workos_connection_id, domain, enabled,
                    idp_provider, is_domain_verified, jit_provisioning_enabled,
                    default_role_for_new_users, last_test_result, last_test_detail, last_tested_at,
                    created_at, updated_at
             FROM TenantSSO WHERE tenant_id = ?`,
            [tenantId]
        );

        const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as RawSsoRow) : null;
        const payload: TenantSsoPayload & { config: ReturnType<typeof mapSsoConfig> } = {
            config: mapSsoConfig(row),
            workosConfigured: isWorkOSConfigured(),
            source: isMockTenant(tenantId) ? "mock" : "live",
            mock: isMockTenant(tenantId) || undefined,
            lastUpdated: new Date().toISOString(),
        };
        // `config` en crudo se mantiene por compatibilidad con la forma vieja.
        return NextResponse.json({ success: true, ...payload, rawConfig: row });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { success: false, error: errorMessage(err) },
                { status: errorStatus(err) }
            );
        }
        console.error("Admin SSO GET error:", err);
        return NextResponse.json(
            { success: false, error: errorMessage(err) || "Error fetching SSO config" },
            { status: 500 }
        );
    }
}

/**
 * PUT /api/admin/sso
 * Upsert TenantSSO configuration
 */
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const {
            tenantId,
            workos_org_id,
            workos_connection_id,
            domain,
            enabled,
            jitProvisioningEnabled,
            defaultRoleForNewUsers,
            idpProvider,
        } = body as {
            tenantId?: string;
            workos_org_id?: string;
            workos_connection_id?: string;
            domain?: string;
            enabled?: boolean;
            jitProvisioningEnabled?: boolean;
            defaultRoleForNewUsers?: string;
            idpProvider?: string;
        };

        if (!tenantId) {
            return NextResponse.json(
                { success: false, error: "Missing tenantId" },
                { status: 400 }
            );
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        // Validación en el servidor: la del formulario es UX. Un dominio o un ID
        // mal formado guardado acá deja el SSO roto de una forma que sólo se
        // descubre cuando alguien no puede entrar.
        const cleanDomain = domain ? normalizeDomain(domain) : "";
        if (cleanDomain && !isValidDomain(cleanDomain)) {
            return NextResponse.json({ success: false, error: "El dominio no tiene un formato válido (ej.: acme.com)." }, { status: 400 });
        }
        if (workos_org_id && !isValidWorkosOrgId(workos_org_id)) {
            return NextResponse.json({ success: false, error: "El ID de organización de WorkOS debe empezar con `org_`." }, { status: 400 });
        }
        if (workos_connection_id && !isValidWorkosConnectionId(workos_connection_id)) {
            return NextResponse.json({ success: false, error: "El ID de conexión de WorkOS debe empezar con `conn_`." }, { status: 400 });
        }
        // Habilitar SSO sin las tres piezas dejaría a los usuarios del dominio
        // sin poder entrar por ningún camino.
        if (enabled && !(cleanDomain && workos_org_id && workos_connection_id)) {
            return NextResponse.json(
                { success: false, error: "Para habilitar el SSO hacen falta el dominio, el ID de organización y el ID de conexión." },
                { status: 400 }
            );
        }

        // Upsert TenantSSO
        await pool.query(
            `INSERT INTO TenantSSO
                (tenant_id, workos_org_id, workos_connection_id, domain, enabled,
                 jit_provisioning_enabled, default_role_for_new_users, idp_provider)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                workos_org_id = VALUES(workos_org_id),
                workos_connection_id = VALUES(workos_connection_id),
                domain = VALUES(domain),
                enabled = VALUES(enabled),
                jit_provisioning_enabled = VALUES(jit_provisioning_enabled),
                default_role_for_new_users = VALUES(default_role_for_new_users),
                idp_provider = COALESCE(VALUES(idp_provider), idp_provider),
                updated_at = CURRENT_TIMESTAMP`,
            [
                tenantId,
                workos_org_id || null,
                workos_connection_id || null,
                cleanDomain || null,
                enabled ? 1 : 0,
                jitProvisioningEnabled ? 1 : 0,
                // Fail-closed a Reader: nunca Admin por un valor inesperado.
                toJitRole(defaultRoleForNewUsers) === "CONTRIBUTOR" ? "Colaborador" : "Reader",
                toIdpProvider(idpProvider) || null,
            ]
        );

        return NextResponse.json({
            success: true,
            message: "SSO config updated",
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { success: false, error: errorMessage(err) },
                { status: errorStatus(err) }
            );
        }
        console.error("Admin SSO PUT error:", err);
        return NextResponse.json(
            { success: false, error: errorMessage(err) || "Error updating SSO config" },
            { status: 500 }
        );
    }
}
