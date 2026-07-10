import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import rateLimiter from "@/lib/rateLimiter";
import {
    validateTenantLogo,
    saveTenantLogo,
    deleteTenantLogoFile,
    TENANT_LOGO_MAX_BYTES,
} from "@/lib/tenantLogo";

// Logo de marca del tenant, usado en el header (ver ClientShell.tsx) en vez
// del texto genérico "Cloud FinOps". Solo Admin/Owner puede subirlo/borrarlo
// (branding a nivel organización, no por usuario).

export async function POST(request: NextRequest) {
    try {
        const form = await request.formData();
        const tenantId = typeof form.get("tenantId") === "string" ? (form.get("tenantId") as string) : "";
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }
        const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        const rl = await rateLimiter.checkByKeyDistributed(
            `tenant-logo-upload:${tenantId}:${identity.email}`, 10, 60 * 60 * 1000
        );
        if (!rl.allowed) {
            return NextResponse.json({ error: "Demasiadas subidas. Intenta más tarde." }, { status: 429 });
        }

        const file = form.get("file");
        if (!(file instanceof File)) {
            return NextResponse.json({ error: "Falta el archivo (campo 'file')." }, { status: 400 });
        }
        if (file.size > TENANT_LOGO_MAX_BYTES) {
            return NextResponse.json({ error: "El logo supera el máximo de 2 MB." }, { status: 413 });
        }

        const bytes = Buffer.from(await file.arrayBuffer());
        const originalName = (file.name || "logo").slice(0, 255);
        const validation = validateTenantLogo(originalName, bytes);
        if (!validation.ok) {
            return NextResponse.json({ error: validation.error }, { status: 415 });
        }

        const [rows]: any = await pool.query(
            "SELECT logo_stored_name FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        const previousStoredName = rows?.[0]?.logo_stored_name as string | null | undefined;

        const storedName = await saveTenantLogo(bytes, validation.ext!);
        await pool.query(
            "UPDATE Tenants SET logo_stored_name = ? WHERE tenant_id = ?",
            [storedName, tenantId]
        );

        if (previousStoredName) {
            await deleteTenantLogoFile(previousStoredName);
        }

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "POST /api/admin/tenants/logo" });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }
        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        const [rows]: any = await pool.query(
            "SELECT logo_stored_name FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        const storedName = rows?.[0]?.logo_stored_name as string | null | undefined;

        await pool.query("UPDATE Tenants SET logo_stored_name = NULL WHERE tenant_id = ?", [tenantId]);
        if (storedName) {
            await deleteTenantLogoFile(storedName);
        }

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return serverError(e, { context: "DELETE /api/admin/tenants/logo" });
    }
}
