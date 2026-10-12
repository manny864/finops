import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cierre del origen a Cloudflare y Blob por identidad administrada: los dos son
 * interruptores de Terraform que por defecto NO cambian nada en producción. Estos
 * tests cuidan que sigan siendo así y que activarlos no tenga trampas:
 *
 *  - Container Apps sólo acepta IPv4 en ipAddressRange: nunca puede colarse un rango IPv6.
 *  - Con el filtro activo los cron jobs (que llaman al app desde IPs de Azure) quedan
 *    afuera si nadie los declara: un check lo impide, y el apply se frena ante un check
 *    que no pasa.
 *  - Blob por identidad administrada se prende con una variable de entorno condicional,
 *    no con un valor fijo en el mapa de env del app.
 */
const PROD = "infra/terraform/environments/prod";
const hayTerraform = spawnSync("terraform", ["version"], { encoding: "utf8" }).error === undefined;
const leer = (ruta: string) => readFileSync(ruta, "utf8");

describe("cierre del origen: valores por defecto y cableado", () => {
  const variables = leer(`${PROD}/variables.tf`);
  const main = leer(`${PROD}/main.tf`);
  const cloudflare = leer(`${PROD}/cloudflare_ips.tf`);

  it("vienen apagados: el origen sigue abierto salvo que alguien lo pida", () => {
    expect(variables).toMatch(/variable "origin_cloudflare_only"[\s\S]*?default\s*=\s*false/);
    expect(variables).toMatch(/variable "origin_extra_allowed_ip_ranges"[\s\S]*?default\s*=\s*\[\]/);
  });

  it("el stamp recibe la lista calculada y no la variable cruda", () => {
    expect(main).toMatch(/allowed_ip_ranges\s*=\s*local\.origin_allowed_ip_ranges/);
    expect(main).not.toMatch(/allowed_ip_ranges\s*=\s*var\.allowed_ip_ranges/);
  });

  it("la lista usa los rangos IPv4 de Cloudflare y nunca el catálogo combinado con IPv6", () => {
    const local = cloudflare.slice(cloudflare.indexOf("origin_allowed_ip_ranges"));
    expect(local).toContain("local.cloudflare_ipv4_cidrs");
    expect(local).not.toContain("cloudflare_all_cidrs");
    expect(local).not.toContain("cloudflare_ipv6_cidrs");
  });

  it("el catálogo IPv4 son CIDR IPv4 válidos", () => {
    const bloque = cloudflare.slice(cloudflare.indexOf("cloudflare_ipv4_cidrs"), cloudflare.indexOf("cloudflare_ipv6_cidrs"));
    const cidrs = [...bloque.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(cidrs.length).toBeGreaterThanOrEqual(10);
    for (const c of cidrs) {
      const m = c.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
      expect(m, `${c} no es un CIDR IPv4`).not.toBeNull();
      expect(m!.slice(1, 5).every((o) => Number(o) <= 255)).toBe(true);
      expect(Number(m![5])).toBeLessThanOrEqual(32);
    }
  });
});

describe.skipIf(!hayTerraform)("cierre del origen: evaluado con terraform console", () => {
  function evaluar(expresion: string, vars: Record<string, unknown>, copiarCloudflare: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), "terraform-origen-test-"));
    try {
      writeFileSync(
        join(dir, "variables.tf"),
        [
          'variable "allowed_ip_ranges" {\n  type = list(string)\n  default = []\n}',
          'variable "origin_cloudflare_only" {\n  type = bool\n  default = false\n}',
          'variable "origin_extra_allowed_ip_ranges" {\n  type = list(string)\n  default = []\n}',
        ].join("\n"),
      );
      // El archivo REAL: lo que se prueba es la expresión que se va a aplicar.
      if (copiarCloudflare) copyFileSync(`${PROD}/cloudflare_ips.tf`, join(dir, "cloudflare_ips.tf"));
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const [k, v] of Object.entries(vars)) env[`TF_VAR_${k}`] = typeof v === "string" ? v : JSON.stringify(v);
      const r = spawnSync("terraform", [`-chdir=${dir}`, "console"], { encoding: "utf8", input: `${expresion}\n`, env });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const lista = (vars: Record<string, unknown>): string[] =>
    JSON.parse(JSON.parse(evaluar("jsonencode(local.origin_allowed_ip_ranges)", vars, true)));

  it("apagado y sin rangos propios: lista vacía, el origen queda abierto como hoy", () => {
    expect(lista({})).toEqual([]);
  });

  it("apagado pero con rangos propios: se respetan tal cual y los extras se ignoran", () => {
    expect(lista({ allowed_ip_ranges: ["198.51.100.0/24"], origin_extra_allowed_ip_ranges: ["203.0.113.7/32"] })).toEqual([
      "198.51.100.0/24",
    ]);
  });

  it("encendido: Cloudflare IPv4 más los extras, sin IPv6 ni duplicados", () => {
    const r = lista({
      origin_cloudflare_only: true,
      origin_extra_allowed_ip_ranges: ["203.0.113.7/32"],
      allowed_ip_ranges: ["173.245.48.0/20"],
    });
    expect(r).toContain("173.245.48.0/20");
    expect(r).toContain("203.0.113.7/32");
    expect(r.some((c) => c.includes(":"))).toBe(false);
    expect(new Set(r).size).toBe(r.length);
    expect(r.length).toBeGreaterThanOrEqual(11);
  });

  it.each([
    [false, [], true],
    [false, ["203.0.113.7/32"], true],
    [true, [], false],
    [true, ["203.0.113.7/32"], true],
  ])("check de llamadores internos: filtro=%s extras=%j => pasa=%s", (filtro, extras, pasa) => {
    const checks = leer(`${PROD}/checks.tf`);
    const bloque = checks.slice(checks.indexOf('check "origen_cloudflare_declara_llamadores_internos"'));
    const condicion = bloque.match(/condition\s*=\s*(.+)/)?.[1];
    expect(condicion).toBeDefined();
    const r = evaluar(condicion!, { origin_cloudflare_only: filtro, origin_extra_allowed_ip_ranges: extras }, false);
    expect(r).toBe(String(pasa));
  });
});

