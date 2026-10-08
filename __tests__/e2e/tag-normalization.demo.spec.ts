import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Valores no conformes de Tag Governance en modo demo: el normalizador
 * sugiere el canónico, la IA (mock, sin llamar a ningún proveedor) propone lo
 * que quedó, y nada se aplica sin pasar por la confirmación. Con
 * TAGS_SCREENS_DIR guarda capturas de cada paso.
 */
const SCREENS = process.env.TAGS_SCREENS_DIR;

async function captura(objetivo: Page | Locator, nombre: string) {
    if (SCREENS) await objetivo.screenshot({ path: `${SCREENS}/${nombre}.png` });
}

async function abrir(page: Page) {
    // El Copilot se abre solo una vez por sesión y taparía la sección.
    await page.addInitScript(() => window.sessionStorage.setItem("copilot_shown_session", "1"));
    await page.goto("/es/governance/tags", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Entendido y Continuar" }).click({ timeout: 10_000 }).catch(() => {});
    await page.getByRole("button", { name: "Essential Only" }).click({ timeout: 3_000 }).catch(() => {});
    await expect(page.getByTestId("tag-non-conforming")).toBeVisible({ timeout: 30_000 });
}

const fila = (page: Page, valor: string) =>
    page.getByTestId("tag-non-conforming").locator("tr", { has: page.locator("code", { hasText: new RegExp(`^${valor}$`) }) });

test.describe("Tag Governance · valores no conformes (demo)", () => {
    test("el normalizador sugiere el canónico y la IA sólo propone el residuo", async ({ page }) => {
        await abrir(page);
        const seccion = page.getByTestId("tag-non-conforming");

        await expect(page.getByTestId("tag-normalization-kpis")).toContainText("87%");
        await expect(fila(page, "Production")).toContainText("Alias");
        await expect(fila(page, "storge")).toContainText("Parecido");
        await expect(fila(page, "PROD")).toContainText("Formato");
        await captura(seccion, "01-valores-no-conformes");

        await fila(page, "k8s-cluster").getByRole("button", { name: "Sugerir con IA" }).click();
        await expect(fila(page, "k8s-cluster")).toContainText("IA · 86%");
        await expect(fila(page, "k8s-cluster").locator("select")).toHaveValue("orchestrator");
        await captura(seccion, "02-sugerencia-ia");

        await fila(page, "storge").getByRole("button", { name: "Aplicar" }).click();
        const dialogo = page.getByRole("dialog");
        await expect(dialogo).toContainText("«storge» a «storage»");
        await expect(dialogo.getByRole("checkbox")).toBeVisible();
        await captura(dialogo, "03-confirmacion-alias");
        await dialogo.getByRole("button", { name: "Confirmar y aplicar" }).click();
        await expect(dialogo).toBeHidden();
        await expect(fila(page, "storge")).toHaveCount(0);
        await expect(seccion).toBeVisible();
    });

    test("CostCenter faltante: primero se hereda del grupo, la IA propone entre los valores en uso", async ({ page }) => {
        await abrir(page);
        const costCenter = page.getByTestId("tag-missing-CostCenter");
        await costCenter.scrollIntoViewIfNeeded();
        await expect(costCenter.getByRole("button", { name: /Heredar del grupo/ })).toBeVisible();

        await costCenter.getByRole("button", { name: /Proponer con IA/ }).click();
        const jumpbox = costCenter.locator("tr", { hasText: "vm-jumpbox-legacy" });
        await expect(jumpbox.locator("select")).toHaveValue("CorePlatform");
        await expect(jumpbox).toContainText("64%");
        await jumpbox.getByRole("checkbox").check();
        await expect(costCenter.getByRole("button", { name: "Aplicar aprobadas (1)" })).toBeEnabled();
        await captura(costCenter, "04-propuesta-costcenter");
    });

    test("la auditoría distingue faltantes de valores no permitidos y las políticas muestran sus valores", async ({ page }) => {
        await abrir(page);
        await expect(page.getByText("Valor libre").first()).toBeVisible();
        await captura(page, "05-politicas-y-kpis");

        const encabezado = page.getByRole("columnheader", { name: "Faltantes o No Permitidas" }).first();
        await encabezado.scrollIntoViewIfNeeded();
        await expect(encabezado).toBeVisible();
        await expect(page.getByTitle(/^Valor no permitido/).first()).toBeVisible();
        await captura(page, "06-auditoria-recursos");

        await page.getByRole("button", { name: "Gestionar Políticas" }).click();
        await expect(page.getByText("Entorno operativo del recurso para imputación y segregación de costos.")).toBeVisible();
        await expect(page.getByText("OBLIGATORIA").first()).toBeVisible();
        await captura(page, "07-modal-politicas");
    });
});
