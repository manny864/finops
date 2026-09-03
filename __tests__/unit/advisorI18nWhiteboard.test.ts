// @vitest-environment node
import { describe, it, expect } from "vitest";
import { translateAdvisorText } from "@/lib/advisorI18n";
import { getMockDataForRoute } from "@/lib/mockData";

/**
 * El tablero en modo demo no pasa por la ruta de API: `TenantProvider`
 * intercepta `/api/intelligence/whiteboard` y devuelve el mock crudo, así que
 * `translateAdvisorText` --que la ruta real sí aplica-- tiene que aplicarse en
 * el render de los widgets.
 *
 * Para que eso funcione, el mock debe contener lo que Azure devuelve DE VERDAD,
 * que es inglés. Pre-traducirlo al español dejaba muerto el traductor y el
 * tablero en /en mostraba recomendaciones en español.
 *
 * Este test fija las dos mitades: que el mock esté en inglés y que el traductor
 * lo convierta en los tres idiomas.
 */
describe("texto de Advisor en el tablero demo", () => {
    const payload: any = getMockDataForRoute("white_board", "enterprise");

    it("el mock trae las acciones de seguridad en inglés, como Azure", () => {
        const acciones: string[] = payload?.securityActions || [];
        expect(acciones.length).toBeGreaterThan(0);
        for (const a of acciones) {
            expect(a, `"${a}" no debería tener acentos españoles`).not.toMatch(/[áéíóúñ¿]/);
        }
    });

    it("el traductor devuelve cada idioma para las acciones del mock", () => {
        const accion: string = (payload?.securityActions || [])[0];
        const es = translateAdvisorText(accion, "es", "problem");
        const en = translateAdvisorText(accion, "en", "problem");
        const pt = translateAdvisorText(accion, "pt-BR", "problem");
        expect(en).not.toMatch(/[áéíóúñ¿]/);
        // Si el texto no está en la tabla, el traductor devuelve la entrada tal
        // cual y los tres idiomas salen idénticos: eso es el modo de falla que
        // este test tiene que detectar, no dar por bueno.
        expect(
            es !== en || pt !== en,
            `"${accion}" no está cubierto por advisorI18n: los tres idiomas salen iguales`
        ).toBe(true);
    });

    it("los quick wins del mock están en inglés y el traductor los cubre", () => {
        const wins: any[] = payload?.quickWins || payload?.topQuickWins || [];
        expect(wins.length).toBeGreaterThan(0);
        for (const w of wins) {
            expect(w.title, `title "${w.title}"`).not.toMatch(/[áéíóúñ¿]/);
            if (w.description) {
                expect(w.description, `description "${w.description}"`).not.toMatch(/[áéíóúñ¿]/);
            }
            const en = translateAdvisorText(w.title, "en", "solution");
            expect(en, `"${w.title}" traducido a en`).not.toMatch(/[áéíóúñ¿]/);
            // Pasar el mock a inglés no puede romper el español: si advisorI18n
            // no cubre el texto, el traductor devuelve la entrada tal cual y el
            // usuario en español empieza a ver inglés donde antes veía español.
            const es = translateAdvisorText(w.title, "es", "solution");
            expect(
                es !== en,
                `"${w.title}" no está en advisorI18n: el español mostraría el inglés`
            ).toBe(true);
        }
    });

    it("los pilares se traducen desde su clave en inglés", () => {
        for (const pilar of ["cost", "security", "reliability", "performance"]) {
            expect(translateAdvisorText(pilar, "en", "problem")).not.toMatch(/[áéíóúñ¿]/);
            expect(translateAdvisorText(pilar, "es", "problem")).not.toBe(pilar);
        }
    });
});
