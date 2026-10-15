import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import { ExternalSpendError, getDocumentFile } from "@/services/externalSpend.service";
import { errorResponse, parseId } from "../../shared";
import { attachmentDownloadHeaders } from "@/lib/attachmentDownload";

/**
 * El original, para compararlo con lo extraído. Siempre como adjunto y con
 * nosniff, como los adjuntos de soporte. 410 cuando la retención ya lo borró;
 * 503 si el storage no responde, que es transitorio y no significa que no esté.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId") || "";
        const id = parseId((await params).id);
        if (!tenantId || id === null) throw new ExternalSpendError("invalid_input");
        await requireTenantTier(request, tenantId, "Business");

        let file;
        try {
            file = await getDocumentFile(tenantId, id);
        } catch (e) {
            if (e instanceof ExternalSpendError) throw e;
            return serverError(e, {
                context: "GET /api/intelligence/external-spend/[id]/file",
                message: "No se pudo leer el original. Probá de nuevo en unos minutos.",
                status: 503,
            });
        }
        if (!file) return NextResponse.json({ error: "El original ya no está disponible (retención de 365 días)." }, { status: 410 });
        return new NextResponse(new Uint8Array(file.bytes), {
            headers: attachmentDownloadHeaders(file.name, file.mime),
        });
    } catch (e) {
        return errorResponse(e, "GET /api/intelligence/external-spend/[id]/file");
    }
}
