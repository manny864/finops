import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Salida fija (NAT Gateway), certificado propio, Front Door Premium con Private Link y
 * versión de MySQL: todo viene apagado y lo que se enciende no puede tocar lo existente.
 * Estos tests cuidan lo que no se nota hasta que falla en producción:
 *
 *  - Container Apps sólo admite NAT Gateway Standard (StandardV2 no está soportado).
 *  - El binding del dominio ignora el id del certificado: cambiarlo desde Terraform lo
 *    recrearía en producción. Crear el certificado propio y borrar el gestionado nunca van
 *    en el mismo apply (Azure no borra un certificado en uso).
 *  - Front Door y el filtro por IP a Cloudflare son destinos ALTERNATIVOS: lo impone un check
 *    y el apply se frena ante un check que no pasa.
 *  - Una versión de MySQL mal puesta en el tfvars no puede disparar la actualización mayor,
 *    que es irreversible.
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

describe("Front Door Premium con Private Link", () => {
  const fd = leer(`${TF}/modules/frontdoor/main.tf`);
  const fdVars = leer(`${TF}/modules/frontdoor/variables.tf`);
  const variablesProd = leer(`${PROD}/variables.tf`);
  const mainProd = leer(`${PROD}/main.tf`);

  it("viene apagado: Front Door sin habilitar, sin Private Link y sin dominio propio", () => {
    expect(variablesProd).toMatch(/variable "frontdoor_enabled"[\s\S]*?default\s*=\s*false/);
    expect(variablesProd).toMatch(/variable "frontdoor_private_link_enabled"[\s\S]*?default\s*=\s*false/);
    expect(variablesProd).toMatch(/variable "frontdoor_custom_domain"[\s\S]*?default\s*=\s*""/);
    expect(fdVars).toMatch(/variable "origin_private_link"[\s\S]*?default\s*=\s*null/);
  });

  it("el origin se conecta al managed environment y exige Premium", () => {
    expect(fd).toMatch(/target_type\s*=\s*"managedEnvironments"/);
    expect(fd.match(/error_message\s*=\s*"El Private Link hacia el origin sólo existe en Front Door Premium/g)).toHaveLength(2);
    expect(mainProd).toMatch(/origin_private_link\s*=\s*var\.frontdoor_private_link_enabled \? \{/);
  });

  it("el WAF arranca en Detection y el rate limit y los bots en Log: medir antes de bloquear", () => {
    expect(variablesProd).toMatch(/variable "frontdoor_waf_mode"[\s\S]*?default\s*=\s*"Detection"/);
    expect(variablesProd).toMatch(/variable "frontdoor_waf_bot_action"[\s\S]*?default\s*=\s*"Log"/);
    expect(variablesProd).toMatch(/variable "frontdoor_waf_rate_limit_action"[\s\S]*?default\s*=\s*"Log"/);
    expect(fdVars).toMatch(/variable "waf_rate_limit_action"[\s\S]*?default\s*=\s*"Log"/);
    expect(fdVars).toMatch(/variable "waf_bot_action"[\s\S]*?default\s*=\s*"Log"/);
  });

  it("el nombre de la regla personalizada sólo tiene letras y números (lo exige el WAF)", () => {
    const nombre = fd.slice(fd.indexOf('dynamic "custom_rule"')).match(/name\s*=\s*"([^"]+)"/)?.[1];
    expect(nombre).toBeDefined();
    expect(nombre).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("el dominio propio entra en la ruta, en la asociación y en la política del WAF", () => {
    expect(fd).toMatch(/cdn_frontdoor_custom_domain_ids\s*=\s*var\.custom_domain_host_name != ""/);
    expect(fd).toMatch(/resource "azurerm_cdn_frontdoor_custom_domain_association"/);
    expect(fd).toMatch(/dynamic "domain"[\s\S]*?azurerm_cdn_frontdoor_custom_domain\.this\[0\]\.id/);
  });

  it("no duplica el diagnóstico: los logs ya los manda module.global_diagnostics", () => {
    expect(fd).not.toMatch(/azurerm_monitor_diagnostic_setting/);
    expect(mainProd).toMatch(/var\.frontdoor_enabled \? \{ frontdoor = module\.frontdoor\.profile_id \} : \{\}/);
  });
});

describe("acceso privado al entorno de Container Apps", () => {
  const stamp = leer(`${TF}/modules/stamp/main.tf`);

  it("viene apagado y sólo entonces cambia el acceso público", () => {
    expect(leer(`${TF}/modules/stamp/variables.tf`)).toMatch(/variable "app_private_access_only"[\s\S]*?default\s*=\s*false/);
    expect(leer(`${PROD}/variables.tf`)).toMatch(/app_private_access_only\s*=\s*optional\(bool,\s*false\)/);
    expect(stamp).toMatch(/public_network_access\s*=\s*var\.app_private_access_only \? "Disabled" : "Enabled"/);
  });

  it("el endpoint usa el groupId verificado y el A record la primera etiqueta del dominio por defecto", () => {
    expect(stamp).toMatch(/subresource_names\s*=\s*\["managedEnvironments"\]/);
    expect(stamp).toMatch(/name\s*=\s*split\("\.", azurerm_container_app_environment\.this\.default_domain\)\[0\]/);
    expect(stamp).toMatch(/count\s*=\s*var\.app_private_access_only \? 1 : 0/);
  });

  it("la zona privada se llama privatelink.<región>.azurecontainerapps.io", () => {
    expect(leer(`${TF}/modules/private_dns/main.tf`)).toContain('privatelink.${var.containerapps_location}.azurecontainerapps.io');
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

describe.skipIf(!hayTerraform)("guardas del entorno evaluadas con terraform console", () => {
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
          'variable "frontdoor_enabled" {\n  type = bool\n  default = false\n}',
          'variable "frontdoor_private_link_enabled" {\n  type = bool\n  default = false\n}',
          'variable "frontdoor_sku" {\n  type = string\n  default = "Standard_AzureFrontDoor"\n}',
          'variable "origin_cloudflare_only" {\n  type = bool\n  default = false\n}',
          'variable "stamps" {\n  type = map(object({ app_private_access_only = bool }))\n  default = { us = { app_private_access_only = false } }\n}',
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
    [false, false, "Standard_AzureFrontDoor", true],
    [true, false, "Premium_AzureFrontDoor", false],
    [true, true, "Standard_AzureFrontDoor", false],
    [true, true, "Premium_AzureFrontDoor", true],
  ])("private link exige Front Door Premium: private_link=%s frontdoor=%s sku=%s => pasa=%s", (privateLink, frontdoor, sku, pasa) => {
    const r = evaluar(condicion("frontdoor_private_link_requiere_premium"), {
      frontdoor_private_link_enabled: privateLink,
      frontdoor_enabled: frontdoor,
      frontdoor_sku: sku,
    });
    expect(r).toBe(String(pasa));
  });

  it.each([
    [false, false, false, true],
    [true, false, false, false],
    [true, true, false, false],
    [true, true, true, true],
  ])("el acceso privado sin Front Door con Private Link deja a todos afuera: privado=%s frontdoor=%s private_link=%s => pasa=%s", (privado, frontdoor, privateLink, pasa) => {
    const r = evaluar(condicion("acceso_privado_requiere_frontdoor_con_private_link"), {
      stamps: { us: { app_private_access_only: privado } },
      frontdoor_enabled: frontdoor,
      frontdoor_private_link_enabled: privateLink,
    });
    expect(r).toBe(String(pasa));
  });

  it.each([
    [false, false, true],
    [true, false, true],
    [false, true, true],
    [true, true, false],
  ])("Cloudflare y acceso privado son alternativas: cloudflare=%s privado=%s => pasa=%s", (cloudflare, privado, pasa) => {
    const r = evaluar(condicion("cloudflare_y_acceso_privado_son_alternativas"), {
      origin_cloudflare_only: cloudflare,
      stamps: { us: { app_private_access_only: privado } },
    });
    expect(r).toBe(String(pasa));
  });
});
