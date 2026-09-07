// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname, normalize } from "path";

/**
 * Toda ruta de /api pasa por algun mecanismo de autenticacion, o esta en la
 * lista de publicas con el motivo escrito.
 *
 * El agujero que motiva el test: `superadmin/impersonate/start` exigia
 * `requireSuperAdmin` y sus dos hermanas `stop` y `status` no exigian nada.
 * `stop` ademas insertaba en `AuditTrailLogs` con los valores del cookie de
 * impersonacion, que es base64 sin firmar — o sea, con los valores que mandara
 * quien llamara. Un POST anonimo escribia una fila del audit trail atribuida al
 * mail y al tenant que eligiera el atacante. Estuvo en produccion.
 *
 * El prefijo de la ruta parecia el guard, y no lo es: no hay middleware que
 * cubra /api/admin ni /api/superadmin. Cada archivo se defiende solo.
 *
 * ── Dos cosas que costaron y por eso estan en el codigo del test ──
 *
 * 1. **Los alias de re-export son invisibles a un grep de handlers.** Hay 17
 *    rutas cuyo archivo entero es `export { GET, POST } from '<otra ruta>'`.
 *    No tienen `export async function GET`, asi que un scan que busque
 *    handlers las saltea enteras — y con ellas al guard del destino. Fue
 *    literal: `admin/configuration/markup/simulate` re-exportaba los handlers
 *    SIN guard de `admin/config/markup/simulate` y ninguna de las dos aparecia
 *    en la primera pasada. Por eso hay que seguir el re-export.
 *
 * 2. **La lista de mecanismos no es una sola.** Ademas de los `require*` de
 *    requestAuth estan `verifyApiKey` (API publica v1 e ingesta),
 *    `authenticateMcpToken` (MCP), `verifyWebhookJwt` (marketplace de Azure) y
 *    la firma de Paddle. Una lista corta da un numero de "sin guard" alto y
 *    lleno de falsos positivos, que es la forma mas rapida de que nadie mire
 *    el test.
 *
 * ── Lo que este test NO puede afirmar ──
 *
 *   a. Si el mecanismo es el correcto. `requireRequestIdentity` donde deberia
 *      ir `requireSuperAdmin` pasa.
 *   b. Si corre ANTES del efecto. Un `await requireSuperAdmin(...)` despues del
 *      INSERT pasa y no protege nada. Es justo el modo de falla de `stop`, y
 *      verlo estaticamente pide seguir el orden de ejecucion por el AST con
 *      todas sus ramas.
 *
 * Cubre el caso frecuente —la ruta nueva sin guard— y deja escrito lo que sigue
 * siendo revision humana.
 */

const MECANISMOS = [
    "requireSuperAdmin",
    "requireRequestIdentity",
    "requireTenantAccess",
    "requireTenantTier",
    "requireTenantRole",
    "requireLoadTestServicePrincipal",
    "CRON_SECRET",
    "x-cron-auth",
    "verifyApiKey",
    "authenticateMcpToken",
    "verifyWebhookJwt",
    "paddle-signature",
];

/**
 * Publicas a proposito. Verificadas una por una el 2026-09-07: ninguna lee
 * datos de un tenant sin presentar antes una credencial propia.
 */
const PUBLICAS: Record<string, string> = {
    "src/app/api/health/route.ts": "liveness probe del Container App",
    "src/app/api/status/route.ts": "status page publica",
    "src/app/api/pricing/plans/route.ts": "precios de la landing",
    "src/app/api/leads/route.ts": "formulario de contacto anonimo",
    "src/app/api/leads/demo/route.ts": "pedido de demo anonimo",
    "src/app/api/v1/docs/route.ts": "documentacion de la API publica",
    "src/app/api/v1/openapi.json/route.ts": "spec OpenAPI de la API publica",
    "src/app/api/templates/powerbi/route.ts": "catalogo estatico de plantillas",
    "src/app/api/templates/powerbi/[id]/route.ts": "descarga de plantilla estatica",
    "src/app/api/tenant-logo/[tenantId]/route.ts": "el <img> del navegador no manda Bearer; documentado en el archivo",
    "src/app/api/auth/sso/start/route.ts": "inicio del flujo SSO, previo a la sesion",
    "src/app/api/auth/sso/callback/route.ts": "callback del IdP, previo a la sesion",
    "src/app/api/auth/sso/me/route.ts": "lee la cookie de sesion SSO y devuelve solo esa sesion",
    "src/app/api/auth/sso/logout/route.ts": "cierra la propia sesion",
    "src/app/api/exports/powerbi-feed/route.ts": "Bearer con helper local authenticate()",
    "src/app/api/webhooks/marketplace/azure/activate/route.ts":
        "el token del marketplace ES la credencial; se resuelve contra la API de Microsoft",
};

const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const API = "src/app/api";

function rutas(dir: string): string[] {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir)) {
        const p = join(dir, entrada);
        if (statSync(p).isDirectory()) salida.push(...rutas(p));
        else if (entrada === "route.ts") salida.push(p);
    }
    return salida;
}

function resolverAlias(ruta: string, spec: string): string | null {
    const base = spec.startsWith("@/")
        ? spec.replace("@/", "src/")
        : normalize(join(dirname(ruta), spec));
    for (const cand of [`${base}.ts`, join(base, "route.ts")]) {
        if (existsSync(cand)) return cand;
    }
    return null;
}

describe("autenticacion en las rutas de /api", () => {
    it("toda ruta con handler autentica, o esta declarada publica con motivo", () => {
        const sinMecanismo: string[] = [];
        const aliasRotos: string[] = [];
        let revisadas = 0;

        for (const ruta of rutas(API)) {
            let fuente = readFileSync(ruta, "utf-8");

            const alias = fuente.match(/^export \{([^}]*)\} from ['"]([^'"]+)['"]/m);
            const esAlias =
                alias && alias[1].split(",").some((x) => METODOS.includes(x.trim()));

            if (esAlias) {
                const destino = resolverAlias(ruta, alias![2]);
                if (!destino) {
                    aliasRotos.push(`${ruta} → ${alias![2]}`);
                    continue;
                }
                fuente = readFileSync(destino, "utf-8");
            } else if (!METODOS.some((m) => new RegExp(`export (async )?function ${m}\\b`).test(fuente))) {
                continue;
            }

            revisadas++;
            if (PUBLICAS[ruta.replace(/\\/g, "/")]) continue;
            if (!MECANISMOS.some((g) => fuente.includes(g))) sinMecanismo.push(ruta);
        }

        // Un alias que no resuelve es una ruta que devuelve 500 en produccion.
        expect(aliasRotos).toEqual([]);
        expect(revisadas).toBeGreaterThan(400);
        expect(sinMecanismo).toEqual([]);
    });

    it("la lista de publicas no acumula entradas de rutas que ya no existen", () => {
        const fantasmas = Object.keys(PUBLICAS).filter((p) => !existsSync(p));
        expect(fantasmas).toEqual([]);
    });
});
