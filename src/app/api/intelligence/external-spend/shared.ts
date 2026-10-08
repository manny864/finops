import { NextResponse } from "next/server";
import { AuthError } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import { ExternalSpendError } from "@/services/externalSpend.service";

/**
 * Lo común de las rutas de gasto externo. Los guards van en cada handler (los
 * exigen la regla `local/no-unauth-tenant-id` y `guardRutasApi.test.ts`):
 * leer, plan Business; subir, revisar y cargar compromisos, además Admin u
 * Owner del tenant, porque lo aprobado entra en los reportes.
 */
export const WRITE_ROLES = ["Admin", "Owner"];

/** `{ error, reason }` con el status del motivo: la UI traduce `reason`. */
export function errorResponse(e: unknown, context: string): NextResponse {
    if (e instanceof ExternalSpendError) return NextResponse.json({ error: e.message, reason: e.reason }, { status: e.status });
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return serverError(e, { context });
}

/** El id del segmento de la URL, o `null` si no es un entero positivo. */
export const parseId = (raw: string): number | null => (/^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null);
