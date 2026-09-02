// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { computeInitialAnimate } from "@/lib/chartTheme";

function stubVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

function stubReducedMotion(matches: boolean) {
    window.matchMedia = vi.fn().mockReturnValue({ matches } as MediaQueryList);
}

afterEach(() => {
    stubVisibility("visible");
    stubReducedMotion(false);
});

describe("computeInitialAnimate — MEJ-02", () => {
    // El bug reportado: Recharts anima sobre requestAnimationFrame, que el
    // navegador pausa en pestañas ocultas. Si el gráfico se monta oculto, la
    // animación queda congelada en el frame 0 (radio/ancho 0) para siempre,
    // aunque el dato ya haya llegado -- sólo una recarga lo arregla.
    it("es false si la pestaña está oculta al montar (el bug reportado)", () => {
        stubVisibility("hidden");
        expect(computeInitialAnimate()).toBe(false);
    });

    it("es true si la pestaña está visible y sin preferencia de movimiento reducido", () => {
        stubVisibility("visible");
        stubReducedMotion(false);
        expect(computeInitialAnimate()).toBe(true);
    });

    // Razón independiente de la visibilidad: el usuario pidió explícitamente
    // no ver movimiento, así que gana incluso con la pestaña visible.
    it("es false con 'reducir movimiento' activo, aunque la pestaña esté visible", () => {
        stubVisibility("visible");
        stubReducedMotion(true);
        expect(computeInitialAnimate()).toBe(false);
    });

    it("es false si ambas condiciones adversas coinciden", () => {
        stubVisibility("hidden");
        stubReducedMotion(true);
        expect(computeInitialAnimate()).toBe(false);
    });
});
