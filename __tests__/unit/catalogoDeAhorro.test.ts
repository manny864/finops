// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { baselineForResourceType, AZURE_MONTHLY_BASELINE_BY_TYPE } from "@/lib/realizedSavings";
import { UNIFIED_AUDIT_RESOURCE_CONFIG, mapAuditToUnifiedZombieList } from "@/lib/zombieAuditCatalog";

const sinComentarios = (ruta: string) =>
    readFileSync(join(__dirname, "..", "..", ruta), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");

/**
 * MEJ-32 — UN catálogo de precios de ahorro, no tres.
 *
 * Había tres y ya habían divergido, justo en los tipos de zombie más
 * frecuentes: un disco sin asociar valía 19.71 en el canónico y 15.00 en las dos
 * copias; un plan ASP vacío 54.75 contra 45.00; una VM apagada 23.36 contra
 * 30.00. Más el precio por GiB de disco escrito a mano como 0.15 donde el
 * canónico usa 0.154. El mismo recurso reportaba un ahorro distinto según la
 * pantalla por la que entraras.
 *
 * MEJ-10 declaró esto resuelto en su momento y no lo estaba, así que estos tests
 * verifican el estado del código y no la intención.
 */
describe("MEJ-32: un solo catálogo de ahorro", () => {
    it("no quedan definiciones de catálogo duplicadas", () => {
        for (const ruta of [
            "src/components/dashboard/InteractiveDashboard.tsx",
            "src/app/api/intelligence/applied-savings/route.ts",
        ]) {
            const src = sinComentarios(ruta);
            expect(src, `${ruta} define un catálogo propio`).not.toMatch(
                /const (fallbackSavings|SAVINGS_BY_ARM_TYPE)\s*[:=]/
            );
        }
    });

    it("los dos consumidores llegan al canónico", () => {
        expect(sinComentarios("src/components/dashboard/InteractiveDashboard.tsx"))
            .toContain("mapAuditToUnifiedZombieList");
        expect(sinComentarios("src/app/api/intelligence/applied-savings/route.ts"))
            .toContain("baselineForResourceType(resourceId)");
    });

    it("los tres tipos que habían divergido dan el valor canónico", () => {
        // Los numeros de la izquierda son los que tenian las copias.
        const casos: Array<[string, number, number]> = [
            ["/subscriptions/x/providers/microsoft.compute/disks/d1", 15.0, 19.71],
            ["/subscriptions/x/providers/microsoft.web/serverfarms/asp1", 45.0, 54.75],
            // El canonico distingue VM APAGADA (23.36 = disco OS + IP) de VM
            // corriendo (70). La copia tenia 30.0 plano para la apagada.
            ["microsoft.compute/virtualmachines/stopped", 30.0, 23.36],
        ];
        for (const [id, copia, canonico] of casos) {
            const { monthly } = baselineForResourceType(id);
            expect(monthly, `${id} deberia dar el canonico`).toBeCloseTo(canonico, 2);
            expect(monthly, `${id} volvio al valor de la copia`).not.toBeCloseTo(copia, 2);
        }
    });

    it("el precio por GiB de disco es el del canónico, no el redondeado", () => {
        // Las copias usaban 0.15; el canonico 0.154.
        const { monthly } = baselineForResourceType("microsoft.compute/disks", 100);
        expect(monthly).toBeCloseTo(15.4, 2);
        expect(monthly).not.toBeCloseTo(15.0, 2);
    });

    it("un tipo desconocido devuelve 0, no un número inventado", () => {
        // La copia devolvia 10.0 de fallback: inflaba el ahorro reportado con un
        // valor que no sale de ninguna lista de precios.
        const { monthly, source } = baselineForResourceType("microsoft.inventado/cosas/x1");
        expect(monthly).toBe(0);
        expect(source).toBe("none");
    });

    it("toda clave de audit con costo resuelve por su armType", () => {
        // Es el puente que hace posible borrar las copias: la clave de audit no
        // matchea el slug ARM por substring (`appGateways` no encuentra
        // `microsoft.network/applicationgateways`), pero el catalogo de audit ya
        // mapea una a otra.
        const sinBaseline: string[] = [];
        for (const [key, cfg] of Object.entries(UNIFIED_AUDIT_RESOURCE_CONFIG)) {
            if (cfg.issueType !== "cost") continue;
            const conocido = AZURE_MONTHLY_BASELINE_BY_TYPE.some(
                (b) => cfg.armType === b.match || cfg.armType.startsWith(b.match)
            );
            if (!conocido) sinBaseline.push(`${key} (${cfg.armType})`);
        }
        // Las tres son correctas, no huecos:
        //
        //  - `ttl` es un pseudo-tipo: el TTL vence sobre cualquier recurso. El
        //    mapeador para esa clave usa el tipo REAL del item, asi que un disco
        //    con TTL vencido resuelve a 19.71. La copia le ponia 10.0 plano.
        //  - `virtualhubs` y `dnszones` tampoco estaban en la copia, o sea que
        //    ya daban 0 antes: no es una regresion, es el mismo estado sin el
        //    numero inventado.
        expect(sinBaseline.sort()).toEqual([
            "emptyDnsZones (microsoft.network/dnszones)",
            "expiredTtlResources (ttl)",
            "unusedVirtualHubs (microsoft.network/virtualhubs)",
        ]);
    });

    it("un recurso con TTL vencido usa el precio de SU tipo, no un plano", () => {
        // La copia le ponia 10.0 a cualquier cosa con TTL vencido, sin importar
        // si era un disco o una IP.
        const items = mapAuditToUnifiedZombieList({
            expiredTtlResources: [{
                id: "/subscriptions/x/providers/microsoft.compute/disks/d1",
                name: "d1",
                armType: "microsoft.compute/disks",
            }],
        });
        expect(items[0].potentialSavings).toBeCloseTo(19.71, 2);
        expect(items[0].potentialSavings).not.toBeCloseTo(10.0, 2);
    });

    it("el mapeador calcula el ahorro sin que el llamador sepa de precios", () => {
        const items = mapAuditToUnifiedZombieList({
            unattachedDisks: [{ id: "/subscriptions/x/providers/microsoft.compute/disks/d1", name: "d1" }],
        });
        expect(items).toHaveLength(1);
        expect(items[0].potentialSavings).toBeCloseTo(19.71, 2);
        expect(items[0].savingsSource).toBe("type_baseline");
    });
});
