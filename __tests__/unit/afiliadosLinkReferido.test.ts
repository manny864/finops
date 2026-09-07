// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "..", "..");

/**
 * El link de referido apuntaba a `/pricing`, que NO existe en el App Router:
 * el afiliado repartía un link que daba 404. Ninguna prueba lo cubría porque el
 * path era un literal dentro de un template string — compila igual apunte a
 * donde apunte.
 *
 * Este test lee el path del panel y verifica que haya un `page.tsx` que lo
 * sirva, sea suelto o bajo `[locale]`.
 */
describe("afiliados · el link de referido apunta a una ruta que existe", () => {
    const panel = readFileSync(
        join(RAIZ, "src/components/superadmin/AffiliatesPanel.tsx"),
        "utf8"
    );

    it("el panel arma el link con un path servido por el App Router", () => {
        const m = panel.match(/window\.location\.origin : ""\}(\/[a-z0-9-]+)\?ref=/);
        expect(m, "no encontré el path del link en AffiliatesPanel").not.toBeNull();

        const path = m![1];
        const candidatos = [
            join(RAIZ, "src/app", path, "page.tsx"),
            join(RAIZ, "src/app/[locale]", path, "page.tsx"),
        ];
        const servido = candidatos.some((p) => existsSync(p));
        expect(servido, `${path} no tiene page.tsx en ${candidatos.join(" ni ")}`).toBe(true);
    });

    it("la ruta pública reenvía al locale preservando el query string", () => {
        // `/signup` resuelve el idioma y redirige. Si alguien le agrega un
        // `?` fijo o corta los searchParams, el `?ref=` se pierde en el salto y
        // la atribución no ocurre nunca — sin ningún error visible.
        const ruta = readFileSync(join(RAIZ, "src/app/signup/page.tsx"), "utf8");
        expect(ruta).toMatch(/redirect\(/);
        expect(ruta, "el redirect no debe llevar un query string propio")
            .not.toMatch(/redirect\(`[^`]*\?/);
    });

    it("el tracker está montado en el layout que sirve esa ruta", () => {
        // El código se captura en [locale]/layout.tsx. Si el link apuntara a una
        // ruta fuera de ese árbol (como las de src/app/ sueltas), el tracker no
        // montaría y la cookie no se escribiría.
        const layout = readFileSync(join(RAIZ, "src/app/[locale]/layout.tsx"), "utf8");
        expect(layout).toContain("AffiliateTracker");
        expect(existsSync(join(RAIZ, "src/app/[locale]/signup/page.tsx")),
            "el destino del redirect vive bajo [locale], donde monta el tracker").toBe(true);
    });
});
