// @vitest-environment node
/**
 * Un componente de cliente que llama a la API manda la sesión.
 *
 * El 2026-10-04 aparecieron ONCE lugares que llamaban a rutas protegidas con un
 * `fetch` pelado: Leaderboard, Fin de soporte, Capacidad de red, Vistas
 * guardadas, Suscripciones a reportes, el historial de inicios de sesión de
 * M365, la barra de impersonación, el aviso de borrado terminado, el pedido de
 * reporte SOC 2, Chargeback y Azure AI Services. Para cualquier tenant real
 * respondían 401. En el demo funcionaban, porque TenantProvider intercepta el
 * fetch y sirve mocks, y por eso nadie lo vio: un comentario lo atribuía a "una
 * sesión vencida". Unas cabeceras con sólo `Content-Type` tampoco son sesión.
 *
 * La regla: en un archivo "use client", un `fetch` a /api/ lleva cabeceras o
 * pasa por `fetchWithAuthRetry`, salvo que la ruta sea pública o que la llamada
 * esté en la rama del demo.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Rutas que responden sin sesión a propósito. */
const PUBLICAS = ["/api/fx/rates", "/api/pricing/plans", "/api/templates/powerbi", "/api/leads/demo"];

function archivosDeCliente(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) archivosDeCliente(p, acc);
        else if (/\.(tsx|ts)$/.test(e.name)) {
            const s = fs.readFileSync(p, "utf8");
            if (/^\s*["']use client["']/.test(s)) acc.push(p);
        }
    }
    return acc;
}

function llamadasSinSesion(): string[] {
    const malas: string[] = [];
    for (const archivo of archivosDeCliente(path.join(process.cwd(), "src"))) {
        const s = fs.readFileSync(archivo, "utf8");
        if (!s.includes("/api/")) continue;
        const lineas = s.split("\n");
        lineas.forEach((linea, i) => {
            const m = linea.match(/\bfetch\(\s*([`"'](\/api\/[^`"'?$]*)|[A-Za-z_]\w*\s*[,)])/);
            if (!m) return;
            const ruta = m[2];
            if (ruta && PUBLICAS.some((p) => ruta.startsWith(p))) return;
            // La llamada misma: esta línea y las que siguen hasta cerrar. Unas
            // cabeceras con SÓLO Content-Type no son sesión: así estaba el POST
            // de vistas guardadas, y pasaba por "tiene headers".
            const llamada = lineas.slice(i, i + 8).join("\n")
                .replace(/headers:\s*\{\s*["']Content-Type["']\s*:\s*["'][^"']+["']\s*,?\s*\}/g, "");
            if (/headers|Authorization/.test(llamada)) return;
            // La rama del demo: TenantProvider la intercepta y no necesita token.
            const antes = lineas.slice(Math.max(0, i - 4), i + 1).join("\n");
            if (/isMock|esMock|isMockTenant|IS_DEMO/.test(antes)) return;
            // Un fetch con URL variable sólo cuenta si el archivo arma URLs de la API.
            if (!ruta && !/useSWR|\/api\//.test(s)) return;
            malas.push(`${path.relative(process.cwd(), archivo)}:${i + 1}  ${linea.trim()}`);
        });
    }
    return malas;
}

describe("las llamadas del navegador a la API llevan la sesión", () => {
    it("ningún fetch pelado a una ruta protegida", () => {
        expect(llamadasSinSesion()).toEqual([]);
    });
});