describe("Blob por identidad administrada: interruptor del stamp", () => {
  const stamp = leer("infra/terraform/modules/stamp/main.tf");
  const stampVars = leer("infra/terraform/modules/stamp/variables.tf");
  const variables = leer(`${PROD}/variables.tf`);
  const main = leer(`${PROD}/main.tf`);

  it("viene apagado en el entorno y en el stamp", () => {
    expect(variables).toMatch(/variable "blob_managed_identity_enabled"[\s\S]*?default\s*=\s*false/);
    expect(stampVars).toMatch(/variable "blob_managed_identity_enabled"[\s\S]*?default\s*=\s*false/);
    expect(main).toMatch(/blob_managed_identity_enabled\s*=\s*var\.blob_managed_identity_enabled/);
  });

  it("AZURE_STORAGE_ACCOUNT_NAME sólo aparece dentro del local condicional", () => {
    expect(stamp).toMatch(/blob_managed_identity_env\s*=\s*var\.blob_managed_identity_enabled\s*\?\s*\{\s*AZURE_STORAGE_ACCOUNT_NAME\s*=\s*module\.storage\.account_name/);
    expect(stamp.match(/AZURE_STORAGE_ACCOUNT_NAME\s*=/g)).toHaveLength(1);
  });

  it("va después de extra_env_vars; la connection string ya no está (fase 5 de C-01): la app entra por identidad administrada", () => {
    expect(stamp).toMatch(/var\.extra_env_vars,[^)]*local\.blob_managed_identity_env\)/);
    expect(stamp).not.toContain("AZURE_STORAGE_CONNECTION_STRING");
  });
});
