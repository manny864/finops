import { getSecret } from "@/lib/secrets/keyvault";

/**
 * Obtiene (y cachea en memoria) un access token del Service Principal de
 * load testing vía client_credentials — el MISMO flujo que usaría k6/JMeter
 * desde afuera (ver docs/loadtest.md), pero orquestado server-side para que
 * la página /admin/load-test pueda ejecutar la prueba "autenticada" con un
 * click, sin que el operador tenga que correr nada a mano.
 *
 * El client secret NUNCA vive en `.env` — se trae de Key Vault bajo el
 * nombre "loadtest-sp-client-secret" (ver docs/loadtest.md §1c). Si Key
 * Vault no está habilitado o el secret no existe, esto tira un error claro
 * en vez de fallar en silencio.
 */

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getLoadTestServicePrincipalToken(): Promise<string> {
    const now = Date.now();
    // 60s de margen para no usar un token que expira a mitad de la prueba.
    if (cachedToken && cachedToken.expiresAt > now + 60_000) {
        return cachedToken.value;
    }

    const tenantId = process.env.AZURE_TENANT_ID;
    const spClientId = process.env.LOAD_TEST_SP_APP_ID;
    // OJO: NO usar solo AZURE_CLIENT_ID acá — en este VPS esa variable
    // apunta al Service Principal de ENVÍO DE CORREOS (Graph sendMail), no
    // al App Registration donde loguean los usuarios de la app (el que
    // realmente tiene Service Principal creado en el tenant y es el que
    // debe tener "Expose an API" + el App Role configurados — ver
    // docs/loadtest.md §2). El frontend (AuthProvider.tsx) usa
    // NEXT_PUBLIC_CLIENT_ID para MSAL — ese es el valor correcto acá,
    // mismo criterio de prioridad que getAudienceAllowList() en
    // requestAuth.ts (que ya acepta cualquiera de estos 4 como audience
    // válida de un token de usuario).
    const appClientId = process.env.NEXT_PUBLIC_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || process.env.AZURE_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID;
    if (!tenantId || !spClientId || !appClientId) {
        throw new Error(
            "Faltan AZURE_TENANT_ID / LOAD_TEST_SP_APP_ID / NEXT_PUBLIC_CLIENT_ID en el entorno."
        );
    }

    const clientSecret = await getSecret("loadtest-sp-client-secret");
    if (!clientSecret) {
        throw new Error(
            "Secret 'loadtest-sp-client-secret' no encontrado en Key Vault (¿está habilitado AZURE_KEYVAULT_ENABLED? ¿se cargó el secret? ver docs/loadtest.md §1c)."
        );
    }

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: spClientId,
            client_secret: clientSecret,
            scope: `api://${appClientId}/.default`,
        }),
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`No se pudo obtener token del Service Principal de load testing (HTTP ${res.status}): ${detail.slice(0, 300)}`);
    }

    const data = await res.json();
    if (!data.access_token) {
        throw new Error("Respuesta de Azure AD sin access_token.");
    }

    cachedToken = { value: data.access_token, expiresAt: now + (Number(data.expires_in) || 3600) * 1000 };
    return cachedToken.value;
}
