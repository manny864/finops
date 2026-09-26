// @vitest-environment node
/**
 * MEJ-34 — el alcance traducido a UN predicado SQL.
 *
 * Plegar en TypeScript sirve con una o dos agregaciones. El detalle de un Cost
 * Group tiene diez, y su grano —que incluye la fecha— no colapsa: medido contra
 * la base local, 16.822 filas siguen siendo 16.822. El grano del ALCANCE sí
 * colapsa (152 combinaciones, 51 ternas), así que el alcance se resuelve una vez
 * y viaja como un `IN` de ternas que las diez consultas heredan.
 *
 * Lo que estos tests cuidan es CUÁNDO SE NIEGA. Un predicado que recorta mal es
 * peor que no recortar, así que ante una terna que cae de los dos lados devuelve
 * null y el llamador muestra el tablero entero diciéndolo.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() } }));

import { recorteDeAlcance } from "@/services/perspectivesData.service";
import type { FilaDeCosto } from "@/services/perspectives.service";

/** En alcance = etiqueta Environment=prod. */
const esProd = (f: FilaDeCosto) => f.tags?.Environment === "prod";

const fila = (sub: string, rg: string, id: string | null, env: string) => ({
    subscription_id: sub, resource_group: rg, service_name: "VM",
    ResourceId: id, Tags: { Environment: env },
});

describe("recorteDeAlcance", () => {
    it("arma un IN de ternas con sólo lo que entra", () => {
        const r = recorteDeAlcance([
            fila("s1", "rg-prod", "/r/1", "prod"),
            fila("s1", "rg-dev", "/r/2", "dev"),
        ], esProd)!;

        expect(r.sql).toContain("IN ((?,?,?))");
        expect(r.params).toEqual(["s1", "rg-prod", "/r/1"]);
        expect(r.resourceGroups).toEqual(["rg-prod"]);
    });

    it("usa COALESCE, porque NULL nunca es igual a NULL", () => {
        // Es el caso de todo lo que ingesta el sync: `ResourceId` en NULL. Sin
        // el COALESCE el predicado no matchearía ninguna fila y el tablero
        // saldría vacío en vez de acotado.
        const r = recorteDeAlcance([fila("s1", "rg-prod", null, "prod")], esProd)!;
        expect(r.sql).toContain("COALESCE(ResourceId,'')");
        expect(r.params).toEqual(["s1", "rg-prod", ""]);
    });

    it("se niega si una terna cae de los dos lados", () => {
        // El mismo recurso con dos juegos de etiquetas en la ventana: cambió de
        // entorno. SQL no puede separar esas filas, y recortar igual atribuiría
        // el gasto de enero al grupo de junio.
        const r = recorteDeAlcance([
            fila("s1", "rg-mixto", "/r/1", "prod"),
            fila("s1", "rg-mixto", "/r/1", "dev"),
        ], esProd);
        expect(r).toBeNull();
    });

    it("se niega si hay más ternas que el tope", () => {
        const muchas = Array.from({ length: 5 }, (_, i) => fila("s1", `rg-${i}`, `/r/${i}`, "prod"));
        expect(recorteDeAlcance(muchas, esProd, 4)).toBeNull();
        expect(recorteDeAlcance(muchas, esProd, 5)).not.toBeNull();
    });

    it("nada en alcance es 1=0, que no es lo mismo que negarse", () => {
        // Acá el alcance SÍ se pudo evaluar y la respuesta es cero. Devolver
        // null mostraría el grupo entero, que sería lo contrario de la verdad.
        const r = recorteDeAlcance([fila("s1", "rg-dev", "/r/1", "dev")], esProd)!;
        expect(r.sql).toBe("1=0");
        expect(r.params).toEqual([]);
    });

    it("con los grupos enteros, acotar Resource Graph por grupo ya es exacto", () => {
        const r = recorteDeAlcance([
            fila("s1", "rg-prod", null, "prod"),
            fila("s1", "rg-dev", null, "dev"),
        ], esProd)!;
        expect(r.porGrupoAlcanza).toBe(true);
    });

    it("con un grupo partido hace falta el identificador de cada recurso", () => {
        const r = recorteDeAlcance([
            fila("s1", "rg-mixto", "/r/1", "prod"),
            fila("s1", "rg-mixto", "/r/2", "dev"),
        ], esProd)!;
        expect(r.porGrupoAlcanza).toBe(false);
        expect([...r.resourceIds]).toEqual(["/r/1"]);
    });

    it("un grupo partido SIN identificadores no se puede recortar", () => {
        // Dos recursos distintos colapsados en la misma fila agregada, uno
        // dentro y otro fuera. No hay con qué separarlos.
        const r = recorteDeAlcance([
            { subscription_id: "s1", resource_group: "rg-mixto", service_name: "VM", ResourceId: null, Tags: { Environment: "prod" } },
            { subscription_id: "s1", resource_group: "rg-mixto", service_name: "SQL", ResourceId: null, Tags: { Environment: "dev" } },
        ], esProd);
        expect(r).toBeNull();
    });

    it("el identificador viaja en minúsculas, que es como se intersecta con Azure", () => {
        const r = recorteDeAlcance([
            fila("s1", "rg-a", "/SUBS/S1/RG-A/VM", "prod"),
            fila("s1", "rg-a", "/subs/s1/rg-a/otra", "dev"),
        ], esProd)!;
        expect([...r.resourceIds]).toEqual(["/subs/s1/rg-a/vm"]);
        // Pero el parámetro de SQL conserva el original: ahí se compara contra
        // la columna tal cual está guardada.
        expect(r.params).toEqual(["s1", "rg-a", "/SUBS/S1/RG-A/VM"]);
    });
});
