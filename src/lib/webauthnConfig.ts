/**
 * Configuración de Relying Party para WebAuthn/FIDO2.
 *
 * El `rpID` es el dominio registrable de la aplicación y el `origin` es la URL
 * exacta desde la que se llama al navegador. WebAuthn los valida del lado
 * servidor contra lo que firmó el autenticador: si no coinciden, la credencial
 * se rechaza. Por eso **no** se derivan de headers del request — `Host` y
 * `Origin` los controla el cliente, y confiar en ellos anularía la protección
 * anti-phishing que es la razón de existir de FIDO2.
 *
 * Se leen de env, con el dominio de producción como default.
 */

const DEFAULT_RP_ID = "finops.cscloudsolutions.com.ar";

export function getRpId(): string {
    return process.env.WEBAUTHN_RP_ID || DEFAULT_RP_ID;
}

export function getRpName(): string {
    return process.env.WEBAUTHN_RP_NAME || "CSCloudSolutions FinOps";
}

/**
 * Orígenes aceptados. Se admite una lista para cubrir producción, staging y el
 * `localhost` de desarrollo sin tener que cambiar el `rpID`.
 */
export function getExpectedOrigins(): string[] {
    const raw = process.env.WEBAUTHN_ORIGINS;
    if (raw) {
        return raw
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean);
    }
    return [`https://${getRpId()}`];
}

/** Ventana de vida del challenge. Corta a propósito: es un anti-replay. */
export const CHALLENGE_TTL_SECONDS = 300;
