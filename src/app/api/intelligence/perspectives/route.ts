import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { tenants as mockTenants } from "@/lib/tenants";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { listarPerspectivas, guardarReglas, eliminarPerspectiva } from "@/services/perspectivesData.service";
import type { ReglaPerspectiva, TipoRegla } from "@/services/perspectives.service";

/**
 * MEJ-34 — CRUD de Perspectives.
 *
 * RBAC: leer exige pertenencia al tenant; crear, editar y borrar exigen
 * Admin/Owner, porque una Perspective define cómo se le reparte el gasto a toda
 * la organización.
 */

const TIPOS: TipoRegla[] = ["tag", "name_pattern", "subscription", "resource_group", "resource_type"];

async function exigirEnterprise(tenantId: string): Promise<NextResponse | null> {
    let tier = "Professional";
    if (isMockTenant(tenantId)) {
        tier = mockTenants.find((t) => t.id === tenantId)?.tier || "Professional";
    } else {
        const [rows] = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
        if (Array.isArray(rows) && rows.length > 0) tier = (rows[0] as { tier?: string }).tier || "Professional";
    }
    if (!hasAccess(tier, "Enterprise")) {
        return NextResponse.json({ error: "Funcionalidad requiere plan Enterprise o superior." }, { status: 403 });
    }
    return null;
}

/**
 * Valida las reglas que manda el cliente. El `match_type` va contra una lista
 * blanca: entra a un ENUM de MySQL y un valor fuera de la lista tira un error de
 * base en vez de un 400 entendible.
 */
function validarReglas(crudas: unknown): { reglas: ReglaPerspectiva[] } | { error: string } {
    if (!Array.isArray(crudas)) return { error: "reglas debe ser un arreglo" };
    const reglas: ReglaPerspectiva[] = [];
    for (const [i, r] of crudas.entries()) {
        const grupo = String((r as any)?.grupo || "").trim();
        const tipo = String((r as any)?.tipo || "") as TipoRegla;
        const valor = String((r as any)?.valor || "").trim();
        if (!grupo) return { error: `regla ${i + 1}: falta el grupo` };
        if (!TIPOS.includes(tipo)) return { error: `regla ${i + 1}: tipo inválido` };
        if (!valor) return { error: `regla ${i + 1}: falta el valor` };
        if (tipo === "tag" && !String((r as any)?.clave || "").trim()) {
            return { error: `regla ${i + 1}: una regla por etiqueta necesita la clave` };
        }
        reglas.push({ grupo, tipo, clave: (r as any)?.clave ?? null, valor, orden: i });
    }
    return { reglas };
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        await requireTenantAccess(request, tenantId);
        const bloqueo = await exigirEnterprise(tenantId);
        if (bloqueo) return bloqueo;
        return NextResponse.json({ success: true, perspectives: await listarPerspectivas(tenantId) });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error("[perspectives] GET:", errorMessage(e));
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        await requireTenantRole(request, tenantId, ["ADMIN", "OWNER"]);
        const bloqueo = await exigirEnterprise(tenantId);
        if (bloqueo) return bloqueo;

        const body = await request.json().catch(() => ({}));
        const name = String(body?.name || "").trim();
        if (!name) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
        const validadas = validarReglas(body?.reglas ?? []);
        if ("error" in validadas) return NextResponse.json({ error: validadas.error }, { status: 400 });

        const [res] = await pool.query<any>(
            `INSERT INTO Perspectives (tenant_id, name, description) VALUES (?, ?, ?)`,
            [tenantId, name, String(body?.description || "").trim() || null],
        );
        const id = (res as { insertId: number }).insertId;
        await guardarReglas(id, validadas.reglas);
        return NextResponse.json({ success: true, id });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        // Nombre repetido: lo corta el UNIQUE, y el mensaje tiene que decir qué
        // pasó en vez de un 500 genérico.
        if (/ER_DUP_ENTRY/i.test(errorMessage(e) || "")) {
            return NextResponse.json({ error: "Ya existe una Perspective con ese nombre" }, { status: 409 });
        }
        console.error("[perspectives] POST:", errorMessage(e));
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const id = Number(request.nextUrl.searchParams.get("id"));
        if (!tenantId || !Number.isInteger(id)) return NextResponse.json({ error: "Faltan tenantId o id" }, { status: 400 });
        await requireTenantRole(request, tenantId, ["ADMIN", "OWNER"]);
        const bloqueo = await exigirEnterprise(tenantId);
        if (bloqueo) return bloqueo;

        // La pertenencia se comprueba con el tenant en el WHERE y no confiando
        // en el id: sin esto, un Admin de un tenant edita las Perspectives de otro.
        const [propias] = await pool.query<any[]>(
            `SELECT id FROM Perspectives WHERE id = ? AND tenant_id = ? LIMIT 1`, [id, tenantId],
        );
        if (!propias?.length) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

        const body = await request.json().catch(() => ({}));
        const validadas = validarReglas(body?.reglas ?? []);
        if ("error" in validadas) return NextResponse.json({ error: validadas.error }, { status: 400 });
        if (body?.name || body?.description !== undefined) {
            await pool.query(
                `UPDATE Perspectives SET name = COALESCE(?, name), description = ? WHERE id = ? AND tenant_id = ?`,
                [String(body?.name || "").trim() || null, String(body?.description || "").trim() || null, id, tenantId],
            );
        }
        await guardarReglas(id, validadas.reglas);
        return NextResponse.json({ success: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error("[perspectives] PUT:", errorMessage(e));
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const id = Number(request.nextUrl.searchParams.get("id"));
        if (!tenantId || !Number.isInteger(id)) return NextResponse.json({ error: "Faltan tenantId o id" }, { status: 400 });
        await requireTenantRole(request, tenantId, ["ADMIN", "OWNER"]);
        if (!(await eliminarPerspectiva(tenantId, id))) {
            return NextResponse.json({ error: "No encontrada" }, { status: 404 });
        }
        return NextResponse.json({ success: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error("[perspectives] DELETE:", errorMessage(e));
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}
