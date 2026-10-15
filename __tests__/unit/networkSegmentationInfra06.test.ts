import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * INFRA-06: NSG de entrada en las subredes de private endpoints y de MySQL, con clientes
 * declarados; UDR de salida por firewall opcional. Puertos verificados en Azure: KV/AI 443,
 * Managed Redis 10000 (EnterpriseCluster). En prod, la web corporativa (10.50.40.0/24, fuera
 * de Terraform) y la VM de backup usan el MySQL: si el NSG no las lista, se caen.
 */
const TF = "infra/terraform";
const PROD = `${TF}/environments/prod`;
const STG = `${TF}/environments/staging`;
const leer = (ruta: string) => readFileSync(ruta, "utf8");
const hayTerraform = spawnSync("terraform", ["version"], { encoding: "utf8" }).error === undefined;

const red = leer(`${TF}/modules/network/main.tf`);

function recurso(tipo: string, nombre: string): string {
  const inicio = red.indexOf(`resource "${tipo}" "${nombre}"`);
  expect(inicio, `${tipo}.${nombre}`).toBeGreaterThanOrEqual(0);
  const resto = red.slice(inicio + 1);
  const fin = resto.search(/\n(resource|#\s*-{5,})/);
  return red.slice(inicio, fin === -1 ? undefined : inicio + 1 + fin);
}

type Regla = Record<string, string>;
function reglas(bloque: string): Regla[] {
  return [...bloque.matchAll(/security_rule\s*\{([\s\S]*?)\n\s{2,4}\}/g)].map((m) => {
    const r: Regla = {};
    for (const l of m[1].matchAll(/^\s*(\w+)\s*=\s*(.+)$/gm)) r[l[1]] = l[2].trim();
    return r;
  });
}

describe("INFRA-06: NSG de private endpoints", () => {
  const nsg = recurso("azurerm_network_security_group", "private_endpoint");
  const rs = reglas(nsg);

  it("sin NetworkSecurityGroupEnabled Azure ignora el NSG en los PE", () => {
    expect(recurso("azurerm_subnet", "private_endpoint")).toMatch(
      /private_endpoint_network_policies\s*=\s*var\.segmentation_nsgs_enabled \? "NetworkSecurityGroupEnabled" : "Disabled"/,
    );
  });

  it("sólo apps (y extras declarados) entran, a los puertos de los PE; el resto se deniega", () => {
    const apps = rs.find((r) => r.name === '"AllowAppsToPrivateEndpoints"')!;
    expect(apps).toMatchObject({
      direction: '"Inbound"',
      access: '"Allow"',
      protocol: '"Tcp"',
      source_address_prefix: "var.apps_subnet_prefix",
      destination_address_prefix: "var.pe_subnet_prefix",
      destination_port_ranges: "var.pe_allowed_ports",
    });
    expect(nsg).toMatch(/for_each\s*=\s*length\(var\.pe_extra_client_prefixes\) > 0/);
    expect(nsg).toMatch(/source_address_prefixes\s*=\s*var\.pe_extra_client_prefixes/);

    const deny = rs.find((r) => r.access === '"Deny"')!;
    expect(deny).toMatchObject({ direction: '"Inbound"', source_address_prefix: '"*"', destination_port_range: '"*"' });
    for (const r of rs.filter((x) => x.access === '"Allow"')) expect(Number(r.priority)).toBeLessThan(Number(deny.priority));
    expect(rs.every((r) => r.source_address_prefix !== '"*"' || r.access === '"Deny"')).toBe(true);
  });

  it("puertos por defecto: 443 y 10000 de Managed Redis, no 6379", () => {
    const v = leer(`${TF}/modules/network/variables.tf`);
    expect(v).toMatch(/variable "pe_allowed_ports"[\s\S]*?default\s*=\s*\["443", "10000"\]/);
    expect(v).not.toContain("6379");
  });
});

describe("INFRA-06: NSG de MySQL", () => {
  const nsg = recurso("azurerm_network_security_group", "mysql");
  const rs = reglas(nsg);
  const por = (n: string) => rs.find((r) => r.name === `"${n}"`)!;

  it("3306 desde apps y desde los extras; nada más desde la VNet", () => {
    expect(por("AllowAppsToMySql")).toMatchObject({
      access: '"Allow"',
      protocol: '"Tcp"',
      destination_port_range: '"3306"',
      source_address_prefix: "var.apps_subnet_prefix",
    });
    expect(nsg).toMatch(/name\s*=\s*"AllowExtraClientsToMySql"[\s\S]*?destination_port_range\s*=\s*"3306"[\s\S]*?source_address_prefixes\s*=\s*var\.mysql_extra_client_prefixes/);
    const deny = por("DenyAllOtherInbound");
    expect(deny).toMatchObject({ access: '"Deny"', source_address_prefix: '"*"', destination_port_range: '"*"' });
    for (const r of rs.filter((x) => x.access === '"Allow"')) expect(Number(r.priority)).toBeLessThan(Number(deny.priority));
  });

  it("preserva HA (tráfico interno de la subred) y las sondas del balanceador", () => {
    expect(por("AllowMySqlSubnetInternal")).toMatchObject({
      source_address_prefix: "var.mysql_subnet_prefix",
      destination_address_prefix: "var.mysql_subnet_prefix",
      access: '"Allow"',
    });
    expect(por("AllowAzureLoadBalancerInbound")).toMatchObject({ source_address_prefix: '"AzureLoadBalancer"', access: '"Allow"' });
  });

  it("no filtra salida (Storage, DNS, HA) ni deniega DNS de Azure", () => {
    expect(nsg).not.toMatch(/direction\s*=\s*"Outbound"/);
    expect(red).not.toMatch(/DenyAllOutbound|168\.63\.129\.16"|AzurePlatformDNS/);
  });
});

describe("INFRA-06: flags, asociaciones y salida", () => {
  it("apagado por defecto en los módulos; las asociaciones usan el mismo flag", () => {
    expect(leer(`${TF}/modules/network/variables.tf`)).toMatch(/variable "segmentation_nsgs_enabled"[\s\S]*?default\s*=\s*false/);
    expect(leer(`${TF}/modules/stamp/variables.tf`)).toMatch(/variable "segmentation_nsgs_enabled"[\s\S]*?default\s*=\s*false/);
    for (const n of ["private_endpoint", "mysql"]) {
      expect(recurso("azurerm_subnet_network_security_group_association", n)).toMatch(
        new RegExp(`count\\s*=\\s*var\\.segmentation_nsgs_enabled \\? 1 : 0[\\s\\S]*?subnet_id\\s*=\\s*azurerm_subnet\\.${n}\\.id`),
      );
    }
    const stamp = leer(`${TF}/modules/stamp/main.tf`);
    for (const v of ["segmentation_nsgs_enabled", "pe_extra_client_prefixes", "mysql_extra_client_prefixes", "egress_firewall_private_ip"]) {
      expect(stamp).toMatch(new RegExp(`${v}\\s*=\\s*var\\.${v}`));
    }
  });

  it("la UDR al firewall sólo existe si hay IP de firewall", () => {
    expect(recurso("azurerm_route_table", "apps_egress")).toMatch(/count\s*=\s*var\.egress_firewall_private_ip == null \? 0 : 1/);
    expect(recurso("azurerm_route_table", "apps_egress")).toMatch(/next_hop_type\s*=\s*"VirtualAppliance"/);
    expect(recurso("azurerm_subnet_route_table_association", "apps_egress")).toMatch(/subnet_id\s*=\s*azurerm_subnet\.apps\.id/);
  });

  it("staging encendido; prod declara la web corporativa antes de encender", () => {
    expect(leer(`${STG}/network.tfvars`)).toMatch(/us\s*=\s*\{\s*enabled\s*=\s*true/);
    const prod = leer(`${PROD}/network.tfvars`);
    expect(prod).toMatch(/mysql_extra_client_prefixes\s*=\s*\[[\s\S]*?"10\.50\.40\.0\/24"/);
  });

  it("network.tfvars se versiona y se pasa después del secret en todos los plan", () => {
    for (const g of [".gitignore", "infra/.gitignore"]) expect(leer(g)).toMatch(/^!network\.tfvars$/m);
    const wf = leer(".github/workflows/terraform.yml");
    const planes = wf.split("\n").filter((l) => !/^\s*#/.test(l) && /-var-file=terraform\.tfvars/.test(l));
    // plan-apply arma los argumentos en un array (ARGS) para poder reintentar; drift los pasa directo.
    expect(planes.length).toBe(2);
    expect(wf).toMatch(/terraform plan "\$\{ARGS\[@\]\}"/);
    for (const p of planes) expect(p).toMatch(/-var-file=terraform\.tfvars -var-file=cron-jobs\.tfvars -var-file=network\.tfvars/);
  });
});

describe.skipIf(!hayTerraform)("INFRA-06 evaluado con terraform console", () => {
  function consola(archivos: Record<string, string>, expresion: string) {
    const dir = mkdtempSync(join(tmpdir(), "infra06-"));
    try {
      for (const [n, c] of Object.entries(archivos)) writeFileSync(join(dir, n), c);
      return spawnSync("terraform", [`-chdir=${dir}`, "console", "-var-file=x.tfvars"], { encoding: "utf8", input: `${expresion}\n` });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const raiz = leer(`${PROD}/main.tf`);
  const expr = (attr: string) => {
    const m = raiz.match(new RegExp(`\\n\\s*${attr}\\s*=\\s*([\\s\\S]*?)\\n\\s*(?=[a-z_]+\\s*=)`));
    expect(m, attr).not.toBeNull();
    return m![1].replace(/each\.key/g, "k").replace(/\s*\n\s*/g, " ");
  };
  const evaluar = (tfvars: string) =>
    consola(
      { "variables.tf": leer(`${PROD}/variables.tf`), "x.tfvars": tfvars },
      `jsonencode({ for k, _ in var.stamps : k => { on = ${expr("segmentation_nsgs_enabled")}, mysql = ${expr("mysql_extra_client_prefixes")}, fw = ${expr("egress_firewall_private_ip")} } })`,
    );
  const stamps = `stamps = { us = { location = "westus2", address_space = ["10.50.0.0/16"], apps_subnet_prefix = "10.50.0.0/23", pe_subnet_prefix = "10.50.10.0/24", mysql_subnet_prefix = "10.50.20.0/24", mysql_database_name = "d", mysql_admin_login = "a", mysql_sku_name = "B_Standard_B1ms", mysql_storage_gb = 20 } }
subscription_id = "00000000-0000-0000-0000-000000000000"
tenant_id = "00000000-0000-0000-0000-000000000000"
alert_email = "a@b.c"
`;

  it("suma la VM de backup sólo si existe, sin duplicar; sin entrada => apagado", () => {
    const con = evaluar(`${stamps}mysql_backup_enabled = true\nnetwork_segmentation = { us = { enabled = true, mysql_extra_client_prefixes = ["10.50.40.0/24"] } }\n`);
    expect(con.stderr).toBe("");
    expect(JSON.parse(JSON.parse(con.stdout))).toEqual({ us: { on: true, mysql: ["10.50.40.0/24", "10.50.30.0/24"], fw: null } });

    const dup = evaluar(`${stamps}mysql_backup_enabled = true\nnetwork_segmentation = { us = { mysql_extra_client_prefixes = ["10.50.30.0/24"] } }\n`);
    expect(dup.stderr).toBe("");
    expect(JSON.parse(JSON.parse(dup.stdout))).toEqual({ us: { on: false, mysql: ["10.50.30.0/24"], fw: null } });

    const sin = evaluar(`${stamps}mysql_backup_enabled = false\n`);
    expect(sin.stderr).toBe("");
    expect(JSON.parse(JSON.parse(sin.stdout))).toEqual({ us: { on: false, mysql: [], fw: null } });
  });

  it("rechaza claves de stamp inexistentes", () => {
    // terraform console sale con 0 aunque falle una validación: el error queda en stderr.
    const r = evaluar(`${stamps}network_segmentation = { eu = { enabled = true } }\n`);
    expect(r.stderr).toContain("sólo admite claves que existan en stamps");
  });

  it.each([
    ["mysql_extra_client_prefixes", '["10.50.40.0"]', "sólo admite CIDR"],
    ["pe_extra_client_prefixes", '["todo"]', "sólo admite CIDR"],
    ["egress_firewall_private_ip", '"10.0.0.0/24"', "tiene que ser una IPv4"],
  ])("el módulo valida %s=%s", (v, valor, error) => {
    const dir = mkdtempSync(join(tmpdir(), "infra06-mod-"));
    try {
      copyFileSync(`${TF}/modules/network/variables.tf`, join(dir, "variables.tf"));
      writeFileSync(
        join(dir, "x.tfvars"),
        `name_base = "n"\nlocation = "l"\naddress_space = []\napps_subnet_prefix = "a"\npe_subnet_prefix = "p"\nmysql_subnet_prefix = "m"\ntags = {}\n${v} = ${valor}\n`,
      );
      const r = spawnSync("terraform", [`-chdir=${dir}`, "console", "-var-file=x.tfvars"], { encoding: "utf8", input: `var.${v}\n` });
      expect(r.stderr).toContain(error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
