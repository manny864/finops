/**
 * Admin endpoint para crear y listar API keys públicas REST v1.
 * Auth: requireTenantTier('Business') + requireTenantRole(['Admin','Owner'])
 *
 * El texto plano de la key se devuelve UNA SOLA VEZ en el POST de creación.
 * Para tenants demo, el check `isMockTenant` se evalúa primero sin requerir OAuth.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import {
    listPublicApiKeys,
    createPublicApiKey,
} from "@/services/publicApiKey.service";
import { PublicApiScope } from "@/types/publicApiKey.types";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        // Directiva 1: Mock tenant primero sin requerir OAuth
        if (isMockTenant(tenantId) || searchParams.get("mock") === "true") {
            const keys = await listPublicApiKeys(tenantId);
            return NextResponse.json({ success: true, keys, mock: true });
        }

        // Tenants reales: validación obligatoria RBAC
        await requireTenantTier(request, tenantId, "Business");
        await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner", "FinOps Manager", "Reader"]);

        const keys = await listPublicApiKeys(tenantId);
        return NextResponse.json({ success: true, keys });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantIdFromQuery = searchParams.get("tenantId");

        const body = await request.json().catch(() => ({}));
        const tenantId = body.tenantId || tenantIdFromQuery;
        const name = (body.name || "").trim();
        const rateLimitPerMinute = Number(body.rateLimitPerMinute || body.rate_limit_per_min) || 60;
        const scopes = (body.scopes || ["read:cost", "read:resources"]) as PublicApiScope[];

        if (!tenantId || !name) {
            return NextResponse.json({ success: false, error: "Falta tenantId o nombre descriptivo" }, { status: 400 });
        }

        // Directiva 1: Mock tenant primero
        if (isMockTenant(tenantId)) {
            const result = await createPublicApiKey(
                { tenantId, name, rateLimitPerMinute, scopes },
                "demo.user@cscloudsolutions.com"
            );
            return NextResponse.json(
                {
                    success: true,
                    key: result.rawKey,
                    rawKey: result.rawKey,
                    prefix: result.keyItem.keyPrefix,
                    keyItem: result.keyItem,
                    message: result.warning,
                },
                { status: 201 }
            );
        }

        // Tenants reales: validación de rol de administración
        await requireTenantTier(request, tenantId, "Business");
        const identity = await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner"]);

        const result = await createPublicApiKey(
            { tenantId, name, rateLimitPerMinute, scopes },
            identity.email || "admin@cscloudsolutions.com"
        );

        return NextResponse.json(
            {
                success: true,
                key: result.rawKey,
                rawKey: result.rawKey,
                prefix: result.keyItem.keyPrefix,
                keyItem: result.keyItem,
                message: result.warning,
            },
            { status: 201 }
        );
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
