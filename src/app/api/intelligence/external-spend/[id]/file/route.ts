import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier } from "@/lib/requestAuth";
import { ExternalSpendError, getDocumentFile } from "@/services/externalSpend.service";
import { errorResponse, parseId } from "../../shared";

/**
 * El original, para compararlo con lo extraído. Siempre como adjunto y con
 * nosniff, como los adjuntos de soporte. 410 cuando la retención ya lo borró.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId") || "";
        const id = parseId((await params).id);
        if (!tenantId || id === null) throw new ExternalSpendError("invalid_input");
        await requireTenantTier(request, tenantId, "Business");

        const file = await getDocumentFile(tenantId, id);
        if (!file) return NextResponse.json({ error: "El original ya no está disponible (retención de 365 días)." }, { status: 410 });
        const safeName = file.name.replace(/[^\w.\- ]/g, "_");
        return new NextResponse(new Uint8Array(file.bytes), {
            headers: {
                "Content-Type": file.mime,
                "Content-Disposition": `attachment; filename="${safeName}"`,
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
            },
        });
    } catch (e) {
        return errorResponse(e, "GET /api/intelligence/external-spend/[id]/file");
    }
}
