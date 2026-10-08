import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { mockExternalSpendOverview } from "@/lib/externalSpendMock";
import { ExternalSpendError, getOverview, uploadDocument } from "@/services/externalSpend.service";
import { EXTERNAL_SPEND_DOC_TYPES, EXTERNAL_SPEND_MAX_BYTES, type ExternalSpendDocType } from "@/types/externalSpend.types";
import { WRITE_ROLES, errorResponse } from "./shared";

/** Lo que carga la pantalla: documentos, compromisos, resumen de lo aprobado y si se puede subir. */
export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId") || "";
        if (!tenantId) throw new ExternalSpendError("invalid_input");
        // La demo antes que el guard, como el resto de las pantallas (MEJ-03).
        if (isMockTenant(tenantId)) return NextResponse.json(mockExternalSpendOverview());
        await requireTenantTier(request, tenantId, "Business");
        return NextResponse.json(await getOverview(tenantId));
    } catch (e) {
        return errorResponse(e, "GET /api/intelligence/external-spend");
    }
}

/**
 * Sube una factura o un contrato (multipart: `tenantId`, `type`, `file`) y lo
 * manda a analizar. Responde con el documento: para revisar si el análisis
 * terminó en unos segundos, o en análisis si lo sigue el cron.
 */
export async function POST(request: NextRequest) {
    try {
        const form = await request.formData().catch(() => null);
        const tenantId = typeof form?.get("tenantId") === "string" ? (form!.get("tenantId") as string) : "";
        if (!form || !tenantId) throw new ExternalSpendError("invalid_input");
        await requireTenantTier(request, tenantId, "Business");
        const identity = await requireTenantRole(request, tenantId, WRITE_ROLES);

        const type = form.get("type") as ExternalSpendDocType;
        const file = form.get("file");
        if (!EXTERNAL_SPEND_DOC_TYPES.includes(type) || !(file instanceof File)) throw new ExternalSpendError("invalid_input");
        if (file.size > EXTERNAL_SPEND_MAX_BYTES) throw new ExternalSpendError("file_too_large");

        const doc = await uploadDocument({
            tenantId,
            userEmail: identity.email,
            docType: type,
            originalName: file.name || "documento",
            bytes: Buffer.from(await file.arrayBuffer()),
        });
        return NextResponse.json(doc, { status: 201 });
    } catch (e) {
        return errorResponse(e, "POST /api/intelligence/external-spend");
    }
}
