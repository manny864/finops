import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PERIM-07: sin AZURE_MARKETPLACE_AAD_APP_ID el webhook de Marketplace no puede validar la
 * audiencia y responde 503. En prod el plan de Terraform tiene que fallar antes de desplegar.
 */
const ENV = "infra/terraform/environments/prod";
const main = readFileSync(`${ENV}/main.tf`, "utf8");
const vars = readFileSync(`${ENV}/variables.tf`, "utf8");

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
    expect(main).toMatch(/lower\(var\.marketplace_aad_app_id\) == lower\(local\.legacy_marketplace_aad_app_id\)/);
  });

  it("se inyecta como env var de las apps", () => {
    expect(main).toMatch(
      /local\.marketplace_aad_app_id == null \? \{\} : \{ AZURE_MARKETPLACE_AAD_APP_ID = local\.marketplace_aad_app_id \}/,
    );
  });
});
