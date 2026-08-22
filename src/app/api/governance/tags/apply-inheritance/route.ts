import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { getAzureCredential } from "@/lib/azure";
import { applyTagInheritance, ApplyOp } from "@/services/tagInheritanceService";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

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
        // Remediación de tags (misma feature/tier que "Editar Etiquetas" en
        // TagManager.tsx, ver canRemediateTags en tierLogic.ts): habilitada
        // desde Business. El dry-run no muta Azure, así que no se gatea.
        if (!dryRun) {
            await requireTenantTier(request, tenantId, "Business");
        }

        let credential;
        try {
            credential = await getAzureCredential(tenantId);
        } catch {
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
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        }
        console.error("[tags/apply-inheritance] error", err);
        return NextResponse.json({
            success: false,
            error: errorMessage(err) || "Error inesperado al aplicar tags.",
        }, { status: 500 });
    }
}
