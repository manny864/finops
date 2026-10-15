/**
 * INFRA-08: el job de migraciones no corre como root.
 *  - Dockerfile: stage `migrator` (FROM builder) con USER no-root y sin chown de /app, así el
 *    código y node_modules quedan de sólo lectura para el proceso.
 *  - _deploy.yml construye la imagen de migraciones con --target migrator, nunca builder.
 *  - El runner sigue con USER nextjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const sinComentarios = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

const dockerfile = sinComentarios(leer("Dockerfile"));
const stages = new Map<string, string>();
for (const parte of dockerfile.split(/^(?=FROM )/m).filter((p) => p.startsWith("FROM "))) {
  const nombre = /^FROM \S+ AS (\S+)/i.exec(parte)?.[1];
  if (nombre) stages.set(nombre, parte);
}
const usuarios = (stage: string) =>
  [...stage.matchAll(/^USER\s+(\S+)/gm)].map((m) => m[1]);

describe("Dockerfile: stage migrator", () => {
  const migrator = stages.get("migrator") ?? "";

  it("existe y parte de builder", () => {
    expect(migrator).toMatch(/^FROM builder AS migrator/);
  });

  it("termina con un USER no-root", () => {
    const u = usuarios(migrator);
    expect(u.length).toBeGreaterThan(0);
    expect(u.at(-1)).not.toMatch(/^(root|0)(:|$)/);
  });

  it("no da escritura sobre /app al usuario", () => {
    expect(migrator).not.toMatch(/chown|chmod/);
  });

  it("corre npm run migrate", () => {
    expect(migrator).toMatch(/^CMD \["npm", "run", "migrate"\]/m);
  });

  it("el runner sigue siendo el último stage y corre como nextjs", () => {
    expect([...stages.keys()].at(-1)).toBe("runner");
    expect(usuarios(stages.get("runner") ?? "").at(-1)).toBe("nextjs");
  });
});

describe("_deploy.yml: imagen de migraciones", () => {
  const wf = sinComentarios(leer(".github/workflows/_deploy.yml"));

  it("se construye con --target migrator", () => {
    const targets = [...wf.matchAll(/--target\s+(\S+)/g)].map((m) => m[1]);
    expect(targets).toEqual(["migrator"]);
  });
});
