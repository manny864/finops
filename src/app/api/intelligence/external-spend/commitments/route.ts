import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { ExternalSpendError, commitmentSchema, createCommitment } from "@/services/externalSpend.service";
import { WRITE_ROLES, errorResponse } from "../shared";

/**
 * Alta de un compromiso, a mano o desde un contrato revisado
 * (`sourceDocumentId`, que queda aprobado). `{ tenantId, vendorName,
 * commitmentType, amount, currency, startDate, endDate, renewalDate?,
 * noticeDays?, autoRenew?, sourceDocumentId? }`.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => null);
        const tenantId = typeof body?.tenantId === "string" ? body.tenantId : "";
        if (!tenantId) throw new ExternalSpendError("invalid_input");
        await requireTenantTier(request, tenantId, "Business");
        const identity = await requireTenantRole(request, tenantId, WRITE_ROLES);

        const input = commitmentSchema.safeParse(body);
        if (!input.success) throw new ExternalSpendError("invalid_input");
        const id = await createCommitment(tenantId, identity.email, input.data);
        return NextResponse.json({ id }, { status: 201 });
    } catch (e) {
        return errorResponse(e, "POST /api/intelligence/external-spend/commitments");
    }
}
