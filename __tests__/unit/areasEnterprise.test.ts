// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname, relative, resolve } from "path";
import { getRequiredTierForPath } from "@/lib/routeTiers";
import { hasAccess } from "@/lib/tierLogic";

const RAIZ = join(__dirname, "..", "..");
const APP = join(RAIZ, "src/app/[locale]");

/**
 * Seis áreas son exclusivas de Enterprise: Optimización y Ahorro, Azure
 * Integration Services, Analítica Avanzada, Monitoreo, Seguridad y Azure IA.
 *
 * Bloquearlas NO es sólo subir el `requiredTier` del Sidebar: eso apaga el link
 * pero no la página. `RouteTierGate` resuelve el tier con el pathname contra
 * `ROUTE_TIERS`, así que lo que decide de verdad es esa tabla.
 *
 * Y hay una trampa propia de estos hubs: varias de sus pestañas no tienen
 * página propia, son un `export { default } from "../../<vieja>/page"` que
 * reexporta una ruta de primer nivel anterior a la reorganización en hubs. Esa
 * ruta vieja sigue viva y sirve el MISMO componente, así que si quedó en
 * Business el bloqueo es decorativo: se entra por la URL vieja. Pasaba con
 * `/intelligence/scorecard`, `/intelligence/simulator`, `/intelligence/alerts`,
 * `/intelligence/tenant-health`, `/intelligence/app-insights`,
 * `/intelligence/log-analytics`, `/intelligence/hybrid-benefit` y
 * `/intelligence/commitment-simulator`.
 *
 * Por eso el test resuelve los alias contra el disco en lugar de listar rutas a
 * mano: una pestaña nueva que reexporte una página de tier menor lo pone en
 * rojo el día que se agrega, que es cuando se puede arreglar barato.
 */

const HUBS = [
    "optimizacion-y-ahorro",
    "integration-services",
    "analitica-avanzada",
    "monitoreo",
    "seguridad",
    "azure-ai",
];

/** Rutas de `page.tsx` bajo un directorio, recursivo. */
function paginas(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return paginas(p);
        return e.name === "page.tsx" ? [p] : [];
    });
}

/** `/src/app/[locale]/intelligence/x/page.tsx` -> `/intelligence/x` */
const aRuta = (archivo: string) =>
    "/" + relative(APP, dirname(archivo)).split(/[\\/]/).join("/");

/** Destino de un `export { default } from "..."`, o null si tiene página propia. */
function alias(archivo: string): string | null {
    const m = readFileSync(archivo, "utf8").match(
        /export\s*\{\s*default\s*\}\s*from\s*["']([^"']+)["']/,
    );
    if (!m) return null;
    const destino = resolve(dirname(archivo), m[1]).replace(/\/page$/, "");
    return "/" + relative(APP, destino).split(/[\\/]/).join("/");
}

