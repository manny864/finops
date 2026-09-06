import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

const correr = (args: string[]) => {
  try {
    return { code: 0, out: execFileSync("node", ["scripts/i18n-detectar-espanol.mjs", ...args], { encoding: "utf-8" }) };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

describe("catalogos de traduccion", () => {
  it("el detector sigue detectando lo que fue escrito para detectar", () => {
    // Sin esto el gate de abajo se vuelve un test que siempre pasa: un
    // detector roto tambien reporta cero hallazgos.
    const { code, out } = correr(["--test"]);
    expect(out, out).toContain("OK:");
    expect(code).toBe(0);
  });

  it("no quedan valores en espanol en en.json ni pt-BR.json", () => {
    const { code, out } = correr([]);
    expect(out.split("### ").slice(1).map((b) => b.split("\n")[0]), out).toEqual([]);
    expect(code).toBe(0);
  });
});
