import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage } from "@/lib/apiErrors";
import {
    getAnomalyExplanation,
    normalizeExplanationLocale,
    saveExplanationFeedback,
    type ExplainableAnomaly,
} from "@/services/anomalyExplanation.service";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const anomalyId = async ({ params }: Ctx) => {
    const id = Number((await params).id);
    return Number.isInteger(id) && id > 0 ? id : null;
};

function fail(e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[anomalies/explanation]", errorMessage(e));
    return NextResponse.json({ error: "No se pudo procesar la explicación." }, { status: 500 });
}

/**
 * Explicación con IA de una anomalía (propuesta de IA, Fase 1b). Se pide al
 * abrir la anomalía, nunca con el listado: cada una puede costar una llamada.
 * Un denegado del gate responde 200 con `aiAvailable: false` y el motivo.
 */
export async function GET(request: NextRequest, ctx: Ctx) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const id = await anomalyId(ctx);
        if (!tenantId || !id) {
            return NextResponse.json({ error: "Faltan tenantId o un id de anomalía válido." }, { status: 400 });
        }
        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT id, date, amount, expected_amount, z_score, top_contributors, root_cause_facts
               FROM Anomalies WHERE id = ? AND tenant_id = ? LIMIT 1`,
            [id, tenantId]
        );
        if (!rows[0]) return NextResponse.json({ error: "Anomalía no encontrada." }, { status: 404 });

        const locale = normalizeExplanationLocale(
            request.nextUrl.searchParams.get("locale") || request.headers.get("accept-language")
        );
        const result = await getAnomalyExplanation({
            tenantId,
            userEmail: identity.email,
            locale,
            anomaly: rows[0] as ExplainableAnomaly,
        });
        return NextResponse.json({ success: true, ...result });
    } catch (e) {
        return fail(e);
    }
}

/**
 * Pulgar arriba o abajo sobre la explicación que el usuario vio: va en la misma
 * ruta y no en `/feedback` porque comparte la validación del id y del tenant.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
    try {
        const id = await anomalyId(ctx);
        const body = await request.json().catch(() => null);
        const { tenantId, locale, factsHash, feedback } = body ?? {};
        if (
            !id ||
            typeof tenantId !== "string" ||
            !tenantId ||
            typeof factsHash !== "string" ||
            !/^[0-9a-f]{64}$/.test(factsHash) ||
            (feedback !== "up" && feedback !== "down")
        ) {
            return NextResponse.json({ error: "Faltan datos del feedback." }, { status: 400 });
        }
        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
        const saved = await saveExplanationFeedback({
            tenantId,
            anomalyId: id,
            locale: normalizeExplanationLocale(locale),
            factsHash,
            feedback,
            userEmail: identity.email,
        });
        if (!saved) return NextResponse.json({ error: "Explicación no encontrada." }, { status: 404 });
        return NextResponse.json({ success: true });
    } catch (e) {
        return fail(e);
    }
}
