import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Ambiente de staging (docs/security/ejecucion-staging-copilot.md). Estos tests cuidan lo que no
 * se nota hasta que cuesta caro:
 *
 *  - staging usa el MISMO código que prod por construcción (enlaces simbólicos), así que lo que
 *    se prueba ahí es lo que se aplica en prod, sin copias que se desincronizan;
 *  - el workflow elige secreto, contenedor de state y palabra de confirmación por ambiente, y
 *    staging NUNCA cae a los de prod;
 *  - prod no cambia: sigue leyendo TF_VARS_PROD, usa el contenedor `tfstate` por defecto y se
 *    confirma con APPLY-PROD;
 *  - lo de staging no se pisa con lo de prod: otra VNet, otros nombres, nada de la suscripción
 *    (Defender, alertas) que ya gestiona prod.
 */
const ENV = "infra/terraform/environments";
const STG = `${ENV}/staging`;
const PROD = `${ENV}/prod`;
const leer = (ruta: string) => readFileSync(ruta, "utf8");
const workflow = leer(".github/workflows/terraform.yml");

describe("staging comparte el código de prod por enlaces simbólicos", () => {
  const compartidos = ["main.tf", "variables.tf", "checks.tf", "outputs.tf", "cloudflare_ips.tf", "paddle-price-ids.json", ".terraform.lock.hcl"];

  it.each(compartidos)("%s es un enlace a ../prod/%s", (f) => {
    expect(lstatSync(`${STG}/${f}`).isSymbolicLink()).toBe(true);
    expect(readlinkSync(`${STG}/${f}`)).toBe(`../prod/${f}`);
  });

  it("los .tf propios de staging son sólo imports.tf: ningún otro archivo de código se copió", () => {
    const propios = readdirSync(STG).filter((f) => f.endsWith(".tf") && !lstatSync(`${STG}/${f}`).isSymbolicLink());
    expect(propios).toEqual(["imports.tf"]);
  });

  it("todos los .tf de prod están enlazados desde staging", () => {
    const deProd = readdirSync(PROD).filter((f) => f.endsWith(".tf"));
    for (const f of deProd) expect(lstatSync(`${STG}/${f}`).isSymbolicLink()).toBe(true);
  });

  it("prod no tiene bloques import: sólo los de staging y no se llevan a prod", () => {
    expect(leer(`${PROD}/main.tf`)).not.toMatch(/^\s*import\s*\{/m);
  });
});

describe("imports.tf de staging", () => {
  const imports = leer(`${STG}/imports.tf`);
  const ids = [...imports.matchAll(/id\s*=\s*"([^"]+)"/g)].map((m) => m[1]);

  it("importa exactamente los dos RG y el ACR de staging, con sus direcciones del root", () => {
    expect(imports).toContain("to = azurerm_resource_group.global");
    expect(imports).toContain('to = module.stamp["us"].module.network.azurerm_resource_group.this');
    expect(imports).toContain("to = module.acr.azurerm_container_registry.this");
    expect(ids).toHaveLength(3);
  });

  it("todos los IDs son de staging (stg) y ninguno de prod", () => {
    for (const id of ids) {
      expect(id).toMatch(/cscs-finops-stg|cscsfinopsstg/);
      expect(id).not.toMatch(/prod/);
    }
  });
});

describe("cron_jobs de staging", () => {
  const stg = `${STG}/cron-jobs.tfvars`;

  it("es un archivo propio y no un enlace al de prod", () => {
    expect(lstatSync(stg).isSymbolicLink()).toBe(false);
  });

  it("es un subconjunto reducido: todos sus jobs existen en prod y son menos que los de prod", () => {
    const nombres = (t: string) => [...t.matchAll(/^\s{2}([a-z0-9-]+)\s*=\s*\{/gm)].map((m) => m[1]);
    const deStaging = nombres(leer(stg));
    const deProd = nombres(leer(`${PROD}/cron-jobs.tfvars`));
    expect(deStaging.length).toBeGreaterThan(0);
    expect(deStaging.length).toBeLessThan(deProd.length / 3);
    for (const n of deStaging) expect(deProd).toContain(n);
  });
});

describe("terraform.tfvars.example de staging", () => {
  const ejemplo = leer(`${STG}/terraform.tfvars.example`);

  it("usa el código de ambiente stg y una VNet que no se solapa con la de prod (10.50.0.0/16)", () => {
    expect(ejemplo).toMatch(/^environment\s*=\s*"stg"/m);
    expect(ejemplo).toContain('address_space       = ["10.60.0.0/16"]');
    expect(ejemplo).not.toMatch(/10\.50\./);
  });

  it("no enciende nada de la suscripción ni la VM de backups, y no lleva GUIDs ni secretos", () => {
    expect(ejemplo).toMatch(/^defender_enabled\s*=\s*false/m);
    expect(ejemplo).toMatch(/^mysql_backup_enabled\s*=\s*false/m);
    expect(ejemplo).toMatch(/security_activity_alerts_enabled\s*=\s*false/);
    expect(ejemplo).toMatch(/security_policy_audit_enabled\s*=\s*false/);
    expect(ejemplo).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(ejemplo).not.toMatch(/password|secret\s*=|connection_string/i);
  });

  it("dimensiona la réplica reducida: MySQL B1ms, Redis B0 sin HA y la app puede bajar a cero réplicas", () => {
    expect(ejemplo).toContain('mysql_sku_name                  = "B_Standard_B1ms"');
    expect(ejemplo).toContain('redis_sku_name                  = "Balanced_B0"');
    expect(ejemplo).toMatch(/redis_high_availability_enabled\s*=\s*false/);
    expect(ejemplo).toMatch(/web_min_replicas\s*=\s*0/);
  });

  it("los nombres derivados respetan los límites de Azure (Key Vault 24, Storage 24, job 32)", () => {
    // <prefijo>-<proyecto>-<ambiente>-<región abreviada>-kv ; los demás salen del mismo patrón.
    expect("cscs-finops-stg-wus2-kv".length).toBeLessThanOrEqual(24);
    expect("cscsfinopsstgwestus2sa".length).toBeLessThanOrEqual(24);
    expect("cscs-finops-stg-wus2-migrate".length).toBeLessThanOrEqual(32);
  });
});

describe("workflow terraform: un ambiente no pisa al otro", () => {
  it("ofrece staging además de prod, y prod sigue siendo el valor por defecto", () => {
    expect(workflow).toMatch(/options:\s*\[prod, staging\]/);
    expect(workflow).toMatch(/default:\s*prod/);
  });

  it("la palabra de confirmación depende del ambiente y cada ambiente exige la suya", () => {
    expect(workflow).toContain("(inputs.environment == 'staging' && 'APPLY-STAGING' || 'APPLY-PROD')");
    // Ningún paso compara la confirmación con un literal que sirva para los dos.
    expect(workflow).not.toMatch(/inputs\.confirm\s*[!=]=\s*'APPLY-PROD'/);
  });

  it("prod sigue leyendo TF_VARS_PROD y staging su propio TF_VARS, que es obligatorio", () => {
    expect(workflow).toContain("secrets.TF_VARS_PROD");
    expect(workflow).toContain("TF_VARS_STAGING: ${{ secrets.TF_VARS }}");
    expect(workflow).toMatch(/Falta el secret TF_VARS del environment staging/);
  });

  it("el secret de prod no se carga en el paso cuando el ambiente es staging", () => {
    expect(workflow).toMatch(/TF_VARS_PROD_VALOR:\s*\$\{\{\s*\(github\.event\.inputs\.environment \|\| 'prod'\) != 'staging' && secrets\.TF_VARS_PROD \|\| ''\s*\}\}/);
  });

  it("el state sale de vars.TFSTATE_CONTAINER y prod cae al contenedor tfstate por defecto", () => {
    expect(workflow).toContain("container_name=${{ vars.TFSTATE_CONTAINER || 'tfstate' }}");
  });

  it("staging no registra proveedores (no tiene permiso) y prod queda en el default legacy", () => {
    expect(workflow).toContain("ARM_RESOURCE_PROVIDER_REGISTRATIONS: ${{ (github.event.inputs.environment || 'prod') == 'staging' && 'none' || 'legacy' }}");
  });

  it("la concurrencia es por ambiente: un plan de staging no espera a uno de prod", () => {
    expect(workflow).toContain("group: terraform-${{ github.event.inputs.environment || 'prod' }}");
  });

  it("el drift semanal sigue siendo sólo de prod hasta que staging tenga un state aplicado", () => {
    expect(workflow).toMatch(/environment:\s*\[prod\]/);
  });
});

// Defectos que sólo aparecen al crear un ambiente desde cero: en prod los recursos ya existen y las
// carreras o los valores desconocidos no se notan. Los encontró el primer apply de staging (2026-10-12).
describe("primer apply de un ambiente nuevo", () => {
  it("MySQL espera al enlace de la VNet con la zona DNS privada, no sólo a la zona", () => {
    const salida = leer("infra/terraform/modules/private_dns/outputs.tf");
    const bloque = salida.match(/output "mysql_zone_id" \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(bloque).toMatch(/depends_on\s*=\s*\[azurerm_private_dns_zone_virtual_network_link\.this\]/);
  });

  it("la plantilla arranca con el Key Vault abierto: con private endpoint y sin firewall quedaría sin acceso público", () => {
    const ejemplo = leer(`${STG}/terraform.tfvars.example`);
    expect(ejemplo).toMatch(/keyvault_private_endpoint_enabled\s*=\s*false/);
    expect(ejemplo).toMatch(/keyvault_network_acls_enabled\s*=\s*false/);
  });
});
