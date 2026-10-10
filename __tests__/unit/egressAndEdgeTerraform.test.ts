import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Salida fija (NAT Gateway), certificado propio y versión de MySQL: todo viene apagado y lo
 * que se enciende no puede tocar lo existente. Estos tests cuidan lo que no se nota hasta que
 * falla en producción:
 *
 *  - Container Apps sólo admite NAT Gateway Standard (StandardV2 no está soportado).
 *  - El binding del dominio ignora el id del certificado: cambiarlo desde Terraform lo
 *    recrearía en producción. Crear el certificado propio y borrar el gestionado nunca van
 *    en el mismo apply (Azure no borra un certificado en uso).
 *  - Filtrar el origen a Cloudflare sin declarar la IP de salida del entorno deja a los cron
 *    con 403: lo impone un check y el apply se frena ante un check que no pasa.
 *  - Una versión de MySQL mal puesta en el tfvars no puede disparar la actualización mayor,
 *    que es irreversible.
 *
 * Front Door se eliminó del Terraform el 2026-10-10 (se eligió Cloudflare + NAT Gateway +
 * certificado propio); el último estado del módulo está en el commit 979582f.
 */
const TF = "infra/terraform";
const PROD = `${TF}/environments/prod`;
const leer = (ruta: string) => readFileSync(ruta, "utf8");
const hayTerraform = spawnSync("terraform", ["version"], { encoding: "utf8" }).error === undefined;

describe("NAT Gateway: salida fija del entorno", () => {
  const red = leer(`${TF}/modules/network/main.tf`);
  const redVars = leer(`${TF}/modules/network/variables.tf`);
  const redOut = leer(`${TF}/modules/network/outputs.tf`);

  it("viene apagado en el módulo, en el stamp y en el mapa del entorno", () => {
    expect(redVars).toMatch(/variable "nat_gateway_enabled"[\s\S]*?default\s*=\s*false/);
    expect(leer(`${TF}/modules/stamp/variables.tf`)).toMatch(/variable "nat_gateway_enabled"[\s\S]*?default\s*=\s*false/);
    expect(leer(`${PROD}/variables.tf`)).toMatch(/nat_gateway_enabled\s*=\s*optional\(bool,\s*false\)/);
    expect(leer(`${PROD}/main.tf`)).toMatch(/nat_gateway_enabled\s*=\s*each\.value\.nat_gateway_enabled/);
  });

  it("todos los recursos se crean sólo con el flag", () => {
    for (const recurso of ["azurerm_public_ip\" \"nat", "azurerm_nat_gateway\" \"this", "azurerm_nat_gateway_public_ip_association\" \"this", "azurerm_subnet_nat_gateway_association\" \"apps"]) {
      const bloque = red.slice(red.indexOf(`resource "${recurso}"`));
      expect(bloque.slice(0, 200), recurso).toMatch(/count\s*=\s*var\.nat_gateway_enabled \? 1 : 0/);
    }
  });

  it("usa el SKU Standard: StandardV2 no está soportado por Container Apps", () => {
    expect(red).toMatch(/sku_name\s*=\s*"Standard"/);
    expect(red).not.toMatch(/sku_name\s*=\s*"StandardV2"/);
    expect(red).toMatch(/sku\s*=\s*"Standard"/);
  });

  it("la subred sólo sale por el NAT cuando la IP ya está asociada, y los dependientes esperan a eso", () => {
    expect(red).toMatch(/depends_on\s*=\s*\[azurerm_nat_gateway_public_ip_association\.this\]/);
    expect(redOut).toMatch(/depends_on\s*=\s*\[azurerm_subnet_nat_gateway_association\.apps\]/);
  });

  it("el timeout de inactividad se valida entre 4 y 120 minutos", () => {
    expect(redVars).toMatch(/>=\s*4\s*&&\s*var\.nat_gateway_idle_timeout_minutes\s*<=\s*120/);
  });

  it("el output outbound_ip aclara que es la IP de ENTRADA (la de salida es la del NAT)", () => {
    const salidas = leer(`${TF}/modules/stamp/outputs.tf`);
    const bloque = salidas.slice(salidas.indexOf('output "outbound_ip"'), salidas.indexOf('output "nat_gateway_public_ip"'));
    expect(bloque).toMatch(/ENTRADA/);
    expect(salidas).toMatch(/output "nat_gateway_public_ip"/);
    expect(leer(`${PROD}/outputs.tf`)).toMatch(/output "stamp_nat_gateway_ips"/);
  });
});

