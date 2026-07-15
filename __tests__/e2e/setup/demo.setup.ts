import { test as setup } from "@playwright/test";

const DEMO_TIER = process.env.DEMO_TEST_TIER || "enterprise";
const authFile = "playwright/.auth/demo.json";

// Login vía modo demo (demo/demo) — sin Azure AD. Setea
// `hasCompletedDemoLead` en localStorage ANTES de navegar para saltear el
// modal de captura de lead (DemoLeadModal), que de otro modo tapa el form
// de login en la primera visita de cada browser context.
setup("demo login", async ({ page, context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("hasCompletedDemoLead", "true");
  });

  await page.goto(`/es/demo?tier=${DEMO_TIER}`);
  await page.getByPlaceholder("demo").first().fill("demo");
  await page.getByPlaceholder("demo").nth(1).fill("demo");
  await page.getByRole("button", { name: /Entrar al Demo/i }).click();

  // setDemoSession redirige a "/" tras setear la cookie httpOnly.
  await page.waitForURL(/\/(es|en|pt-BR)(\/)?(\?.*)?$/, { timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
