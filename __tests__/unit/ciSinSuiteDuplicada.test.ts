// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Minutos de Actions (2026-10-17): en push a main la suite corría dos veces, en ci.yml y en la puerta de deploy-azure.yml.
 * Ahora ci.yml en push sólo corre si el push toca tests, y las pruebas con servicios reales viven también en la puerta.
 * Estas invariantes cuidan que ningún push quede sin ninguna de las dos y que las dos listas de pruebas no se separen.
 */
const leer = (f: string) => readFileSync(`.github/workflows/${f}`, "utf8");
const ci = leer("ci.yml");
const deploy = leer("deploy-azure.yml");

const bloque = (t: string, desde: string, hasta: string) => {
  const i = t.indexOf(desde);
  expect(i, `no existe "${desde}"`).toBeGreaterThanOrEqual(0);
  const j = t.indexOf(hasta, i + desde.length);
  return t.slice(i, j < 0 ? undefined : j);
};
const globs = (b: string) => [...b.matchAll(/^\s+-\s+'([^']+)'/gm)].map((m) => m[1]);
const comandoServicios = (t: string) => t.match(/run: (npx vitest run \S+\.mysql\.test\.ts[^\n]*)/)?.[1];

describe("ci.yml en push y la puerta de deploy-azure.yml no dejan huecos", () => {
  const pushCi = globs(bloque(ci, "  push:", "# Explícito"));
  const ignoraDeploy = globs(bloque(deploy, "    paths-ignore:", "  workflow_dispatch:"));

  it("ci.yml en push usa `paths` con los globs de tests, sin `paths-ignore`", () => {
    expect(bloque(ci, "  push:", "# Explícito")).not.toContain("paths-ignore");
    expect(pushCi).toEqual(["__tests__/**", "**/*.test.ts", "**/*.test.tsx"]);
  });

  it("todo glob de tests que el deploy ignora lo cubre ci.yml en push", () => {
    const testsIgnorados = ignoraDeploy.filter((g) => /test/.test(g));
    expect(testsIgnorados.length).toBeGreaterThan(0);
    for (const g of testsIgnorados) expect(pushCi).toContain(g);
  });

  it("la puerta corre las suites con MySQL, Redis y Azurite reales, con los mismos servicios que ci.yml", () => {
    const puerta = bloque(deploy, "  verificacion:", "  valores-de-prod:");
    expect(puerta).toMatch(/services:\s*\n\s+mysql:/);
    expect(puerta).toMatch(/\n\s+redis:/);
    expect(puerta).toContain("azure-storage/azurite");
    const enPuerta = comandoServicios(puerta);
    expect(enPuerta).toBeTruthy();
    expect(enPuerta).toBe(comandoServicios(ci));
    expect(puerta).toContain("MYSQL_SECURITY_PORT");
  });

  it("las pruebas con servicios reales siguen en el job de tests de ci.yml (para el push que sólo toca tests y para las PR)", () => {
    expect(bloque(ci, "  test:\n", "  verify:")).toContain("securityPersistence.mysql.test.ts");
  });

  it("en PR, lint + typecheck + build son un solo job y siguen en ese orden", () => {
    const jobs = [...ci.slice(ci.indexOf("\njobs:")).matchAll(/^  ([a-z]+):\n/gm)].map((m) => m[1]);
    expect(jobs).toEqual(["test", "verify"]);
    const v = bloque(ci, "  verify:", "\u0000");
    const orden = ["npm run lint", "npm run typecheck", "npm run build"].map((c) => v.indexOf(c));
    expect(orden.every((i) => i > 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });
});
