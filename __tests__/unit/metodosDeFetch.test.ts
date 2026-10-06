// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, relative } from "path";

/**
 * Cada `fetch("/api/...", { method: X })` del cliente cae en un route.ts que
 * exporta X.
 *
 * El agujero que motiva el test: Gestión de Tenants guardaba el vendedor con
 * PATCH y `update-commercial` exporta sólo PUT. Next responde 405 con el cuerpo
 * vacío, el `res.json()` del cliente revienta, y el acuerdo comercial no se
 * guardó nunca: del 2026-08-23 al 2026-10-06, sin un solo error en el servidor.
 *
 * Lo que NO ve: URLs armadas en una variable, ni el método pasado por
 * parámetro. Sólo el caso literal, que es el de todos los botones de hoy.
 */

const RAIZ = process.cwd();
const API = join(RAIZ, "src/app/api");

// Conocidos y anotados: viven en MonitoringServiceCostBoard, que ninguna página
// monta desde el 2026-08-21 (las de alertas y action groups usan
// AlertsManagementPanel y ActionGroupsBoard). Se van con ese archivo.
const CONOCIDOS = new Set([
    "src/components/dashboard/MonitoringServiceCostBoard.tsx PUT /api/intelligence/monitoring/alerts",
    "src/components/dashboard/MonitoringServiceCostBoard.tsx DELETE /api/intelligence/monitoring/alerts",
    "src/components/dashboard/MonitoringServiceCostBoard.tsx PUT /api/intelligence/monitoring/action-groups",
    "src/components/dashboard/MonitoringServiceCostBoard.tsx DELETE /api/intelligence/monitoring/action-groups",
]);

function archivos(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) archivos(p, out);
        else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
    }
    return out;
}

/** Carpeta de la ruta para una URL con `${}`; null si ninguna la atiende. */
function carpetaDeRuta(url: string): string | null {
    // `${mock ? "?mock=true" : ""}` pegado al último segmento es query, no path.
    const segs = url.replace(/([^/])\$\{[^}]*\}/g, "$1").split("?")[0].replace(/^\/api\/?/, "").split("/").filter(Boolean);
    let dir = API;
    for (const s of segs) {
        const hijos = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((k) => k.isDirectory()).map((k) => k.name) : [];
        if (!s.includes("${") && hijos.includes(s)) { dir = join(dir, s); continue; }
        const dinamica = hijos.find((k) => /^\[.*\]$/.test(k));
        if (!dinamica) return null;
        dir = join(dir, dinamica);
        if (dinamica.startsWith("[...") || dinamica.startsWith("[[...")) return dir;
    }
    return dir;
}

describe("métodos de fetch contra los handlers de /api", () => {
    it("ningún botón pega con un método que la ruta no exporta", () => {
        const problemas: string[] = [];
        let revisados = 0;
        for (const f of archivos(join(RAIZ, "src"))) {
            const src = readFileSync(f, "utf8");
            const re = /fetch\(\s*(`[^`]*`|"[^"]*"|'[^']*')\s*,\s*\{/g;
            for (let m; (m = re.exec(src)); ) {
                const url = m[1].slice(1, -1);
                // Hasta el próximo fetch: las opciones traen llaves anidadas
                // (`JSON.stringify({...})`) y comentarios, así que no hay un `}`
                // confiable donde cortar. Así se escapaba el PATCH del vendedor.
                const opciones = src.slice(re.lastIndex, re.lastIndex + 600).split("fetch(")[0];
                const metodo = /method:\s*["'`](\w+)["'`]/.exec(opciones)?.[1]?.toUpperCase();
                if (!url.startsWith("/api/") || !metodo) continue;
                revisados++;
                const clave = `${relative(RAIZ, f)} ${metodo} ${url.split("?")[0]}`;
                const dir = carpetaDeRuta(url);
                const ruta = dir && ["route.ts", "route.js"].map((n) => join(dir, n)).find(existsSync);
                const exporta = ruta && new RegExp(
                    `export\\s+(async\\s+)?(function|const)\\s+${metodo}\\b|export\\s*\\{[^}]*\\b${metodo}\\b`
                ).test(readFileSync(ruta, "utf8"));
                if (!exporta && !CONOCIDOS.has(clave)) problemas.push(ruta ? clave : `${clave} (sin ruta)`);
            }
        }
        expect(revisados).toBeGreaterThan(100); // si baja de golpe, el scan dejó de ver los fetch
        expect(problemas).toEqual([]);
    });
});