describe("certificado propio en el dominio", () => {
  const dominio = leer(`${TF}/modules/custom_domain/main.tf`);
  const dominioVars = leer(`${TF}/modules/custom_domain/variables.tf`);

  it("el origen del certificado es gestionado por defecto en el módulo, el stamp y el entorno", () => {
    expect(dominioVars).toMatch(/variable "certificate_source"[\s\S]*?default\s*=\s*"managed"/);
    expect(leer(`${TF}/modules/stamp/variables.tf`)).toMatch(/variable "custom_domain_certificate_source"[\s\S]*?default\s*=\s*"managed"/);
    expect(leer(`${PROD}/variables.tf`)).toMatch(/custom_domain_certificate_source\s*=\s*optional\(string,\s*"managed"\)/);
  });

  it("admite exactamente managed, byo_staged y byo", () => {
    expect(dominioVars).toMatch(/contains\(\["managed", "byo_staged", "byo"\], var\.certificate_source\)/);
  });

  it("crear el propio y borrar el gestionado nunca van en el mismo apply", () => {
    // byo_staged: existen los dos. byo: sólo el propio. managed: sólo el gestionado.
    expect(dominio).toMatch(/use_byo\s*=\s*var\.enabled && var\.certificate_source != "managed"/);
    const gestionado = dominio.slice(dominio.indexOf('resource "azurerm_container_app_environment_managed_certificate"'));
    expect(gestionado.slice(0, 220)).toMatch(/count\s*=\s*var\.enabled && var\.certificate_source != "byo" \? 1 : 0/);
  });

  it("el binding del dominio sigue ignorando el id del certificado (cambiarlo lo recrearía en producción)", () => {
    const binding = dominio.slice(dominio.indexOf('resource "azurerm_container_app_custom_domain"'));
    expect(binding).toMatch(/ignore_changes\s*=\s*\[container_app_environment_certificate_id\]/);
  });

  it("el certificado propio ignora el contenido (rotar = nombre nuevo) y sale de secretos de Key Vault", () => {
    const propio = dominio.slice(dominio.indexOf('resource "azurerm_container_app_environment_certificate" "byo"'), dominio.indexOf('resource "azurerm_container_app_environment_managed_certificate"'));
    expect(propio).toMatch(/ignore_changes\s*=\s*\[certificate_blob_base64, certificate_password\]/);
    expect(propio).toContain("data.azurerm_key_vault_secret.byo_pfx[0].value");
    expect(propio).toContain("data.azurerm_key_vault_secret.byo_password[0].value");
  });

  it("ninguna variable recibe el material del certificado: sólo los NOMBRES de los secretos", () => {
    const nombres = [...dominioVars.matchAll(/variable "([^"]+)"/g)].map((m) => m[1]);
    for (const n of nombres) {
      if (/pfx|password|key|blob|secret|cert/i.test(n)) {
        expect(["certificate_source", "certificate_name", "byo_certificate_name", "key_vault_id", "byo_pfx_secret_name", "byo_password_secret_name"], n).toContain(n);
      }
    }
    expect(dominioVars).not.toMatch(/sensitive\s*=\s*true/);
  });
});

describe("MySQL: la versión no se cambia desde Terraform", () => {
  const mysql = leer(`${TF}/modules/mysql/main.tf`);

  it("la versión es una variable y se ignora en servidores existentes", () => {
    expect(mysql).toMatch(/version\s*=\s*var\.mysql_version/);
    expect(mysql).not.toMatch(/version\s*=\s*"8\.0\.21"/);
    expect(mysql).toMatch(/ignore_changes\s*=\s*\[.*\bversion\]/);
  });

  it("el default sigue en 8.0.21 y sólo admite versiones que el provider conoce", () => {
    expect(leer(`${TF}/modules/mysql/variables.tf`)).toMatch(/variable "mysql_version"[\s\S]*?default\s*=\s*"8\.0\.21"/);
    expect(leer(`${TF}/modules/mysql/variables.tf`)).toContain('contains(["5.7", "8.0.21", "8.4"], var.mysql_version)');
    expect(leer(`${PROD}/variables.tf`)).toMatch(/mysql_version\s*=\s*optional\(string,\s*"8\.0\.21"\)/);
  });
});

describe.skipIf(!hayTerraform)("guarda del origen evaluada con terraform console", () => {
  const checks = leer(`${PROD}/checks.tf`);

  function condicion(nombre: string): string {
    const bloque = checks.slice(checks.indexOf(`check "${nombre}"`));
    const c = bloque.match(/condition\s*=\s*(.+)/)?.[1];
    expect(c, nombre).toBeDefined();
    return c!;
  }

  function evaluar(expresion: string, vars: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), "terraform-guardas-test-"));
    try {
      writeFileSync(
        join(dir, "variables.tf"),
        [
          'variable "origin_cloudflare_only" {\n  type = bool\n  default = false\n}',
          'variable "origin_extra_allowed_ip_ranges" {\n  type = list(string)\n  default = []\n}',
        ].join("\n"),
      );
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const [k, v] of Object.entries(vars)) env[`TF_VAR_${k}`] = typeof v === "string" ? v : JSON.stringify(v);
      const r = spawnSync("terraform", [`-chdir=${dir}`, "console"], { encoding: "utf8", input: `${expresion}\n`, env });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    [false, [], true],
    [false, ["203.0.113.7/32"], true],
    [true, [], false],
    [true, ["203.0.113.7/32"], true],
  ])("filtrar el origen a Cloudflare exige declarar a los cron: cloudflare=%s extras=%j => pasa=%s", (cloudflare, extras, pasa) => {
    const r = evaluar(condicion("origen_cloudflare_declara_llamadores_internos"), {
      origin_cloudflare_only: cloudflare,
      origin_extra_allowed_ip_ranges: extras,
    });
    expect(r).toBe(String(pasa));
  });
});
