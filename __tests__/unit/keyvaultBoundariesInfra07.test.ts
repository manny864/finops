/**
 * INFRA-07: vaults con límites reales.
 *  - La identidad de jobs sólo lee CRON_SECRET (rol a nivel secreto, no del vault): un job
 *    comprometido no lee credenciales de tenants ni los demás secretos infra-*.
 *  - migrate no usa Key Vault y no hereda las variables que apuntan a la identidad del web.
 *  - Defaults seguros: el vault lo crea el módulo con firewall Deny y private endpoint; con
 *    create = false (data source) pedir firewall es un error, no un no-op silencioso.
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
const bloque = (src: string, cabecera: string) => {
  const at = src.indexOf(cabecera);
  expect(at, cabecera).toBeGreaterThanOrEqual(0);
  return src.slice(at, src.indexOf("\n}\n", at) + 2);
};

const TF = "infra/terraform";
const stamp = sinComentarios(leer(`${TF}/modules/stamp/main.tf`));

describe("identidad de jobs: sólo el secreto del cron", () => {
  const rol = bloque(stamp, 'resource "azurerm_role_assignment" "jobs_kv_secrets_user"');

  it("Secrets User acotado a CRON_SECRET, no a todo el vault", () => {
    expect(rol).toMatch(/scope\s*=\s*"\$\{module\.keyvault\.id\}\/secrets\/\$\{var\.cron_secret_name\}"/);
    expect(rol).toMatch(/role_definition_name\s*=\s*"Key Vault Secrets User"/);
    expect(rol).toMatch(/create_before_destroy\s*=\s*true/);
    expect(rol).toMatch(/depends_on\s*=\s*\[azurerm_key_vault_secret\.cron, data\.azurerm_key_vault_secret\.cron\]/);
  });

  it("ninguna otra asignación le da a la identidad de jobs acceso al vault", () => {
    const asignaciones = stamp.match(/resource "azurerm_role_assignment" "[^"]+" \{[\s\S]*?\n\}/g) ?? [];
    const deJobs = asignaciones.filter((a) => a.includes("azurerm_user_assigned_identity.jobs.principal_id"));
    expect(deJobs.length).toBe(2);
    for (const a of deJobs) {
      expect(a).not.toMatch(/scope\s*=\s*module\.keyvault\.id\s*$/m);
    }
  });

  it("los cron jobs sólo referencian CRON_SECRET del vault", () => {
    const cron = sinComentarios(leer(`${TF}/modules/cronjobs/main.tf`));
    expect(cron.match(/key_vault_secret_id\s*=/g)?.length).toBe(1);
    expect(cron).toMatch(/key_vault_secret_id\s*=\s*var\.cron_secret_id/);
  });

  it("la app conserva Secrets Officer: escribe y borra credenciales de tenants", () => {
    const kv = sinComentarios(leer(`${TF}/modules/keyvault/main.tf`));
    const app = bloque(kv, 'resource "azurerm_role_assignment" "app_secrets_user"');
    expect(app).toMatch(/role_definition_name\s*=\s*"Key Vault Secrets Officer"/);
    expect(app).toMatch(/principal_id\s*=\s*var\.app_principal_id/);
  });
});

describe("migrate no usa Key Vault", () => {
  it("el job usa migrate_env, que excluye las variables de Key Vault del web", () => {
    const migrate = bloque(stamp, 'resource "azurerm_container_app_job" "migrate"');
    expect(migrate).toMatch(/for_each = local\.migrate_env/);
    expect(migrate).not.toMatch(/for_each = local\.app_env/);
    const loc = bloque(stamp, "locals {\n  migrate_env");
    for (const v of ["AZURE_KEYVAULT_ENABLED", "AZURE_KEYVAULT_URL", "AZURE_KEYVAULT_MI_CLIENT_ID"]) {
      expect(loc).toContain(`"${v}"`);
    }
    expect(loc).toMatch(/for k, v in local\.app_env : k => v\s*\n\s*if !contains\(/);
  });

  it("el web sigue recibiendo Key Vault con su identidad", () => {
    expect(stamp).toMatch(/AZURE_KEYVAULT_ENABLED = "true"/);
    expect(stamp).toMatch(/AZURE_KEYVAULT_MI_CLIENT_ID = azurerm_user_assigned_identity\.app\.client_id/);
  });

  it("el código de migraciones no importa secretos ni Key Vault", () => {
    for (const f of ["scripts/migrate.ts", "src/modules/storage/migrations.ts", "src/modules/storage/db.ts"]) {
      const imports = (leer(f).match(/^import .*$/gm) ?? []).join("\n");
      expect(imports, f).not.toMatch(/secrets|keyvault|key-vault/i);
    }
  });
});

describe("defaults seguros del vault", () => {
  it("módulo keyvault: crea el vault con firewall y private endpoint", () => {
    const vars = leer(`${TF}/modules/keyvault/variables.tf`);
    for (const v of ["create", "private_endpoint_enabled", "network_acls_enabled"]) {
      expect(bloque(vars, `variable "${v}"`), v).toMatch(/default\s*=\s*true/);
    }
  });

  it("stamp y ambientes: los mismos defaults", () => {
    const vars = leer(`${TF}/modules/stamp/variables.tf`);
    for (const v of ["keyvault_create", "keyvault_private_endpoint_enabled", "keyvault_network_acls_enabled"]) {
      expect(bloque(vars, `variable "${v}"`), v).toMatch(/default\s*=\s*true/);
    }
    for (const env of ["prod", "dev"]) {
      const e = leer(`${TF}/environments/${env}/variables.tf`);
      for (const v of ["keyvault_create", "keyvault_private_endpoint_enabled", "keyvault_network_acls_enabled"]) {
        expect(e, `${env}:${v}`).toMatch(new RegExp(`${v}\\s*=\\s*optional\\(bool, true\\)`));
      }
    }
  });

  it("create = false con firewall falla en vez de ignorarlo", () => {
    const kv = sinComentarios(leer(`${TF}/modules/keyvault/main.tf`));
    const data = bloque(kv, 'data "azurerm_key_vault" "existing"');
    expect(data).toMatch(/precondition \{\s*condition\s*=\s*!var\.network_acls_enabled && length\(var\.allowed_ip_rules\) == 0/);
  });

  it("el private endpoint exige subred y zona DNS", () => {
    const kv = sinComentarios(leer(`${TF}/modules/keyvault/main.tf`));
    const pe = bloque(kv, 'resource "azurerm_private_endpoint" "vault"');
    expect(pe).toMatch(/condition\s*=\s*var\.subnet_id != null && var\.private_dns_zone_id != null/);
  });

  it("el vault creado mantiene Deny, bypass AzureServices, RBAC y purge protection", () => {
    const kv = sinComentarios(leer(`${TF}/modules/keyvault/main.tf`));
    const v = bloque(kv, 'resource "azurerm_key_vault" "this"');
    expect(v).toMatch(/default_action = "Deny"/);
    expect(v).toMatch(/bypass\s*= "AzureServices"/);
    expect(v).toMatch(/rbac_authorization_enabled = true/);
    expect(v).toMatch(/purge_protection_enabled\s*= true/);
  });
});
