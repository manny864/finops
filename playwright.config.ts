import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra la app real (dev server local por defecto, o cualquier deploy
 * vía PLAYWRIGHT_BASE_URL — ej. staging/producción de solo lectura).
 *
 * Dos formas de "estar logueado", cada una con su setup project y su
 * storageState propio (ver docs/testing.md § E2E):
 *  - "demo": /es/demo (demo/demo) — sin Azure AD, cubre la UI con datos mock.
 *    Corre siempre, no necesita credenciales.
 *  - "authenticated": loginRedirect real contra Entra ID con un usuario de
 *    test (TEST_USER_EMAIL/TEST_USER_PASSWORD) — cubre auth/backend real.
 *    Se salta automáticamente si esas env vars no están seteadas.
 */
const hasRealTestUser = Boolean(process.env.TEST_USER_EMAIL && process.env.TEST_USER_PASSWORD);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const usingLocalServer = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./__tests__/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  // 60s (no 30s por default): contra un dev server local, Next compila cada
  // ruta on-demand la primera vez que se pide — con varios workers pegándole
  // a rutas nunca visitadas en simultáneo, esa compilación en frío puede
  // superar los 30s aunque la página en sí no tenga nada roto (confirmado:
  // las mismas rutas que timeouteaban con 5 workers pasan solas en <11s).
  // Contra un build de producción (PLAYWRIGHT_BASE_URL) esto no aplica.
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "demo-setup", testMatch: /demo\.setup\.ts/ },
    ...(hasRealTestUser ? [{ name: "auth-setup", testMatch: /msal\.setup\.ts/ }] : []),
    {
      name: "demo",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/demo.json" },
      dependencies: ["demo-setup"],
      testMatch: /.*\.demo\.spec\.ts/,
    },
    ...(hasRealTestUser
      ? [
          {
            name: "authenticated",
            use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
            dependencies: ["auth-setup"],
            testMatch: /.*\.auth\.spec\.ts/,
          },
        ]
      : []),
  ],
  // Si apuntamos a localhost y no hay un dev server ya corriendo, lo levanta.
  // Contra staging/producción (PLAYWRIGHT_BASE_URL seteado) no arranca nada local.
  webServer: usingLocalServer
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
