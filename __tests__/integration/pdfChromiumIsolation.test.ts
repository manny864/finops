// @vitest-environment node
// AISEC-03 (aceptación): el PDF se genera sin ejecutar JS ni hacer peticiones salientes,
// aun si el HTML trajera <script>/<img>/<iframe>/CSS remoto (defensa en profundidad).
import { existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumArgs, newIsolatedPage } from "@/services/pdfCompiler.service";
import { parseExecutiveMarkdownToHtml } from "@/lib/reports/reportHtmlTransformer";
import { renderPdfReportHtml } from "@/lib/reports/templates/pdfReportTemplate";

let chromium: (typeof import("playwright"))["chromium"] | null = null;
try {
  const pw = await import("playwright");
  // executablePath() devuelve la ruta esperada aunque el navegador no esté instalado.
  const exe = pw.chromium.executablePath();
  if (exe && existsSync(exe)) chromium = pw.chromium;
} catch {
  chromium = null;
}
// En CI el navegador se instala a propósito: si falta, es un error, no un skip silencioso.
if (!chromium && process.env.CI) throw new Error("Chromium de Playwright no instalado en CI");

describe.runIf(chromium)("Chromium aislado para PDF", () => {
  let server: http.Server;
  let base = "";
  const hits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url || "");
      res.end("SECRET-TOKEN");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("HTML hostil sin sanitizar: ni JS ni red; el PDF se genera", async () => {
    const browser = await chromium!.launch({ headless: true, args: chromiumArgs() });
    try {
      const page = await newIsolatedPage(browser);
      const requests: string[] = [];
      page.on("request", (r) => requests.push(r.url()));
      await page.setContent(
        `<html><head><link rel="stylesheet" href="${base}/css"><style>body{background:url(${base}/bg)}</style></head><body>
         <script>fetch("${base}/js").then(r=>r.text()).then(t=>document.body.append(t));document.title="JS"</script>
         <img src="${base}/img" onerror="document.title='JS'"><iframe src="${base}/iframe"></iframe>
         <object data="${base}/obj"></object><p>ok</p></body></html>`,
        { waitUntil: "load", timeout: 15000 },
      );
      await page.waitForTimeout(300);
      const pdf = await page.pdf({ format: "A4" });
      expect(pdf.byteLength).toBeGreaterThan(500);
      expect(await page.title()).not.toBe("JS");
      expect(await page.content()).not.toContain("SECRET-TOKEN");
      expect(hits).toEqual([]);
      // Chromium puede intentar la petición: route la aborta antes de salir (hits vacío).
      expect(requests.every((u) => u.startsWith(base) || u.startsWith("data:") || u.startsWith("about:"))).toBe(true);
    } finally {
      await browser.close();
    }
  }, 30000);

  it("pipeline real (markdown hostil -> transformer -> plantilla con CSP): sin peticiones y sin elementos peligrosos en el DOM", async () => {
    const md = [
      "## Resumen",
      `<script>fetch("${base}/js")</script>`,
      `<img src="${base}/img" onerror="alert(1)">`,
      `<iframe src="${base}/iframe"></iframe>`,
      `![x](${base}/md-img)`,
      `| a |\n|---|\n| <img src="${base}/cell"> |`,
    ].join("\n\n");
    const html = renderPdfReportHtml({
      organizationName: `Acme<img src="${base}/org">`,
      scopeDisplayName: "x",
      generationDate: "hoy",
      kpiGridHtml: "",
      parsedContentHtml: parseExecutiveMarkdownToHtml(md),
    });
    const browser = await chromium!.launch({ headless: true, args: chromiumArgs() });
    try {
      const page = await newIsolatedPage(browser);
      await page.setContent(html, { waitUntil: "load", timeout: 15000 });
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      expect(pdf.byteLength).toBeGreaterThan(500);
      expect(await page.locator("script, img, iframe, object, embed, link").count()).toBe(0);
      expect(hits).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30000);
});
