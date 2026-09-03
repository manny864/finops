/**
 * Mide qué páginas siguen renderizando en español cuando la ruta es /en/...
 *
 * POR QUÉ EXISTE
 * Varios paneles tienen los textos hardcodeados en español (`AnomalyDetectionPanel`
 * ni usaba la clave `kpiOpenAnomalies` que sí existía traducida). Para el listing
 * del Azure Marketplace importa: la ficha declara inglés y el revisor de
 * certificación clickea.
 *
 * Es la verificación de la tarea de i18n: traducir un panel de 800 líneas a mano
 * deja strings sueltos, y un panel a medio traducir se ve más roto que uno sin
 * traducir. Esto convierte "¿me faltó algo?" en un número.
 *
 * Uso:
 *   node scripts/i18n-audit.mjs                 # todas las rutas
 *   node scripts/i18n-audit.mjs /en/advisor     # sólo algunas
 *
 * Requiere el dev server en :3000 (o PLAYWRIGHT_BASE_URL).
 */
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

const TODAS = [
    "/en",
    "/en/overview/whiteboard",
    "/en/overview/maturity",
    "/en/intelligence/anomalies",
    "/en/intelligence/cost-centers",
    "/en/intelligence/cost-by-category",
    "/en/intelligence/commitments",
    "/en/intelligence/budgets",
    "/en/intelligence/scorecard",
    "/en/intelligence/storage-efficiency",
    "/en/cleanup/zombies",
    "/en/advisor",
];

const RUTAS = process.argv.slice(2).length ? process.argv.slice(2) : TODAS;

// Marcadores inequívocos de cada idioma. Se evitan falsos amigos.
const ES = /\b(de|del|los|las|por|para|con|sin|más|según|está|están|desde|hasta|ahorro|ahorros|costo|costos|recursos|suscripción|suscripciones|datos|último|últimos|mostrar|exportar|actualizar|detección|análisis|presupuesto|presupuestos|mensual|anual|tendencia|resumen|informe|informes|configuración|guardar|cerrar|sesión)\b/gi;
const EN = /\b(the|of|and|for|with|without|more|from|until|savings|cost|costs|resources|subscription|subscriptions|data|last|show|export|refresh|detection|analysis|budget|budgets|monthly|annual|trend|summary|report|reports|settings|save|close)\b/gi;

const browser = await chromium.launch();
const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: "light",
});
// Overlays que tapan la app en un context nuevo. Se marcan como vistos en vez
// de clickearlos: es determinista y no depende del texto de cada botón.
await context.addInitScript(() => {
    const ls = window.localStorage;
    ls.setItem("hasCompletedDemoLead", "true");
    ls.setItem("cscloudsolutions_telemetry_notice_dismissed_v1", "true");
    ls.setItem("cookie_consent_v1", JSON.stringify({ acceptAll: false, acceptedAt: new Date().toISOString() }));
    window.sessionStorage.setItem("copilot_shown_session", "1");
});

const page = await context.newPage();
await page.goto(`${BASE}/en/demo?tier=enterprise`);
await page.getByPlaceholder("demo").first().fill("demo");
await page.getByPlaceholder("demo").nth(1).fill("demo");
await page.getByRole("button", { name: /Entrar al Demo/i }).click();
await page.waitForURL(/\/(es|en|pt-BR)(\/)?(\?.*)?$/, { timeout: 30_000 });

const filas = [];
for (const ruta of RUTAS) {
    try {
        // Dos pasadas: contra un dev server, Next compila cada ruta on-demand la
        // primera vez, y eso puede pasar el timeout sin que la página esté rota.
        await page.goto(`${BASE}${ruta}`, { waitUntil: "commit", timeout: 180_000 }).catch(() => {});
        await page.goto(`${BASE}${ruta}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
        await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
        await page.waitForTimeout(1200);
        // Sólo el contenido: sidebar y header son iguales en todas las rutas.
        const texto = await page.evaluate(() => {
            const main = document.querySelector("main") || document.body;
            return (main.innerText || "").slice(0, 20000);
        });
        const es = (texto.match(ES) || []).length;
        const en = (texto.match(EN) || []).length;
        const total = es + en;
        filas.push({ ruta, es, en, pctEs: total ? Math.round((es / total) * 100) : 0, chars: texto.length });
    } catch (e) {
        filas.push({ ruta, error: e.message.split("\n")[0].slice(0, 60) });
    }
}

console.log("\nruta".padEnd(42), "es".padStart(5), "en".padStart(5), "%es".padStart(6), "  veredicto");
console.log("-".repeat(80));
let pendientes = 0;
for (const f of filas.sort((a, b) => (a.pctEs ?? 999) - (b.pctEs ?? 999))) {
    if (f.error) { console.log(f.ruta.padEnd(42), "  ERROR:", f.error); continue; }
    const veredicto = f.chars < 200 ? "SIN CONTENIDO" : f.pctEs <= 15 ? "INGLES" : f.pctEs >= 50 ? "ESPANOL" : "MEZCLADO";
    if (veredicto !== "INGLES" && veredicto !== "SIN CONTENIDO") pendientes++;
    console.log(
        f.ruta.padEnd(42),
        String(f.es).padStart(5),
        String(f.en).padStart(5),
        (f.pctEs + "%").padStart(6),
        "  " + veredicto
    );
}
console.log("-".repeat(80));
console.log(`${pendientes} de ${filas.length} rutas todavía no están en inglés`);

await browser.close();
process.exit(pendientes > 0 ? 1 : 0);
