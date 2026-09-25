import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { filasDeCosto, listarPerspectivas } from "@/services/perspectivesData.service";
import { repartir, type ReglaPerspectiva, type TipoRegla } from "@/services/perspectives.service";

/**
 * MEJ-34 — el reparto del gasto de una Perspective.
 *
 * `GET`  con `?id=` usa las reglas guardadas.
 * `POST` con `{reglas}` evalúa reglas SIN guardar: es la vista previa del
 *        criterio 5 —reordenar y ver el reparto antes de confirmar—. Sale casi
 *        gratis porque el evaluador es puro y corre en memoria sobre las mismas
 *        filas; no hay un segundo camino que pueda dar otro número.
 */

const TIPOS: TipoRegla[] = ["tag", "name_pattern", "subscription", "resource_group", "resource_type"];

function periodo(request: NextRequest): { desde: string; hasta: string } {
    const sp = request.nextUrl.searchParams;
    const hoy = new Date();
    const porDefectoDesde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const valido = (s: string | null) => (s && !Number.isNaN(new Date(s).getTime()) ? s.slice(0, 10) : null);
    return {
        desde: valido(sp.get("from")) || iso(porDefectoDesde),
        hasta: valido(sp.get("to")) || iso(hoy),
    };
}

function sanear(crudas: unknown): ReglaPerspectiva[] {
    if (!Array.isArray(crudas)) return [];
    return crudas
        .map((r, i) => ({
            grupo: String((r as any)?.grupo || "").trim(),
            tipo: String((r as any)?.tipo || "") as TipoRegla,
            clave: (r as any)?.clave ?? null,
            valor: String((r as any)?.valor || "").trim(),
            orden: i,
        }))
        .filter((r) => r.grupo && r.valor && TIPOS.includes(r.tipo));
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const id = Number(request.nextUrl.searchParams.get("id"));
        if (!tenantId || !Number.isInteger(id)) return NextResponse.json({ error: "Faltan tenantId o id" }, { status: 400 });
        await requireTenantAccess(request, tenantId);

        // Se busca entre las del tenant: asi el id de otro tenant no resuelve.
        const perspectiva = (await listarPerspectivas(tenantId)).find((p) => p.id === id);
        if (!perspectiva) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

        const { desde, hasta } = periodo(request);
        const filas = await filasDeCosto(tenantId, desde, hasta, request.nextUrl.searchParams.get("subscriptionId") || undefined);
        return NextResponse.json({
            success: true,
            perspective: { id: perspectiva.id, name: perspectiva.name },
            periodo: { desde, hasta },
            reparto: repartir(filas, perspectiva.reglas),
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error("[perspectives/breakdown] GET:", errorMessage(e));
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        // Vista previa: es una LECTURA de costo con reglas hipoteticas, no
        // guarda nada, asi que alcanza con pertenencia al tenant.
        await requireTenantAccess(request, tenantId);

        const body = await request.json().catch(() => ({}));
        const { desde, hasta } = periodo(request);
        const filas = await filasDeCosto(tenantId, desde, hasta, request.nextUrl.searchParams.get("subscriptionId") || undefined);
        return NextResponse.json({
            success: true,
            periodo: { desde, hasta },
            reparto: repartir(filas, sanear(body?.reglas)),
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error("[perspectives/breakdown] POST:", errorMessage(e));
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}
