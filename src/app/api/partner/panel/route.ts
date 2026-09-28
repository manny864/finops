/**
 * El panel del afiliado. RUTA PÚBLICA: no pasa por Entra ID.
 *
 * La credencial es el token del enlace, que viaja en `Authorization: Bearer`.
 * NO se acepta por query string a propósito: ahí quedaría en los logs del
 * servidor, en el `Referer` hacia cualquier recurso externo y en el historial
 * del navegador. El enlace que recibe el partner lo lleva en el FRAGMENTO
 * (`#k=...`), que nunca sale del navegador, y la página lo pasa a este header.
 *
 * Devuelve SÓLO los números del afiliado que presentó el token. Qué entra y qué
 * no está decidido en `affiliatePortal.service.ts`, que es donde vive la
 * proyección.
 */
import { NextRequest, NextResponse } from "next/server";
import { errorMessage } from "@/lib/apiErrors";
import rateLimiter from "@/lib/rateLimiter";
import { afiliadoPorToken, panelDelAfiliado } from "@/services/affiliatePortal.service";

/**
 * Techo por IP. No es contra la fuerza bruta —un token de 32 bytes no se
 * adivina— sino contra el abuso de un endpoint sin sesión.
 */
const PETICIONES_POR_MINUTO = 30;

function ipDe(request: NextRequest): string {
    const fwd = request.headers.get("x-forwarded-for");
    return (fwd ? fwd.split(",")[0] : "").trim() || "sin-ip";
}

export async function GET(request: NextRequest) {
    try {
        const { allowed } = await rateLimiter.checkByKeyDistributed(
            `partner-panel:${ipDe(request)}`, PETICIONES_POR_MINUTO,
        );
        if (!allowed) {
            return NextResponse.json({ error: "Demasiadas peticiones." }, { status: 429 });
        }

        const auth = request.headers.get("authorization") || "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

        const afiliado = await afiliadoPorToken(token);
        // Un token inválido y uno de un afiliado suspendido dan LA MISMA
        // respuesta: distinguirlos le confirmaría a un tercero que ese enlace
        // existió.
        if (!afiliado) {
            return NextResponse.json({ error: "Enlace inválido o revocado." }, { status: 401 });
        }

        return NextResponse.json({ success: true, panel: await panelDelAfiliado(afiliado) });
    } catch (error) {
        console.error("[partner/panel] GET:", errorMessage(error));
        return NextResponse.json({ error: "No se pudo cargar el panel." }, { status: 500 });
    }
}
