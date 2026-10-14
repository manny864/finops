import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafeMarkdown } from "@/components/ui/SafeMarkdown";

// AISEC-02 (criterio de aceptación): sin petición de red ni enlace activo fuera de la allowlist.
const html = (md: string, components?: Parameters<typeof SafeMarkdown>[0]["components"]) =>
  render(<SafeMarkdown components={components}>{md}</SafeMarkdown>).container;

describe("SafeMarkdown", () => {
  it.each([
    "![x](https://evil/?a=1)",
    "![x][r]\n\n[r]: https://evil/?a=1",
    '<img src="https://evil/x" onerror="alert(1)">',
  ])("no renderiza imágenes: %s", (md) => {
    const c = html(md);
    expect(c.querySelector("img")).toBeNull();
    expect(c.innerHTML).not.toContain("onerror");
  });

  it.each([
    "[a](javascript:alert(1))",
    "[a](https://evil/)",
    "[a][r]\n\n[r]: https://evil",
    "https://evil.example/login",
    "<https://evil.example/login>",
    '<a href="https://evil">a</a>',
  ])("no deja enlaces activos fuera de la allowlist: %s", (md) => {
    const c = html(md);
    expect(c.querySelectorAll("a[href]")).toHaveLength(0);
  });

  it("los enlaces a learn.microsoft.com siguen funcionando", () => {
    const a = html("[docs](https://learn.microsoft.com/azure/)").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://learn.microsoft.com/azure/");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.getAttribute("target")).toBe("_blank");
  });

  it("los components visuales de la vista no pueden reabrir img/a", () => {
    const c = html("![x](https://evil/i) [a](https://evil/)", {
      img: (p) => <img {...p} />,
      a: (p) => <a {...p} />,
      table: ({ children }) => <table className="kpi">{children}</table>,
    });
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelectorAll("a[href]")).toHaveLength(0);
    expect(html("| a |\n|---|\n| 1 |", { table: ({ children }) => <table className="kpi">{children}</table> }).querySelector("table.kpi")).not.toBeNull();
  });
});
