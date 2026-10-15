// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseExecutiveMarkdownToHtml } from "@/lib/reports/reportHtmlTransformer";
import { renderPdfReportHtml } from "@/lib/reports/templates/pdfReportTemplate";
import { renderEmailReportHtml } from "@/lib/reports/templates/emailReportTemplate";
import { chromiumArgs } from "@/services/pdfCompiler.service";

// AISEC-03: HTML crudo del LLM no llega a Chromium ni al email.
const VECTORS = [
  "<script>fetch('http://169.254.169.254/metadata/identity/oauth2/token')</script>",
  '<img src="http://169.254.169.254/x">',
  '<img src=x onerror="alert(1)">',
  '<iframe src="http://169.254.169.254/"></iframe>',
  '<svg onload="alert(1)"></svg>',
  '<style>body{background:url(http://169.254.169.254/)}</style>',
  '<link rel="stylesheet" href="http://169.254.169.254/">',
  '<meta http-equiv="refresh" content="0;url=http://169.254.169.254/">',
  '<a href="javascript:alert(1)">x</a>',
  '<object data="http://169.254.169.254/"></object>',
  "![x](http://169.254.169.254/x)",
  "[a](http://169.254.169.254/)",
  "| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | <script>x</script> |",
  "# <img src=x onerror=alert(1)> título",
  "- <script>x</script> ítem\n- `<img src=x onerror=alert(1)>`",
  "> <iframe src=//evil></iframe> nota",
];

// Elementos activos, handlers o destinos (href/src) peligrosos. El texto escapado es inofensivo.
const DANGEROUS = /<(script|img|iframe|svg|style|link|meta|object|embed|form|input)\b|<[^>]+\son\w+\s*=|(href|src)\s*=\s*["']?\s*(javascript:|http:|\/\/)|(href|src)\s*=\s*["'][^"']*169\.254/i;

describe("parseExecutiveMarkdownToHtml — AISEC-03", () => {
  it.each(VECTORS)("sin elementos ni destinos peligrosos: %s", (md) => {
    expect(parseExecutiveMarkdownToHtml(`## Sección\n\n${md}\n\nfin`)).not.toMatch(DANGEROUS);
  });

  it("el código inline se muestra escapado, no se interpreta", () => {
    expect(parseExecutiveMarkdownToHtml("usar `a < b && c > \"d\"`")).toContain('<code class="report-code">a &lt; b &amp;&amp; c &gt; "d"</code>');
  });

  it("conserva formato inline dentro de tablas, títulos y listas", () => {
    const html = parseExecutiveMarkdownToHtml("## **Total** 1\n\n| **A** |\n|---|\n| *b* |\n\n- **c** y [docs](https://learn.microsoft.com/x)");
    expect(html).toContain('<h2 class="report-h2"><strong>Total</strong> 1</h2>');
    expect(html).toContain("<th><strong>A</strong></th>");
    expect(html).toContain("<td><em>b</em></td>");
    expect(html).toContain('<li class="report-li"><strong>c</strong> y <a href="https://learn.microsoft.com/x">docs</a></li>');
  });
});

describe("plantillas — AISEC-03", () => {
  const evilName = `Acme</title><script>alert(1)</script>"; } body { background: url(http://169.254.169.254/) } x { content: "`;

  it("PDF: CSP sin red y nombre del tenant escapado en HTML y CSS", () => {
    const html = renderPdfReportHtml({
      organizationName: evilName,
      scopeDisplayName: "<img src=x onerror=alert(1)>",
      generationDate: "hoy",
      kpiGridHtml: "",
      parsedContentHtml: "",
    });
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" />`);
    expect(html).not.toMatch(/<script|<img/);
    const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
    // La cadena CSS del encabezado no puede cerrarse: sin ", ;, {, }, < ni / literales adentro.
    const content = style.match(/content: "([^"]*)· Reporte Ejecutivo FinOps";/)![1];
    expect(content).not.toMatch(/[";{}<>/]/);
    expect(style).not.toContain("</");
    expect(html).toContain("<title>Reporte Ejecutivo FinOps · Acme&lt;/title&gt;&lt;script&gt;");
  });

  it("email: tenant, alcance e intro de IA como texto", () => {
    const html = renderEmailReportHtml({
      tenantName: "<script>x</script>",
      scopeDisplayName: "<img src=x onerror=alert(1)>",
      generationDate: "hoy",
      introMessage: '<a href="https://evil.example">Renueve</a>',
      kpiHighlights: [],
      parsedContentHtml: "",
    });
    expect(html).not.toMatch(/<script|<img|href="https:\/\/evil/);
  });
});

describe("chromiumArgs", () => {
  it("sandbox activo por defecto; --no-sandbox sólo con opt-in explícito", () => {
    expect(chromiumArgs({})).not.toContain("--no-sandbox");
    expect(chromiumArgs({ PDF_CHROMIUM_NO_SANDBOX: "true" })).toContain("--no-sandbox");
  });
});
