// @vitest-environment node
/**
 * El dataset de la demo no puede viajar al navegador de un cliente real.
 *
 * `src/lib/mockData.ts` tiene 4.4k líneas (292 KB) y arrastra servicios de dominio. Mientras
 * `isMockTenant` vivía ahí, 184 componentes de cliente lo importaban para evaluar un `if` y el
 * 96% de las páginas (241 de 250) descargaban 194 KB gzip de datos inventados. Medido en el build
 * del 2026-10-06; después de moverlo a `demoTenant.ts`, 0 de 252 páginas lo cargan.
 *
 * Este test deriva el grafo de imports del árbol de fuentes (como `guardRutasApi` y
 * `fetchConSesion`): desde cada archivo con `'use client'` sigue los imports de valor y exige que
 * `mockData.ts` no sea alcanzable. Un `import()` dinámico no cuenta (es el camino correcto: carga
 * diferida) y tampoco un `import type` (se borra en el build).
 *
 * Si falla: el archivo que te nombra el mensaje importa `@/lib/mockData` y es alcanzable desde el
 * cliente. Si sólo necesita `isMockTenant` o las constantes de identidad, importalo de
 * `@/lib/demoTenant`; si necesita datos, hacé `await import("@/lib/mockData")` en el momento de usarlos.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const RAIZ = process.cwd();
const OBJETIVO = "src/lib/mockData.ts";

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:([^'";]*?)\s+from\s+)?['"]([^'"]+)['"]/g;

function archivosDeFuente(): string[] {
    return execSync("git ls-files 'src/*.ts' 'src/*.tsx'", { cwd: RAIZ, encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
}

/** `import { type A, type B } from "x"` se borra entero en el build: no es una dependencia. */
function soloTipos(clausula: string | undefined): boolean {
    if (!clausula) return false;
    const llaves = clausula.match(/^\s*\{([^}]*)\}\s*$/);
    if (!llaves) return false;
    const specs = llaves[1].split(",").map((s) => s.trim()).filter(Boolean);
    return specs.length > 0 && specs.every((s) => s.startsWith("type "));
}

function construirGrafo(archivos: string[]) {
    const existentes = new Set(archivos);
    const resolver = (origen: string, spec: string): string | null => {
        let base: string;
        if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
        else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(origen), spec));
        else return null;
        for (const sufijo of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
            if (existentes.has(base + sufijo)) return base + sufijo;
        }
        return null;
    };
    const grafo = new Map<string, Set<string>>();
    const cliente = new Set<string>();
    for (const f of archivos) {
        const texto = readFileSync(path.join(RAIZ, f), "utf8");
        if (/^\s*['"]use client['"]/m.test(texto.slice(0, 400))) cliente.add(f);
        const deps = new Set<string>();
        for (const m of texto.matchAll(IMPORT_RE)) {
            if (m[1] || soloTipos(m[2])) continue;
            const r = resolver(f, m[3]);
            if (r) deps.add(r);
        }
        grafo.set(f, deps);
    }
    return { grafo, cliente };
}

describe("el dataset de la demo no llega al bundle del cliente", () => {
    const { grafo, cliente } = construirGrafo(archivosDeFuente());

    it("hay una cantidad razonable de raíces de cliente (el test no está leyendo en vacío)", () => {
        expect(cliente.size).toBeGreaterThan(300);
        expect(existsSync(path.join(RAIZ, OBJETIVO))).toBe(true);
    });

    it("mockData.ts no es alcanzable desde ningún archivo 'use client' por imports de valor", () => {
        const padre = new Map<string, string | null>();
        const cola: string[] = [];
        for (const c of cliente) { padre.set(c, null); cola.push(c); }
        while (cola.length) {
            const u = cola.shift()!;
            for (const v of grafo.get(u) ?? []) {
                if (!padre.has(v)) { padre.set(v, u); cola.push(v); }
            }
        }
        if (!padre.has(OBJETIVO)) return;
        // Se arma el camino para que el mensaje diga QUIÉN lo trae.
        const puentes = [...grafo.keys()].filter((f) => grafo.get(f)!.has(OBJETIVO) && padre.has(f));
        const caminos = puentes.map((f) => {
            const c: string[] = [];
            for (let u: string | null | undefined = f; u; u = padre.get(u)) c.push(path.posix.basename(u));
            return c.reverse().join(" -> ") + ` (${f})`;
        });
        expect(caminos, "importan @/lib/mockData y son alcanzables desde el cliente").toEqual([]);
    });

    it("demoTenant.ts no importa nada: un componente de cliente puede traerlo sin arrastrar dependencias", () => {
        const texto = readFileSync(path.join(RAIZ, "src/lib/demoTenant.ts"), "utf8");
        expect([...texto.matchAll(IMPORT_RE)].map((m) => m[3])).toEqual([]);
    });

    it("mockData.ts sigue exponiendo lo que se movió: ~300 archivos de servidor y 30 tests lo importan de ahí", async () => {
        const demo = await import("@/lib/demoTenant");
        const datos = await import("@/lib/mockData");
        expect(datos.isMockTenant).toBe(demo.isMockTenant);
        expect(datos.MOCK_AZURE_TENANTS).toBe(demo.MOCK_AZURE_TENANTS);
        expect(datos.MOCK_AZURE_SUBSCRIPTIONS).toBe(demo.MOCK_AZURE_SUBSCRIPTIONS);
        expect(datos.MOCK_ONBOARDING_CLIENT_TENANT).toBe(demo.MOCK_ONBOARDING_CLIENT_TENANT);
    });

    it("el predicado reconoce a los tenants demo y no a uno real", async () => {
        const { isMockTenant, MOCK_AZURE_TENANTS } = await import("@/lib/demoTenant");
        for (const id of ["demo", "demo_tenant", "demo-tenant", " DEMO ", "mock-1", ...MOCK_AZURE_TENANTS]) {
            expect(isMockTenant(id), id).toBe(true);
        }
        for (const id of ["", "8b41364f-581a-4e43-b7cb-13138dac5517", "contoso"]) {
            expect(isMockTenant(id), id || "(vacío)").toBe(false);
        }
    });
});