describe("áreas exclusivas de Enterprise", () => {
    it("los seis hubs están declarados Enterprise en ROUTE_TIERS", () => {
        for (const hub of HUBS) {
            const ruta = `/intelligence/${hub}`;
            expect(getRequiredTierForPath(ruta), `${ruta} sin tier`).toBe("Enterprise");
        }
    });

    it("ningún plan por debajo de Enterprise entra a los hubs ni a sus pestañas", () => {
        const abiertas: string[] = [];
        for (const hub of HUBS) {
            for (const archivo of paginas(join(APP, "intelligence", hub))) {
                const ruta = aRuta(archivo);
                const req = getRequiredTierForPath(ruta);
                for (const plan of ["Professional", "Business"]) {
                    if (!req || hasAccess(plan, req)) abiertas.push(`${ruta} (${plan})`);
                }
            }
        }
        expect(abiertas, `rutas alcanzables sin Enterprise:\n  ${abiertas.join("\n  ")}`).toEqual([]);
    });

    it("las pestañas que reexportan una página vieja no la dejan abierta por su URL original", () => {
        // El agujero real: la pestaña queda bloqueada, pero la ruta que
        // reexporta sirve el mismo componente con su propio tier.
        const filtradas: string[] = [];
        for (const hub of HUBS) {
            for (const archivo of paginas(join(APP, "intelligence", hub))) {
                const destino = alias(archivo);
                if (!destino) continue;
                const req = getRequiredTierForPath(destino);
                if (!req || hasAccess("Business", req)) {
                    filtradas.push(`${aRuta(archivo)} -> ${destino} (${req ?? "sin tier"})`);
                }
            }
        }
        expect(
            filtradas,
            `Estas pestañas reexportan una página cuya ruta original sigue accesible ` +
            `por debajo de Enterprise, así que el bloqueo del hub no sirve. ` +
            `Subí esa ruta en ROUTE_TIERS:\n  ${filtradas.join("\n  ")}`,
        ).toEqual([]);
    });

    it("el Sidebar pide el mismo tier que ROUTE_TIERS, así el link se grisa", () => {
        // El grisado (`opacity-40 grayscale`) sale de `requiredTier` del item;
        // si se desincroniza de ROUTE_TIERS el link se ve normal y recién al
        // entrar aparece el cartel.
        const sidebar = readFileSync(join(RAIZ, "src/components/Sidebar.tsx"), "utf8");
        for (const hub of HUBS) {
            const m = sidebar.match(
                new RegExp(`href: '/intelligence/${hub}'[^}]*requiredTier: '(\\w+)'`),
            );
            expect(m, `/intelligence/${hub} sin requiredTier en el Sidebar`).not.toBeNull();
            expect(m![1], `/intelligence/${hub} desincronizado`).toBe("Enterprise");
        }
        expect(sidebar).toContain("opacity-40 grayscale");
    });

    /**
     * Bloquear la página y dejar la API en Business es teatro: los datos se
     * siguen pudiendo sacar con un fetch. `RouteTierGate` corre en el cliente y
     * no protege nada por sí solo.
     *
     * Sólo se listan las rutas que YA declaraban un tier: la mayoría de las
     * APIs de la app no tiene gate de tier, y eso es un hueco anterior y más
     * ancho que este cambio (ver el informe). Acá se fija que las que sí lo
     * declaran no queden por debajo de la página que sirven.
     */
    it("las APIs de estas áreas no piden menos que la página", () => {
        const APIS = [
            "analytics/tenant-health", "intelligence/tenant-health",
            "intelligence/defender", "intelligence/defender/details",
            "intelligence/entra-id", "intelligence/security/entra-id",
            "intelligence/security/key-vault", "intelligence/waf",
            "intelligence/integration-services/[service]",
            "intelligence/monitoring/action-groups", "intelligence/monitoring/alerts",
            "intelligence/monitoring/network-watcher", "intelligence/monitoring/workbooks",
            "intelligence/simulator", "intelligence/simulator/compare",
            "intelligence/simulator/scenarios",
        ];
        const flojas: string[] = [];
        for (const api of APIS) {
            const archivo = join(RAIZ, "src/app/api", api, "route.ts");
            expect(existsSync(archivo), `${api} ya no existe: sacalo de la lista`).toBe(true);
            const src = readFileSync(archivo, "utf8");
            const pedidos = [
                ...src.matchAll(/requireTenantTier\(\s*request,\s*tenantId,\s*["'](\w+)["']/g),
            ].map((m) => m[1]);
            expect(pedidos.length, `${api} perdió su gate de tier`).toBeGreaterThan(0);
            for (const tier of pedidos) {
                if (hasAccess("Business", tier)) flojas.push(`${api} pide ${tier}`);
            }
        }
        expect(
            flojas,
            `Estas APIs sirven áreas Enterprise pero las abre un plan menor, así que ` +
            `el bloqueo de la página no protege los datos:\n  ${flojas.join("\n  ")}`,
        ).toEqual([]);
    });
});
