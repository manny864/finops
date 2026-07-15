import { test, expect } from "@playwright/test";
import { ROUTE_TIERS } from "@/lib/routeTiers";

/**
 * Smoke test amplio: recorre TODAS las páginas gateadas por tier (Sidebar +
 * routeTiers.ts, ver docs/roles-y-permisos.md) más las de acceso libre más
 * comunes, en tier "enterprise" (desbloquea todo) vía modo demo (ver
 * setup/demo.setup.ts — sin Azure AD, con datos mock).
 *
 * No reemplaza pruebas funcionales por feature — solo detecta lo más barato
 * y de mayor impacto: una página que no renderiza, tira un error de React,
 * o pincha en consola. Cualquier falla acá es candidata a revisión manual.
 */

const FREE_ROUTES = [
    "/",
    "/advisor",
    "/overview/whiteboard",
    "/academy",
    "/cleanup/zombies",
    "/cleanup/zombies/networking",
    "/governance/tags",
    "/support",
];

const TIERED_ROUTES = Object.keys(ROUTE_TIERS);
const ALL_ROUTES = [...new Set([...FREE_ROUTES, ...TIERED_ROUTES])];

for (const route of ALL_ROUTES) {
    test(`renders without console errors: ${route}`, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on("console", (msg) => {
            if (msg.type() === "error") consoleErrors.push(msg.text());
        });
        const pageErrors: string[] = [];
        page.on("pageerror", (err) => pageErrors.push(err.message));

        const response = await page.goto(`/es${route}`, { waitUntil: "domcontentloaded" });
        expect(response?.ok(), `HTTP status para ${route}`).toBeTruthy();

        // Deja asentar renders async (fetch mock, gráficos, etc.) antes de
        // juzgar la consola — muchas páginas hacen 2-3 fetches en cascada.
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

        // Ruido conocido/no accionable: warnings de librerías de terceros,
        // no errores reales de la app. Ampliar esta lista si aparecen falsos
        // positivos nuevos en vez de bajar la vara para toda la suite.
        const KNOWN_NOISE = [/ResizeObserver loop/i, /Download the React DevTools/i];
        const realErrors = [...consoleErrors, ...pageErrors].filter(
            (e) => !KNOWN_NOISE.some((re) => re.test(e))
        );

        expect(realErrors, `Errores de consola en ${route}`).toEqual([]);
    });
}
