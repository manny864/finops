import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { ExternalSpendError, deleteCommitment } from "@/services/externalSpend.service";
import { WRITE_ROLES, errorResponse, parseId } from "../../shared";

/** Baja de un compromiso (`?tenantId=`). Sus avisos de renovación caen en cascada. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId") || "";
        const id = parseId((await params).id);
        if (!tenantId || id === null) throw new ExternalSpendError("invalid_input");
        await requireTenantTier(request, tenantId, "Business");
        await requireTenantRole(request, tenantId, WRITE_ROLES);

        await deleteCommitment(tenantId, id);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return errorResponse(e, "DELETE /api/intelligence/external-spend/commitments/[id]");
    }
}
