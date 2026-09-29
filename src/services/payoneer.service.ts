/**
 * Cliente de Payoneer Mass Payout v4 — alta de beneficiarios.
 *
 * VERIFICADO CONTRA LA DOCUMENTACIÓN el 2026-09-28, no de memoria:
 * https://developer.payoneer.com/docs/mass-payouts-and-services.html
 *
 *   - Token: `POST {auth}/api/v2/oauth2/token`, con
 *     `Authorization: Basic base64(client_id:client_secret)` y el cuerpo en
 *     `application/x-www-form-urlencoded` con `grant_type=client_credentials`
 *     y `scope`. Devuelve `access_token` y `expires_in` (unos 30 días).
 *   - Alta: `POST {api}/v4/programs/{program_id}/payees/registration-link`,
 *     con el token como Bearer. Pide `payee_id` y `redirect_url`; devuelve el
 *     enlace único de registro, válido para UN alta.
 *
 * LO QUE ESTE ARCHIVO NO HACE: enviar pagos. El alta es el primer paso y el
 * único que se puede probar sin fondear la cuenta; el envío del lote entra
 * después, sobre las corridas de `payoutRuns.service`.
 */

import { errorMessage } from "@/lib/apiErrors";

export interface ConfigPayoneer {
    clientId: string;
    clientSecret: string;
    programId: string;
    /** `sandbox` mientras no haya credenciales de producción. */
    entorno: "sandbox" | "production";
}

/**
 * La configuración, o `null` si falta algo.
 *
 * Devuelve null en vez de tirar: que Payoneer no esté configurado es el estado
 * NORMAL hasta que alguien pida las credenciales, y el panel tiene que poder
 * decirlo en vez de romperse.
 */
export function configDePayoneer(): ConfigPayoneer | null {
    const clientId = process.env.PAYONEER_CLIENT_ID;
    const clientSecret = process.env.PAYONEER_CLIENT_SECRET;
    const programId = process.env.PAYONEER_PROGRAM_ID;
    if (!clientId || !clientSecret || !programId) return null;
    return {
        clientId,
        clientSecret,
        programId,
        // Cualquier cosa que no sea exactamente "production" es sandbox. El
        // default tiene que ser el que no mueve plata real.
        entorno: process.env.PAYONEER_ENV === "production" ? "production" : "sandbox",
    };
}

function urls(entorno: ConfigPayoneer["entorno"]) {
    return entorno === "production"
        ? { auth: "https://login.payoneer.com", api: "https://api.payoneer.com" }
        : { auth: "https://login.sandbox.payoneer.com", api: "https://api.sandbox.payoneer.com" };
}

/**
 * ponytail: el token se cachea EN MEMORIA del proceso. Vale ~30 días, así que
 * un reinicio del contenedor cuesta una llamada de más y nada más. Si algún día
 * hay varias réplicas pidiendo tokens a la vez y eso molesta, el lugar es Redis
 * —que ya está— con la misma forma.
 */
let tokenEnMemoria: { valor: string; venceEn: number } | null = null;

/** Margen antes del vencimiento. Un token que vence en el medio de un lote es peor que pedir uno de más. */
const MARGEN_MS = 24 * 60 * 60 * 1000;

export async function tokenDeAplicacion(config: ConfigPayoneer): Promise<string> {
    if (tokenEnMemoria && tokenEnMemoria.venceEn - MARGEN_MS > Date.now()) return tokenEnMemoria.valor;

    const { auth } = urls(config.entorno);
    const basico = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const res = await fetch(`${auth}/api/v2/oauth2/token`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${basico}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "read write" }),
    });
    const cuerpo = await res.json().catch(() => ({} as any));
    if (!res.ok || !cuerpo?.access_token) {
        // Sin el secreto en el mensaje: esto va a los logs.
        throw new Error(
            `Payoneer no devolvió token (HTTP ${res.status}): ${cuerpo?.error_description || cuerpo?.error || "sin detalle"}`,
        );
    }
    const duracionMs = (Number(cuerpo.expires_in) || 0) * 1000;
    tokenEnMemoria = { valor: cuerpo.access_token, venceEn: Date.now() + duracionMs };
    return cuerpo.access_token;
}

