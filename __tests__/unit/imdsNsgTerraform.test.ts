import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * AISEC-03: NSG en la subred de apps que deniega la salida a IMDS. Una regla con destino
 * "169.254.169.254" no tiene efecto (Azure no somete IMDS a los NSG); sólo vale el service
 * tag AzurePlatformIMDS. Nunca denegar 168.63.129.16 / AzurePlatformDNS: el entorno de
 * Container Apps deja de funcionar.
 */
const TF = "infra/terraform";
const leer = (ruta: string) => readFileSync(ruta, "utf8");

describe("NSG de apps: bloqueo de IMDS", () => {
  const red = leer(`${TF}/modules/network/main.tf`);
  const inicio = red.indexOf('resource "azurerm_network_security_group" "apps"');
  const nsg = red.slice(inicio, red.indexOf('resource "azurerm_subnet_network_security_group_association" "apps"', inicio));

  it("apagado en los módulos; encendido en prod y stg salvo false explícito en el stamp", () => {
    expect(leer(`${TF}/modules/network/variables.tf`)).toMatch(/variable "apps_nsg_block_imds"[\s\S]*?default\s*=\s*false/);
    expect(leer(`${TF}/modules/stamp/variables.tf`)).toMatch(/variable "apps_nsg_block_imds"[\s\S]*?default\s*=\s*false/);
    expect(leer(`${TF}/modules/stamp/main.tf`)).toMatch(/apps_nsg_block_imds\s*=\s*var\.apps_nsg_block_imds/);
    expect(leer(`${TF}/environments/prod/variables.tf`)).toMatch(/apps_nsg_block_imds\s*=\s*optional\(bool\)/);
    expect(leer(`${TF}/environments/prod/main.tf`)).toMatch(
      /apps_nsg_block_imds\s*=\s*coalesce\(each\.value\.apps_nsg_block_imds,\s*contains\(\["prod", "stg"\], var\.environment\)\)/,
    );
  });

  it("deniega la salida al service tag AzurePlatformIMDS, no a la IP", () => {
    expect(nsg).toMatch(/direction\s*=\s*"Outbound"/);
    expect(nsg).toMatch(/access\s*=\s*"Deny"/);
    expect(nsg).toMatch(/destination_address_prefix\s*=\s*"AzurePlatformIMDS"/);
    expect(nsg).not.toMatch(/=\s*"169\.254\.169\.254/);
  });

  it("no toca DNS de Azure ni abre entrada", () => {
    expect(nsg).not.toMatch(/168\.63\.129\.16|AzurePlatformDNS/);
    expect(nsg).not.toMatch(/direction\s*=\s*"Inbound"/);
  });

  it("se asocia a la subred de apps con el mismo flag", () => {
    expect(red).toMatch(
      /resource "azurerm_subnet_network_security_group_association" "apps"[\s\S]*?count\s*=\s*var\.apps_nsg_block_imds \? 1 : 0[\s\S]*?subnet_id\s*=\s*azurerm_subnet\.apps\.id/,
    );
  });
});
