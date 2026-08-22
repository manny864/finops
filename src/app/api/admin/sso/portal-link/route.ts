import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getWorkOS, isWorkOSConfigured } from "@/lib/workosClient";
import pool from "@/modules/storage/db";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

/**
 * POST /api/admin/sso/portal-link
 * Generate WorkOS admin portal link for customer to configure SAML
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId } = body as { tenantId?: string };

        if (!tenantId) {
            return NextResponse.json(
                { success: false, error: "Missing tenantId" },
                { status: 400 }
            );
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (!isWorkOSConfigured()) {
            return NextResponse.json(
                { success: false, error: "SSO not configured" },
                { status: 503 }
            );
        }

        const workos = getWorkOS();

        // Get or create TenantSSO record
        const [ssoRows] = await pool.query(
            `SELECT workos_org_id FROM TenantSSO WHERE tenant_id = ?`,
            [tenantId]
        );

        let orgId: string | null =
            Array.isArray(ssoRows) && ssoRows.length > 0
                ? (ssoRows[0] as any).workos_org_id
                : null;

        // If no org yet, create one
        if (!orgId) {
            try {
                // Get tenant info for org name
                const [tenantRows] = await pool.query(
                    `SELECT company_name FROM Tenants WHERE tenant_id = ?`,
                    [tenantId]
                );

                const companyName =
                    Array.isArray(tenantRows) && tenantRows.length > 0
                        ? (tenantRows[0] as any).company_name
                        : "FinOps Organization";

                const org = await (workos as any).organizations.createOrganization({
                    name: companyName,
                });

                orgId = org.id;

                // Update TenantSSO with org ID
                await pool.query(
                    `UPDATE TenantSSO SET workos_org_id = ? WHERE tenant_id = ?`,
                    [orgId, tenantId]
                );
            } catch (createErr) {
                console.error("Error creating WorkOS org:", createErr);
                return NextResponse.json(
                    { success: false, error: "Failed to create organization" },
                    { status: 500 }
                );
            }
        }

        // Generate admin portal link for SSO intent
        const link = await (workos as any).portal.generateLink({
            organization: orgId,
            intent: "sso",
        });

        return NextResponse.json({
            success: true,
            link,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { success: false, error: errorMessage(err) },
                { status: errorStatus(err) }
            );
        }
        console.error("Portal link error:", err);
        return NextResponse.json(
            { success: false, error: errorMessage(err) || "Failed to generate portal link" },
            { status: 500 }
        );
    }
}

