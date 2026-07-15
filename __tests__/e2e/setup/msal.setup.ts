import { test as setup, expect } from "@playwright/test";

const authFile = "playwright/.auth/user.json";

/**
 * Login MSAL real (loginRedirect contra Entra ID) con un usuario de test
 * dedicado — ver docs/testing.md § E2E. Requiere:
 *
 *  1. Un usuario en el tenant de Entra ID de la app, EXCLUIDO de cualquier
 *     política de Conditional Access que exija MFA (si el usuario recibe un
 *     prompt de Authenticator/SMS acá, este setup se cuelga esperando el
 *     redirect de vuelta — no hay forma de scriptear MFA de forma genérica,
 *     por eso el usuario de test tiene que estar exceptuado).
 *  2. TEST_USER_EMAIL / TEST_USER_PASSWORD seteadas en el entorno (nunca
 *     hardcodeadas acá ni commiteadas — usar un .env.test local, gitignoreado
 *     igual que el resto de los .env*).
 *
 * Sin esas dos env vars, playwright.config.ts ni siquiera registra este
 * project — `npm run test:e2e` corre solo la suite "demo" sin fallar.
 *
 * CAVEAT pendiente de resolver mañana: AuthProvider.tsx no fija
 * `cacheLocation` en la config de MSAL, así que usa el default de
 * @azure/msal-browser = sessionStorage. `storageState()` de Playwright NO
 * persiste sessionStorage (solo cookies + localStorage) — el token
 * capturado acá puede no sobrevivir a un nuevo browser context. Si los specs
 * ".auth.spec.ts" arrancan deslogueados pese a reusar este storageState, la
 * solución es cambiar MSAL a `cacheLocation: "localStorage"` en
 * AuthProvider.tsx (evaluar impacto de seguridad — mayor superficie XSS que
 * sessionStorage — antes de aplicarlo) o resignarse a repetir este login por
 * test file en vez de una sola vez global.
 *
 * Selectores del login de Microsoft (login.microsoftonline.com) — estables
 * hace años, pero son de un dominio que no controlamos: si Microsoft cambia
 * el markup, esto es lo primero a revisar.
 */
setup("MSAL login real", async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("TEST_USER_EMAIL / TEST_USER_PASSWORD no configuradas.");
  }

  await page.goto("/es");
  await page.getByRole("button", { name: /Iniciar sesión|Sign in|Log in/i }).click();

  // Pantalla de email
  await page.locator("#i0116").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#i0116").fill(email);
  await page.locator("#idSIButton9").click();

  // Pantalla de password
  await page.locator("#i0118").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#i0118").fill(password);
  await page.locator("#idSIButton9").click();

  // "¿Seguir conectado?" — aparece casi siempre, "No" para no persistir
  // cookies de más en el runner. Si el usuario de test SÍ tiene MFA
  // configurado por error, este waitFor es donde va a colgarse: hay que
  // volver a §1 de arriba y confirmar la exclusión de Conditional Access.
  const staySignedIn = page.locator("#idBtn_Back");
  await staySignedIn.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  if (await staySignedIn.isVisible().catch(() => false)) {
    await staySignedIn.click();
  }

  // De vuelta en la app — cualquier ruta autenticada sirve como confirmación.
  await page.waitForURL((url) => !url.hostname.includes("microsoftonline.com"), { timeout: 30_000 });
  await expect(page).not.toHaveURL(/login\.microsoftonline\.com/);

  await page.context().storageState({ path: authFile });
});
