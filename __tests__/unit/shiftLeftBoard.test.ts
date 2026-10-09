// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
    celdaDeTexto, claveDeAccion, claveDeMotivo, claveDeNota, construirCsv, repositoriosDe, serieDeTendencia,
    type FilaEstimacion,
} from "@/lib/shiftLeftBoard";
import { itemsDemo } from "@/lib/shiftLeftDemo";

const fila = (o: Partial<FilaEstimacion>): FilaEstimacion => ({
    id: 1, repository: "acme/infra", pr_number: 1, author: "lucia", current_monthly_cost_usd: "100.0000",
    projected_monthly_cost_usd: "250.5000", delta_cost_usd: "150.5000", resources_priced: 3, resources_unpriced: 1,
    gate_status: "OK", created_at: "2026-10-08T10:00:00Z", meta: null, ...o,
});

describe("claves de traducción de los códigos del estimador", () => {
    const es = JSON.parse(readFileSync("messages/es.json", "utf8")).ShiftLeft;

    it("cada motivo, nota y acción que el estimador puede emitir tiene su texto", () => {
        const motivos = ["por-uso", "tipo-no-soportado", "sin-sku", "sin-region", "sin-precio", "valor-al-aplicar", "precio-no-disponible"];
        const notas = [
            "disco-os-no-incluido", "discos-os-no-incluidos", "datos-procesados-no-incluidos", "transferencia-no-incluida",
            "unidades-de-capacidad-no-incluidas", "instancias-adicionales-no-incluidas", "almacenamiento-no-incluido",
            "reglas-adicionales-y-datos-no-incluidos", "lts-no-incluido", "autoescalado-minimo", "spot-variable", "region-inferida",
        ];
        const acciones = ["create", "update", "delete", "replace", "no-op"];
        for (const m of motivos) expect(es[claveDeMotivo(m)], m).toBeTypeOf("string");
        for (const n of notas) expect(es[claveDeNota(n)], n).toBeTypeOf("string");
        for (const a of acciones) expect(es[claveDeAccion(a)], a).toBeTypeOf("string");
    });

    it("los códigos que emite el catálogo y los de la pantalla no se desfasan", () => {
        // Si el catálogo suma una nota o un motivo y nadie le escribe el texto, la pantalla
        // mostraría la clave cruda. Se leen del fuente: las notas, de las líneas que arman `notas`;
        // los motivos, de la unión de tipos.
        const catalogo = readFileSync("src/services/iacCostCatalog.ts", "utf8");
        const motivos = [...catalogo.slice(catalogo.indexOf("export type MotivoSinTarifar"), catalogo.indexOf("export interface Componente"))
            .matchAll(/\|\s*"([a-z-]+)"/g)].map((m) => m[1]);
        const notas = new Set(
            catalogo.split("\n").filter((l) => /notas/.test(l) && !/^\s*(\/\/|\*)/.test(l))
                .flatMap((l) => [...l.matchAll(/"([a-z]+(?:-[a-z]+)+)"/g)].map((m) => m[1]))
                .filter((n) => !/^(sin|tipo)-/.test(n) || /incluid/.test(n))
        );
        expect(motivos.length).toBe(7);
        expect(notas.size).toBeGreaterThanOrEqual(12);
        for (const m of motivos) expect(es[claveDeMotivo(m)], `el motivo "${m}" no tiene texto`).toBeTypeOf("string");
        for (const n of notas) expect(es[claveDeNota(n)], `la nota "${n}" no tiene texto`).toBeTypeOf("string");
    });
});

describe("repositoriosDe y serieDeTendencia", () => {
    const items = [
        fila({ id: 1, repository: "a/viejo", created_at: "2026-10-01T10:00:00Z" }),
        fila({ id: 2, repository: "a/nuevo", created_at: "2026-10-07T10:00:00Z", delta_cost_usd: "10" }),
        fila({ id: 3, repository: "a/nuevo", created_at: "2026-10-05T10:00:00Z", delta_cost_usd: "30" }),
        fila({ id: 4, repository: "a/nuevo", created_at: "2026-10-06T10:00:00Z", delta_cost_usd: "-5" }),
    ];

    it("ordena los repositorios por actividad reciente", () => {
        expect(repositoriosDe(items)).toEqual(["a/nuevo", "a/viejo"]);
        expect(repositoriosDe([])).toEqual([]);
    });

    it("la serie va del más viejo al más nuevo, con deltas numéricos", () => {
        expect(serieDeTendencia(items, "a/nuevo").map((p) => p.delta)).toEqual([30, -5, 10]);
        expect(serieDeTendencia(items, "a/nuevo").map((p) => p.id)).toEqual([3, 4, 2]);
        expect(serieDeTendencia(items, "no/existe")).toEqual([]);
    });

    it("desempata por id cuando dos estimaciones caen en el mismo instante", () => {
        const mismo = [fila({ id: 9, created_at: "2026-10-08T10:00:00Z" }), fila({ id: 8, created_at: "2026-10-08T10:00:00Z" })];
        expect(serieDeTendencia(mismo, "acme/infra").map((p) => p.id)).toEqual([8, 9]);
    });
});

describe("el CSV", () => {
    it("tiene una fila por estimación y una cabecera", () => {
        const csv = construirCsv([fila({ id: 1 }), fila({ id: 2 })]);
        const lineas = csv.split("\n");
        expect(lineas).toHaveLength(3);
        expect(lineas[0]).toContain("repositorio");
        expect(lineas[1].split(",").length).toBe(lineas[0].split(",").length);
    });

    it("lleva los montos con dos decimales y el descuento y el presupuesto de meta", () => {
        const csv = construirCsv([fila({ meta: { tool: "bicep", discount_pct: 20, list_delta_cost_usd: 188.13, gate_reason: "pct",
            budget: { cost_center: "Plataforma", monthly_usd: 4000, spent_usd: 1, remaining_usd: 3999, delta_pct_of_budget: 3.76, delta_pct_of_remaining: 3.76 } } })]);
        const c = csv.split("\n")[1];
        expect(c).toContain("100.00,250.50,150.50,188.13,20,OK,pct,1,Plataforma,3.76");
        expect(c).toContain("bicep");
    });

    it("un delta negativo no se confunde con una fórmula: es un número", () => {
        const c = construirCsv([fila({ delta_cost_usd: "-184.3200" })]).split("\n")[1];
        expect(c).toContain(",-184.32,");
        expect(c).not.toContain("'-184.32");
    });

    it("neutraliza las fórmulas en lo que viene de afuera: repositorio, autor, centro de costos", () => {
        for (const peligroso of ["=HYPERLINK(\"http://x\")", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=1+1"]) {
            const c = construirCsv([fila({ author: peligroso, repository: peligroso })]).split("\n")[1];
            expect(c).not.toMatch(new RegExp(`(^|,)${peligroso.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
            expect(celdaDeTexto(peligroso).replace(/^"/, "")).toMatch(/^'/);
        }
    });

    it("escapa comas, comillas y saltos de línea (RFC 4180)", () => {
        expect(celdaDeTexto('a,b')).toBe('"a,b"');
        expect(celdaDeTexto('di "hola"')).toBe('"di ""hola"""');
        expect(celdaDeTexto("a\nb")).toBe('"a\nb"');
        expect(celdaDeTexto(null)).toBe("");
    });

    it("funciona con los datos de demo", () => {
        expect(construirCsv(itemsDemo() as any).split("\n").length).toBe(itemsDemo().length + 1);
    });
});