/** Para los tests y para forzar la renovación tras rotar credenciales. */
export function olvidarToken(): void {
    tokenEnMemoria = null;
}

export interface Beneficiario {
    id: string;
    nombre: string;
    email: string;
}

export interface AltaDePayoneer {
    payeeId: string;
    registrationLink: string;
}

/**
 * `payee_id` a partir de nuestro identificador.
 *
 * Lleva prefijo por tipo porque afiliados y comerciales viven en tablas
 * distintas y sus ids podrían chocar; del lado de Payoneer es un espacio de
 * nombres solo. `<= 64` para entrar en la columna.
 */
export function payeeIdDe(tipo: "affiliate" | "sales_rep", id: string): string {
    return `${tipo === "sales_rep" ? "rep" : "aff"}-${id}`.slice(0, 64);
}

/**
 * Pide el enlace de alta de un beneficiario.
 *
 * `redirect_url` es a dónde vuelve la persona al terminar. Se le manda nuestra
 * página de gracias y no el panel: el panel necesita el token del enlace, que
 * Payoneer no tiene por qué conocer ni reenviar.
 */
export async function crearEnlaceDeRegistro(params: {
    config: ConfigPayoneer;
    tipo: "affiliate" | "sales_rep";
    beneficiario: Beneficiario;
    redirectUrl: string;
}): Promise<AltaDePayoneer> {
    const { config, tipo, beneficiario, redirectUrl } = params;
    const token = await tokenDeAplicacion(config);
    const { api } = urls(config.entorno);
    const payeeId = payeeIdDe(tipo, beneficiario.id);

    // El nombre viene como texto libre de nuestra ficha. Payoneer pide nombre y
    // apellido por separado; lo que no se pueda partir va entero en el primero
    // y la persona lo corrige en el formulario —por eso NO se bloquean los
    // campos de nombre con `lock_type`.
    const partes = beneficiario.nombre.trim().split(/\s+/);
    const nombre = partes[0] || beneficiario.nombre;
    const apellido = partes.slice(1).join(" ") || "-";

    const res = await fetch(`${api}/v4/programs/${encodeURIComponent(config.programId)}/payees/registration-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            payee_id: payeeId,
            // Mismo valor por payee: la documentación lo pide así porque es lo
            // que los webhooks referencian para esa persona.
            client_session_id: payeeId.slice(0, 50),
            redirect_url: redirectUrl,
            redirect_time: 0,
            payout_methods: ["BankTransfer"],
            payee: {
                type: "Individual",
                contact: { first_name: nombre, last_name: apellido, email: beneficiario.email },
            },
        }),
    });

    const cuerpo = await res.json().catch(() => ({} as any));
    if (!res.ok) {
        throw new Error(
            `Payoneer rechazó el alta (HTTP ${res.status}): ${cuerpo?.error_description || cuerpo?.description || "sin detalle"}`,
        );
    }

    // La documentación dibuja el esquema de respuesta en árbol plano
    // (`result` / `registration_link` / `token`) y no deja claro si el enlace
    // cuelga de `result` o va arriba. Se leen las dos formas en vez de apostar
    // a una: equivocarse acá daría "alta creada" con un enlace vacío.
    const enlace = cuerpo?.result?.registration_link || cuerpo?.registration_link;
    if (!enlace) {
        console.error("[payoneer] respuesta sin registration_link:", JSON.stringify(cuerpo).slice(0, 500));
        throw new Error("Payoneer no devolvió el enlace de registro.");
    }

    return { payeeId, registrationLink: String(enlace) };
}

/** Para el panel: por qué no se puede invitar a nadie todavía. */
export function motivoSinPayoneer(): string | null {
    try {
        return configDePayoneer() ? null : "Faltan PAYONEER_CLIENT_ID, PAYONEER_CLIENT_SECRET o PAYONEER_PROGRAM_ID.";
    } catch (e) {
        return errorMessage(e);
    }
}
