/**
 * POST /api/v1/shift-left/estimate — PR Cost Estimator (MEJ-20).
 *
 * Recibe la salida de `terraform show -json <planfile>` y devuelve el delta de
 * costo mensual que ese plan provocaría. Pensado para correr desde CI y comentar
 * el resultado en el Pull Request, que es cuando la conversación de costo todavía
 * es barata: hoy la plataforma detecta el gasto recién cuando el recurso ya está
 * provisionado y costando.
 *
 * Auth: API Key pública (`verifyApiKey`) con scope `write:shift-left`, más el
 * rate limit por clave. Sigue el mismo contrato de error que el resto de /api/v1.
 *
 * El scope es NUEVO: ninguna clave existente lo tiene, así que el endpoint
 * arranca cerrado y hay que habilitarlo por clave a propósito. Es deliberado —
 * una clave de lectura de costos no debería poder escribir filas de estimación.
 */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { verifyApiKey, requireScope } from "@/lib/publicApiAuth";
import rateLimiter from "@/lib/rateLimiter";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import { estimarPlan } from "@/services/iacCostEstimator.service";

export const dynamic = "force-dynamic";

/**
 * Un plan de terraform de un monorepo grande puede pesar varios MB. Se corta en
 * 6 MB: por encima de eso el parseo bloquea el event loop lo suficiente como
 * para afectar a las pantallas interactivas, y un plan de ese tamaño ya no es un
 * PR que alguien vaya a revisar.
 */
const MAX_BYTES = 6 * 1024 * 1024;

function error(code: string, message: string, status: number, requestId: string) {
    return NextResponse.json(
        { error: { code, message, request_id: requestId } },
        { status, headers: { "X-Request-Id": requestId } }
    );
}

type Gate = { status: "NOT_EVALUATED" | "OK" | "EXCEEDED"; threshold: number | null };

/**
 * Budget Gate del repo, si tiene uno configurado en la plataforma
 * (`IacBudgetGates`). Sin fila no hay gate: se informa el costo y no se bloquea
 * nada, que es lo que significa 'NOT_EVALUATED'.
 *
 * FALLA ABIERTO a propósito. Si MySQL no responde, el gate queda sin evaluar en
 * vez de bloquear: esto corre en el CI de otra gente, y voltearle un PR por un
 * problema de nuestra base —cuando el umbral podría no existir siquiera— es
 * peor que dejar pasar un PR caro. Es un control de costo, no de seguridad.
 */
async function evaluarGate(tenantId: string, repository: string, delta: number): Promise<Gate> {
    if (!repository) return { status: "NOT_EVALUATED", threshold: null };
    try {
        const [filas]: any = await pool.query(
            `SELECT threshold_usd FROM IacBudgetGates
              WHERE tenant_id = ? AND repository = ?
              LIMIT 1`,
            [tenantId, repository]
        );
        const crudo = filas?.[0]?.threshold_usd;
        if (crudo === undefined || crudo === null) return { status: "NOT_EVALUATED", threshold: null };

        // DECIMAL vuelve como string desde mysql2; sin Number() la comparación
        // sería lexicográfica y "9" > "10".
        const umbral = Number(crudo);
        if (!Number.isFinite(umbral)) return { status: "NOT_EVALUATED", threshold: null };
        return { status: delta > umbral ? "EXCEEDED" : "OK", threshold: umbral };
    } catch (e) {
        console.error("[shift-left] no se pudo leer el Budget Gate:", errorMessage(e));
        return { status: "NOT_EVALUATED", threshold: null };
    }
}

export async function POST(request: NextRequest) {
    const requestId = uuidv4();
    try {
        const authResult = await verifyApiKey(request);
        if (!authResult) {
            return error("unauthorized", "Invalid or missing API key", 401, requestId);
        }

        try {
            requireScope(authResult, "write:shift-left");
        } catch (e) {
            return error("insufficient_scope", errorMessage(e), 403, requestId);
        }

        const { allowed } = await rateLimiter.checkByKeyDistributed(
            `apikey:${authResult.keyId}`,
            authResult.rateLimitPerMin
        );
        if (!allowed) {
            return error("rate_limit_exceeded", "Rate limit exceeded", 429, requestId);
        }

        const crudo = await request.text();
        if (crudo.length > MAX_BYTES) {
            return error(
                "payload_too_large",
                `El plan supera los ${MAX_BYTES / 1024 / 1024} MB`,
                413,
                requestId
            );
        }

        let cuerpo: any;
        try {
            cuerpo = JSON.parse(crudo);
        } catch {
            return error("invalid_json", "El cuerpo no es JSON válido", 400, requestId);
        }

        // Se acepta el plan pelado o envuelto en {plan, repository, ...}. La CLI
        // de terraform escupe el plan directo, y obligar a envolverlo seria
        // pedirle a cada usuario que escriba un jq en su pipeline.
        const plan = cuerpo?.plan ?? cuerpo;
        if (!plan || !Array.isArray(plan.resource_changes)) {
            return error(
                "invalid_plan",
                "Falta `resource_changes`. Se espera la salida de `terraform show -json <planfile>`.",
                400,
                requestId
            );
        }

        const estimacion = await estimarPlan(plan);

        const repository = String(cuerpo?.repository || "").slice(0, 255);
        const gate = await evaluarGate(authResult.tenantId, repository, estimacion.delta);

        // El registro es best-effort: la estimación ya está calculada y es lo que
        // el CI está esperando para comentar el PR. Si MySQL no está, se pierde
        // una fila de historial, no la respuesta.
        if (repository) {
            try {
                await pool.query(
                    `INSERT INTO IacCostEstimations
                       (tenant_id, repository, pr_number, commit_sha, author,
                        current_monthly_cost_usd, projected_monthly_cost_usd, delta_cost_usd,
                        resources_priced, resources_unpriced, gate_status, detail_json)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        authResult.tenantId,
                        repository,
                        Number.isFinite(Number(cuerpo?.pr_number)) ? Number(cuerpo.pr_number) : null,
                        String(cuerpo?.commit_sha || "").slice(0, 64) || null,
                        String(cuerpo?.author || "").slice(0, 255) || null,
                        estimacion.mensualActual,
                        estimacion.mensualProyectado,
                        estimacion.delta,
                        estimacion.lineas.length - estimacion.sinTarifar - estimacion.sinCosto,
                        estimacion.sinTarifar,
                        gate.status,
                        JSON.stringify(estimacion.lineas),
                    ]
                );
            } catch (e) {
                console.error(`[shift-left] no se pudo registrar la estimación (${requestId}):`, errorMessage(e));
            }
        }

        return NextResponse.json(
            {
                data: {
                    current_monthly_cost_usd: estimacion.mensualActual,
                    projected_monthly_cost_usd: estimacion.mensualProyectado,
                    delta_cost_usd: estimacion.delta,
                    currency: "USD",
                    resources_unpriced: estimacion.sinTarifar,
                    resources_free: estimacion.sinCosto,
                    budget_gate: { status: gate.status, threshold_usd: gate.threshold },
                    lines: estimacion.lineas,
                },
                request_id: requestId,
            },
            { headers: { "X-Request-Id": requestId } }
        );
    } catch (e) {
        console.error(`[/api/v1/shift-left/estimate] ${requestId}:`, errorMessage(e));
        return error("internal_error", "Error interno del servidor", 500, requestId);
    }
}
