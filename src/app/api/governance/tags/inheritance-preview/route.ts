import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { getAzureCredential } from "@/lib/azure";
import { analyzeMissingTags } from "@/services/tagInheritanceService";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const subscriptionId = searchParams.get("subscriptionId") || "All";
        const tagKeysRaw = searchParams.get("tagKeys");
        const tagKeys = tagKeysRaw ? tagKeysRaw.split(",").map(s => s.trim()).filter(Boolean) : undefined;
        const limit = Number(searchParams.get("limit") || 500);

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        let credential;
        try {
            credential = await getAzureCredential(tenantId);
        } catch (e: any) {
            return NextResponse.json({
                success: false,
                error: "No hay credenciales configuradas para este tenant.",
                hint: "Configurar el Service Principal en Admin → Configuración.",
            }, { status: 400 });
        }

        const rows = await analyzeMissingTags(credential, subscriptionId, { tagKeys, limit });

        return NextResponse.json({
            success: true,
            count: rows.length,
            rows,
            scope: { subscriptionId, tagKeys: tagKeys || null, limit },
        });
    } catch (err: any) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        }
        console.error("[tags/inheritance-preview] error", err);
        return NextResponse.json({
            success: false,
            error: err?.message || "Error inesperado al analizar tags.",
        }, { status: 500 });
    }
}
