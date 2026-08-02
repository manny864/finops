import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getExemptionsForTenant, upsertExemption, deleteExemption } from "@/modules/storage/recommendationExemptions";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get("x-tenant-id");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta x-tenant-id" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner", "Reader", "Colaborador"]);

        const exemptions = await getExemptionsForTenant(tenantId);
        const rightsizingExemptions = exemptions.filter(e => e.recommendationType === 'rightsizing');
        return NextResponse.json({ success: true, data: rightsizingExemptions });
    } catch (e: any) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        return NextResponse.json({ error: e.message || "Error al consultar exenciones" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const tenantId = request.headers.get("x-tenant-id");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta x-tenant-id" }, { status: 400 });
        }

        const authPayload = await requireTenantRole(request, tenantId, ["Admin", "Owner", "Colaborador"]);
        const body = await request.json();

        if (!body.resourceId || !body.resourceName) {
            return NextResponse.json({ error: "resourceId y resourceName son obligatorios" }, { status: 400 });
        }

        const userObj = authPayload as any;
        const result = await upsertExemption(tenantId, {
            resourceId: body.resourceId,
            resourceName: body.resourceName,
            recommendationType: body.recommendationType || "rightsizing",
            reason: body.reason || "Eximida por el usuario",
            comment: body.comment || null,
            createdBy: userObj?.email || userObj?.preferred_username || userObj?.upn || "Usuario",
        });

        return NextResponse.json({ success: true, data: result });
    } catch (e: any) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        return NextResponse.json({ error: e.message || "Error al guardar exención" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const tenantId = request.headers.get("x-tenant-id");
        const { searchParams } = new URL(request.url);
        const resourceId = searchParams.get("resourceId");

        if (!tenantId || !resourceId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos (tenantId, resourceId)" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner", "Colaborador"]);

        await deleteExemption(tenantId, resourceId);
        return NextResponse.json({ success: true, message: "Exención eliminada correctamente" });
    } catch (e: any) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        return NextResponse.json({ error: e.message || "Error al eliminar exención" }, { status: 500 });
    }
}
