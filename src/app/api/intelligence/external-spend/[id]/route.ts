import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { mockExternalSpendDocument } from "@/lib/externalSpendMock";
import {
    ExternalSpendError, approveDocument, getDocumentDetail, rejectDocument, reviewSchema, updateDocument,
} from "@/services/externalSpend.service";
import { WRITE_ROLES, errorResponse, parseId } from "../shared";

type Ctx = { params: Promise<{ id: string }> };

async function detail(tenantId: string, id: number): Promise<NextResponse> {
    const doc = await getDocumentDetail(tenantId, id);
    if (!doc) throw new ExternalSpendError("not_found");
    return NextResponse.json(doc);
}

/** El documento con sus líneas y lo que devolvió el modelo, para la revisión. */
export async function GET(request: NextRequest, { params }: Ctx) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId") || "";
        const id = parseId((await params).id);
        if (!tenantId || id === null) throw new ExternalSpendError("invalid_input");
        if (isMockTenant(tenantId)) {
            const doc = mockExternalSpendDocument(id);
            if (!doc) throw new ExternalSpendError("not_found");
            return NextResponse.json(doc);
        }
        await requireTenantTier(request, tenantId, "Business");
        return await detail(tenantId, id);
    } catch (e) {
        return errorResponse(e, "GET /api/intelligence/external-spend/[id]");
    }
}

/** Corrige la cabecera y las líneas (`{ tenantId, header, lines }`) y vuelve a validar. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
    try {
        const body = await request.json().catch(() => null);
        const tenantId = typeof body?.tenantId === "string" ? body.tenantId : "";
        const id = parseId((await params).id);
        if (!tenantId || id === null) throw new ExternalSpendError("invalid_input");
        await requireTenantTier(request, tenantId, "Business");
        await requireTenantRole(request, tenantId, WRITE_ROLES);

        const input = reviewSchema.safeParse(body);
        if (!input.success) throw new ExternalSpendError("invalid_input");
        await updateDocument(tenantId, id, input.data);
        return await detail(tenantId, id);
    } catch (e) {
        return errorResponse(e, "PATCH /api/intelligence/external-spend/[id]");
    }
}

/**
 * `{ tenantId, action: "approve" | "reject" }`. Aprobar una factura la suma a
 * los reportes de gasto externo; rechazar también deshace una aprobación.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
    try {
        const body = await request.json().catch(() => null);
        const tenantId = typeof body?.tenantId === "string" ? body.tenantId : "";
        const id = parseId((await params).id);
        if (!tenantId || id === null) throw new ExternalSpendError("invalid_input");
        await requireTenantTier(request, tenantId, "Business");
        const identity = await requireTenantRole(request, tenantId, WRITE_ROLES);

        if (body.action === "approve") await approveDocument(tenantId, id, identity.email);
        else if (body.action === "reject") await rejectDocument(tenantId, id, identity.email);
        else throw new ExternalSpendError("invalid_input");
        return await detail(tenantId, id);
    } catch (e) {
        return errorResponse(e, "POST /api/intelligence/external-spend/[id]");
    }
}
