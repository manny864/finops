/**
 * Endpoint para revocar/eliminar o actualizar estado de una API Key Pública.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { revokePublicApiKey } from "@/services/publicApiKey.service";

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        const resolvedParams = await params;
        const keyId = resolvedParams.id;

        if (isMockTenant(tenantId)) {
            await revokePublicApiKey(tenantId, keyId);
            return NextResponse.json({ success: true, message: "Key revocada", mock: true });
        }

        await requireTenantTier(request, tenantId, "Business");
        await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner"]);

        const ok = await revokePublicApiKey(tenantId, keyId);
        if (!ok) {
            return NextResponse.json({ success: false, error: "Clave no encontrada" }, { status: 404 });
        }

        return NextResponse.json({ success: true, message: "Key revocada exitosamente" });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        const resolvedParams = await params;
        const keyId = resolvedParams.id;

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true });
        }

        await requireTenantTier(request, tenantId, "Business");
        await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner"]);

        const body = await request.json().catch(() => ({}));
        const enabled = typeof body.enabled === "boolean" ? body.enabled : true;

        await pool.query(`UPDATE PublicApiKeys SET enabled = ? WHERE id = ? AND tenant_id = ?`, [
            enabled,
            keyId,
            tenantId,
        ]);

        return NextResponse.json({ success: true, enabled });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
