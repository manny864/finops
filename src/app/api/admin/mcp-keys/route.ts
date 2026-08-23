/**
 * Admin endpoint para crear, listar y revocar API keys MCP.
 * Auth: requireTenantTier('Business') + requireTenantRole(['Admin','Owner'])
 *
 * El texto plano de la key se devuelve UNA SOLA VEZ en la creación (Zero-Knowledge).
 * Para tenants demo, el check `isMockTenant` se evalúa primero sin requerir OAuth.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import {
    listMcpKeys,
    createMcpKey,
    revokeMcpKey,
} from "@/services/mcpApiKey.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        // Directiva 1: Mock tenant primero sin requerir OAuth
        if (isMockTenant(tenantId) || searchParams.get("mock") === "true") {
            const keys = await listMcpKeys(tenantId);
            return NextResponse.json({ success: true, keys, mock: true });
        }

        // Tenants reales: validación obligatoria RBAC
        await requireTenantTier(request, tenantId, "Business");
        await requireTenantRole(request, tenantId, ["Admin", "Owner", "FinOps Manager", "Reader"]);

        const keys = await listMcpKeys(tenantId);
        return NextResponse.json({ success: true, keys });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        }
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, label, name } = body as { tenantId?: string; label?: string; name?: string };
        const keyName = (name || label || "").trim();

        if (!tenantId || !keyName) {
            return NextResponse.json({ success: false, error: "Falta tenantId o nombre descriptivo" }, { status: 400 });
        }

        // Directiva 1: Mock tenant primero
        if (isMockTenant(tenantId)) {
            const result = await createMcpKey(tenantId, keyName, "demo.user@cscloudsolutions.com");
            return NextResponse.json({
                success: true,
                key: result.rawKey,
                rawKey: result.rawKey,
                prefix: result.keyItem.keyPrefix,
                keyItem: result.keyItem,
                warning: result.warning,
            });
        }

        // Tenants reales: validación de rol de administración
        await requireTenantTier(request, tenantId, "Business");
        const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        const result = await createMcpKey(tenantId, keyName, identity.email || "admin");

        return NextResponse.json({
            success: true,
            key: result.rawKey,
            rawKey: result.rawKey,
            prefix: result.keyItem.keyPrefix,
            keyItem: result.keyItem,
            warning: result.warning,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        }
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const keyId = searchParams.get("keyId");

        if (!tenantId || !keyId) {
            return NextResponse.json({ success: false, error: "Falta tenantId o keyId" }, { status: 400 });
        }

        // Directiva 1: Mock tenant primero
        if (isMockTenant(tenantId)) {
            await revokeMcpKey(tenantId, keyId);
            return NextResponse.json({ success: true, mock: true });
        }

        // Tenants reales: validación de rol
        await requireTenantTier(request, tenantId, "Business");
        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        const ok = await revokeMcpKey(tenantId, keyId);
        return NextResponse.json({ success: ok });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        }
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}
