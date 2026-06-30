import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { getAzureCredential } from "@/lib/azure";
import { applyTagInheritance, ApplyOp } from "@/services/tagInheritanceService";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, ops, dryRun } = body as {
            tenantId?: string;
            ops?: ApplyOp[];
            dryRun?: boolean;
        };

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }
        if (!Array.isArray(ops) || ops.length === 0) {
            return NextResponse.json({ success: false, error: "Faltan operaciones (ops)" }, { status: 400 });
        }
        for (const op of ops) {
            if (!op.resourceId || !op.tagsToMerge || typeof op.tagsToMerge !== "object") {
                return NextResponse.json({
                    success: false,
                    error: "Op inválida: requiere resourceId y tagsToMerge.",
                }, { status: 400 });
            }
        }
        if (ops.length > 200) {
            return NextResponse.json({
                success: false,
                error: "Demasiadas ops en un solo batch (máx 200). Dividir en múltiples requests.",
            }, { status: 400 });
        }

        // Solo Admin / Owner pueden aplicar tags (mutación en Azure)
        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        let credential;
        try {
            credential = await getAzureCredential(tenantId);
        } catch (e: any) {
            return NextResponse.json({
                success: false,
                error: "No hay credenciales configuradas para este tenant.",
            }, { status: 400 });
        }

        const results = await applyTagInheritance(credential, ops, { dryRun: !!dryRun });

        const success = results.filter(r => r.success).length;
        const failed = results.length - success;

        return NextResponse.json({
            success: true,
            dryRun: !!dryRun,
            applied: success,
            failed,
            results,
        });
    } catch (err: any) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        }
        console.error("[tags/apply-inheritance] error", err);
        return NextResponse.json({
            success: false,
            error: err?.message || "Error inesperado al aplicar tags.",
        }, { status: 500 });
    }
}
