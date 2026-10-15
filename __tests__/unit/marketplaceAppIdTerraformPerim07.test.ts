import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PERIM-07: sin AZURE_MARKETPLACE_AAD_APP_ID el webhook de Marketplace no puede validar la
 * audiencia y responde 503. En prod el plan de Terraform tiene que fallar antes de desplegar.
 */
const ENV = "infra/terraform/environments/prod";
const main = readFileSync(`${ENV}/main.tf`, "utf8");
const vars = readFileSync(`${ENV}/variables.tf`, "utf8");
const hayTerraform = spawnSync("terraform", ["version"], { encoding: "utf8" }).error === undefined;

describe("Terraform: marketplace_aad_app_id", () => {
  it("variable dedicada, nullable y con validación de GUID", () => {
    const bloque = vars.slice(vars.indexOf('variable "marketplace_aad_app_id"'));
    expect(bloque).toMatch(/default\s*=\s*null/);
    expect(bloque).toMatch(/can\(regex\(/);
  });

  it("prioriza la variable dedicada y cae a extra_env_vars por compatibilidad", () => {
    expect(main).toMatch(/lookup\(var\.extra_env_vars, "AZURE_MARKETPLACE_AAD_APP_ID", ""\)/);
    expect(main).toMatch(/var\.marketplace_aad_app_id != null \? var\.marketplace_aad_app_id :/);
  });

  it("precondición: obligatorio en prod y sin conflicto con el valor legacy", () => {
    expect(main).toMatch(/condition\s*=\s*var\.environment != "prod" \|\| local\.marketplace_aad_app_id != null/);
    expect(main).toMatch(/lower\(var\.marketplace_aad_app_id == null \? "" : var\.marketplace_aad_app_id\) == lower\(local\.legacy_marketplace_aad_app_id\)/);
  });

  // Terraform no cortocircuita `||`: un lower(null) en la condición rompía el plan de staging (variable null).
  it.skipIf(!hayTerraform).each([
    [null, "", "true"],
    [null, "AAAAAAAA-0000-0000-0000-000000000000", "true"],
    ["aaaaaaaa-0000-0000-0000-000000000000", "", "true"],
    ["aaaaaaaa-0000-0000-0000-000000000000", "AAAAAAAA-0000-0000-0000-000000000000", "true"],
    ["aaaaaaaa-0000-0000-0000-000000000000", "bbbbbbbb-0000-0000-0000-000000000000", "false"],
  ])("conflicto con legacy evaluado con terraform: var=%s legacy=%s => %s", (valor, legacy, esperado) => {
    const cond = main.match(/condition = \(\s*\n([\s\S]*?)\n\s*\)\s*\n\s*error_message\s*=\s*"marketplace_aad_app_id y extra_env_vars/)![1]
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join(" ")
      .replace(/local\.legacy_marketplace_aad_app_id/g, "var.legacy");
    const dir = mkdtempSync(join(tmpdir(), "perim07-"));
    try {
      writeFileSync(
        join(dir, "v.tf"),
        'variable "marketplace_aad_app_id" {\n  type = string\n  default = null\n}\nvariable "legacy" {\n  type = string\n}\n',
      );
      const env = { ...process.env, TF_VAR_legacy: legacy, ...(valor ? { TF_VAR_marketplace_aad_app_id: valor } : {}) };
      const r = spawnSync("terraform", [`-chdir=${dir}`, "console"], { encoding: "utf8", input: `${cond}\n`, env });
      expect(r.stderr).toBe("");
      expect(r.stdout.trim()).toBe(esperado);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("se inyecta como env var de las apps", () => {
    expect(main).toMatch(
      /local\.marketplace_aad_app_id == null \? \{\} : \{ AZURE_MARKETPLACE_AAD_APP_ID = local\.marketplace_aad_app_id \}/,
    );
  });
});
