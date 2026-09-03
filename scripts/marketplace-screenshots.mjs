/**
 * Genera las 5 capturas para el listing del Azure Marketplace.
 *
 * 1280x720 EXACTOS: es lo que exige Partner Center. Por eso viewport 1280x720,
 * deviceScaleFactor 1 (con 2 saldrían 2560x1440 y el form las rechaza) y
 * screenshot del viewport, no fullPage (fullPage daría el alto de la página).
 *
 * En inglés (/en/...) porque el listing es en inglés, y en tier enterprise para
 * que no haya pantallas bloqueadas por gate. Modo demo: los datos son mock, no
 * de ningún cliente.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";

const BASE = "http://localhost:3000";
const OUT = "marketplace/azure/screenshots";

const CAPTURAS = [
    { archivo: "01-dashboard.png", ruta: "/en", nombre: "Dashboard principal" },
    { archivo: "02-anomalies.png", ruta: "/en/intelligence/anomalies", nombre: "Anomalías con dueño" },
    { archivo: "03-cost-centers.png", ruta: "/en/intelligence/cost-centers", nombre: "Centros de costo" },
    { archivo: "04-commitments.png", ruta: "/en/intelligence/commitments", nombre: "Compromisos" },
    { archivo: "05-scorecard.png", ruta: "/en/intelligence/scorecard", nombre: "Scorecard FinOps" },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: "light",
});

/**
 * Tres overlays tapan la app en la primera visita de un browser context nuevo y
 * arruinarían cualquier captura. Se marcan como ya vistos en localStorage en vez
 * de clickearlos: es determinista y no depende de que el texto del botón no
 * cambie con el idioma.
 *
 * El consentimiento de cookies se setea en `acceptAll: false` --sólo las
 * esenciales-- porque es la opción que preserva la privacidad y es la que
 * corresponde elegir por defecto.
 */
await context.addInitScript(() => {
    const ls = window.localStorage;
    // DemoLeadModal: tapa el form de login del modo demo
    ls.setItem("hasCompletedDemoLead", "true");
    // TelemetryDelayModal: modal centrado, aparece 1.2s después de autenticar
    ls.setItem("cscloudsolutions_telemetry_notice_dismissed_v1", "true");
    // CookieConsent: banner fijo al pie
    ls.setItem("cookie_consent_v1", JSON.stringify({ acceptAll: false, acceptedAt: new Date().toISOString() }));
});

const page = await context.newPage();

// Login por modo demo (demo/demo, sin Azure AD). Tier enterprise desbloquea todo.
await page.goto(`${BASE}/es/demo?tier=enterprise`);
await page.getByPlaceholder("demo").first().fill("demo");
await page.getByPlaceholder("demo").nth(1).fill("demo");
await page.getByRole("button", { name: /Entrar al Demo/i }).click();
await page.waitForURL(/\/(es|en|pt-BR)(\/)?(\?.*)?$/, { timeout: 30_000 });
console.log("login demo ok");

for (const { archivo, ruta, nombre } of CAPTURAS) {
    try {
        // Dos pasadas: contra un dev server, Next compila cada ruta on-demand la
        // primera vez que se pide, y eso puede pasar el timeout sin que la
        // página tenga nada roto (ver el comentario de timeout en
        // playwright.config.ts). La primera navegación precalienta y se descarta;
        // la segunda es la que se captura, ya con la ruta compilada.
        await page.goto(`${BASE}${ruta}`, { waitUntil: "commit", timeout: 180_000 }).catch(() => {});
        await page.goto(`${BASE}${ruta}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
        // Los gráficos de Recharts animan al montar; sin esta espera salen a medio dibujar.
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${OUT}/${archivo}` });
        console.log(`ok  ${archivo}  <- ${ruta}  (${nombre})`);
    } catch (e) {
        console.log(`FALLO  ${archivo}  <- ${ruta}: ${e.message.split("\n")[0]}`);
    }
}

await browser.close();
