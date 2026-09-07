// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getRequiredTierForPath } from "@/lib/routeTiers";
import { hasAccess } from "@/lib/tierLogic";

const RAIZ = join(__dirname, "..", "..");
const sinComentarios = (ruta: string) =>
    readFileSync(join(RAIZ, ruta), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");

/**
 * El gate de tier de las pestañas de los hubs de administración.
 *
 * `routeTiers` declaraba el tier de cada una de estas rutas, pero esa
 * declaración no se aplicaba a ninguna: `RouteTierGate` resuelve el tier con
 * `usePathname()`, y desde que estas páginas pasaron a ser pestañas de un hub el
 * pathname es el del hub (`/admin/access`), no el de la pestaña. `AdminHubGate`
 * filtraba por permisos y rol, nunca por tier.
 *
 * Se descubrió al restringir Lighthouse (2026-09-04) y afectaba a los CINCO
 * hubs, con 13 pestañas declaradas Business o Enterprise.
 */
describe("gate de tier por pestaña en los hubs", () => {
    const gate = sinComentarios("src/components/admin/AdminHubGate.tsx");

    it("AdminHubGate consulta el tier declarado de cada pestaña", () => {
        expect(gate).toContain("getRequiredTierForPath(current.originalHref)");
        expect(gate).toContain("hasAccess(currentTier, requiredTier)");
    });

    it("SUPERADMIN pasa por encima del tier", () => {
        expect(gate).toMatch(/systemRole !== "SUPERADMIN"/);
    });

    it("la pestaña bloqueada muestra el aviso, no se oculta", () => {
        // Es como se comportaban estas páginas cuando eran independientes
        // (`RouteTierGate` renderiza el mismo aviso) y es la única forma de que
        // el cliente se entere de que la capacidad existe.
        expect(gate).toContain("TierLockedNotice");
        expect(gate).toMatch(/bloqueadaPorTier \?/);
    });

    it("ninguna pestaña de un hub queda declarada por encima del tier que la usa", () => {
        // El caso real: `/admin/cloud-accounts` estaba declarado Enterprise
        // mientras `CloudAccountsPanel` renderiza su banner de cuota SÓLO
        // cuando el tier NO es Enterprise, y la página de precios le promete
        // suscripciones a Professional. Aplicar el gate tal cual le habría
        // escondido a Professional y Business su única forma de administrar el
        // cupo.
        expect(getRequiredTierForPath("/admin/cloud-accounts")).toBe("Professional");
        expect(hasAccess("Professional", getRequiredTierForPath("/admin/cloud-accounts")!)).toBe(true);
    });

    it("los cinco hubs siguen usando el mismo componente", () => {
        // El arreglo vive en AdminHubGate justamente para no repetirlo por hub.
        const dir = join(RAIZ, "src/app/[locale]/admin");
        const hubs = readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => join("src/app/[locale]/admin", d.name, "page.tsx"))
            .filter((p) => {
                try { return sinComentarios(p).includes("AdminHubGate"); } catch { return false; }
            });
        expect(hubs.length).toBeGreaterThanOrEqual(5);
    });
});

/**
 * Los mensajes de error del servidor viajan con un código estable.
 *
 * Estaban hardcodeados en español y no se localizan —son strings de código, no
 * de i18n— así que un superadmin en inglés veía español en la UI y después no
 * encontraba ese texto en su manual.
 */
describe("errores de Lighthouse localizables", () => {
    it("las cuatro respuestas llevan errorCode", () => {
        const ruta = sinComentarios("src/app/api/onboard/lighthouse/route.ts");
        for (const c of ["TIER", "SIN_TENANT", "SIN_PRINCIPAL", "AUTO_DELEGACION"]) {
            expect(ruta, `falta LIGHTHOUSE_ERRORS.${c}`).toContain(`LIGHTHOUSE_ERRORS.${c}`);
        }
    });

    it("el mensaje en español sigue viajando como respaldo", () => {
        // Si el cliente no conoce el código, algo tiene que mostrar.
        const ruta = sinComentarios("src/app/api/onboard/lighthouse/route.ts");
        expect(ruta).toMatch(/error: LIGHTHOUSE_TIER_ERROR, errorCode:/);
    });

    it("el panel traduce el código y cae al mensaje si no lo conoce", () => {
        const panel = sinComentarios("src/components/admin/panels/LighthousePanel.tsx");
        expect(panel).toContain("mensajeDeError");
        expect(panel).toMatch(/json\?\.error \|\| t\("errorGeneric"\)/);
    });
});

/**
 * Una delegación de sólo lectura no puede ejecutar remediación.
 *
 * Sin el chequeo, la acción llegaba hasta ARM y volvía con un 403 crudo que no
 * distingue "la plataforma no tiene permiso" de "el cliente no delegó
 * escritura" — y el segundo lo arregla el cliente, no nosotros.
 */
describe("remediación sobre delegaciones de sólo lectura", () => {
    const lib = sinComentarios("src/lib/lighthouseAccess.ts");

    it("Reader y Cost Management Reader NO habilitan escritura", () => {
        const m = lib.match(/const ROLES_DE_ESCRITURA = \[([^\]]+)\]/);
        expect(m, "no encontré la lista de roles de escritura").not.toBeNull();
        expect(m![1]).not.toMatch(/"Reader"/);
        expect(m![1]).not.toMatch(/Cost Management Reader/);
        expect(m![1]).toMatch(/Contributor/);
    });

    it("app_registration no se bloquea nunca", () => {
        // El script de onboarding asigna el rol de remediación; si el cliente lo
        // quitó, el fallo es el 403 de Azure, que es lo que había antes.
        expect(lib).toMatch(/!== "lighthouse"\) return \{ puede: true/);
    });

    it("sin verificación previa no bloquea", () => {
        // La columna trae la intención, no la realidad: es preferible el 403 de
        // Azure a bloquear una acción que el cliente sí delegó.
        expect(lib).toMatch(/if \(!rows\?\.length\) return \{ puede: true/);
    });

    it("la ruta de remediación lo chequea y explica de quién es el problema", () => {
        // El chequeo se extrajo a `bloqueoPorDelegacionDeLectura` cuando se vio
        // que estaba SOLO en esta ruta y faltaba en las otras diez que escriben
        // en Azure. Este test seguía afirmando sobre el nombre de la función
        // interna, así que la extracción lo rompió sin que nada estuviera mal:
        // ahora afirma sobre el guard, y el mensaje con el ERR_ vive en el lib.
        const ruta = sinComentarios("src/app/api/remediation/route.ts");
        expect(ruta).toContain("bloqueoPorDelegacionDeLectura");
        expect(sinComentarios("src/lib/lighthouseAccess.ts")).toContain("ERR_LIGHTHOUSE_READ_ONLY");
    });

    it("los roles verificados sobrescriben los pedidos", () => {
        // El INSERT guarda lo que se tildó en el formulario: una intención. Si
        // el cliente desplegó con menos, la columna miente en la dirección
        // peligrosa.
        const svc = sinComentarios("src/services/lighthouseVerification.service.ts");
        expect(svc).toMatch(/roles = \$\{pool\.escape/);
        expect(svc, "sólo se pisa con delegación activa").toMatch(/activa \? roles : null/);
    });
});
