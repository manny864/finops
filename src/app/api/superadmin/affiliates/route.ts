/**
 * API del programa de afiliados (SuperAdmin).
 * Auth: requireSuperAdmin — son datos financieros de terceros y altas que
 * habilitan a cobrar comisión, así que no hay variante mock ni tenant-scoped.
 *
 * GET  ?view=affiliates          → afiliados con sus métricas agregadas
 * GET  ?view=commissions[&...]   → historial de comisiones
 * POST { action: "create", ... } → alta de afiliado
 * POST { action: "setStatus", ids, status } → aprobar / liquidar comisiones
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import {
    listarAfiliados,
    listarComisiones,
    crearAfiliado,
    actualizarEstadoComisiones,
    type EstadoComision,
} from "@/services/affiliates.service";

const ESTADOS: EstadoComision[] = ["PENDING", "APPROVED", "PAID", "REVERSED", "CANCELLED"];

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
        const { searchParams } = new URL(request.url);

        if (searchParams.get("view") === "commissions") {
            const estadoCrudo = searchParams.get("status");
            const estado = ESTADOS.includes(estadoCrudo as EstadoComision)
                ? (estadoCrudo as EstadoComision)
                : undefined;
            const comisiones = await listarComisiones({
                affiliateId: searchParams.get("affiliateId") || undefined,
                status: estado,
                limite: Number(searchParams.get("limit")) || undefined,
            });
            return NextResponse.json({ success: true, commissions: comisiones });
        }

        return NextResponse.json({ success: true, affiliates: await listarAfiliados() });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[superadmin/affiliates] GET:", errorMessage(error));
        return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
    }
}

export async function POST(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
        const body = await request.json().catch(() => ({}));

        if (body?.action === "create") {
            const { id } = await crearAfiliado(body);
            return NextResponse.json({ success: true, id });
        }

        if (body?.action === "setStatus") {
            if (!ESTADOS.includes(body?.status)) {
                return NextResponse.json({ error: "Estado de comisión inválido" }, { status: 400 });
            }
            const { actualizadas } = await actualizarEstadoComisiones(body.ids, body.status);
            return NextResponse.json({ success: true, updated: actualizadas });
        }

        return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        // Las validaciones de crearAfiliado y los choques de UNIQUE (código o
        // email repetido) son error del operador, no del servidor.
        const msg = errorMessage(error);
        const esDuplicado = /ER_DUP_ENTRY|Duplicate entry/i.test(msg);
        if (esDuplicado) {
            return NextResponse.json({ error: "Ya existe un afiliado con ese email o código de referido." }, { status: 409 });
        }
        console.error("[superadmin/affiliates] POST:", msg);
        return NextResponse.json({ error: msg }, { status: errorStatus(error) });
    }
}
