import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Detección (hallazgo H-05 de docs/security/auditoria-terraform-2026-10-11.md): el Activity Log sólo
 * vive 90 días y no se cruza con el resto de los logs, las alertas y las políticas en auditoría estaban
 * apagadas y la retención de las tablas de seguridad era de 30 días. Todo viene APAGADO: se ensaya en
 * staging y se enciende en prod con el plan revisado. Estos tests cuidan que:
 *
 *  - apagado no crea nada (prod no cambia hasta decidirlo);
 *  - el Activity Log sale con las cuatro categorías de seguridad y a nivel de suscripción;
 *  - las operaciones alertadas existen en Azure y tienen la forma Proveedor/tipo/accion;
 *  - la retención respeta los rangos del provider y su rollback es un update (el validador del apply sólo
 *    perdona UN delete, y borrar tres tablas quedaría bloqueado).
 */
const TF = "infra/terraform";
const leer = (ruta: string) => readFileSync(ruta, "utf8");
const audit = leer(`${TF}/modules/security_policy/audit.tf`);
const spVars = leer(`${TF}/modules/security_policy/variables.tf`);
const monMain = leer(`${TF}/modules/monitoring/main.tf`);
const monVars = leer(`${TF}/modules/monitoring/variables.tf`);

describe("exportación del Activity Log", () => {
  const recurso = audit.match(/resource "azurerm_monitor_diagnostic_setting" "activity_log" \{[\s\S]*?\n\}\n/)?.[0] ?? "";

  it("apagada no crea nada y apunta a la suscripción, no a un grupo de recursos", () => {
    expect(recurso).toMatch(/count\s*=\s*var\.activity_log_export_enabled \? 1 : 0/);
    expect(recurso).toMatch(/target_resource_id\s*=\s*data\.azurerm_subscription\.current\.id/);
    expect(recurso).toMatch(/log_analytics_workspace_id\s*=\s*var\.workspace_id/);
  });

  it("exporta exactamente las cuatro categorías de seguridad y ninguna de volumen", () => {
    const categorias = [...recurso.matchAll(/enabled_log\s*\{\s*category\s*=\s*"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(categorias).toEqual(["Administrative", "Alert", "Policy", "Security"]);
    for (const ruido of ["Recommendation", "Autoscale", "ResourceHealth", "ServiceHealth"]) expect(recurso).not.toContain(`"${ruido}"`);
  });

  it("sin workspace con el flag encendido falla en voz alta, no exporta a la nada", () => {
    expect(recurso).toMatch(/precondition\s*\{[\s\S]*?var\.workspace_id != null/);
  });

  it("viene apagada en el módulo, en el stamp y en el mapa stamps del root", () => {
    expect(spVars).toMatch(/variable "activity_log_export_enabled"[\s\S]*?default\s*=\s*false/);
    expect(leer(`${TF}/modules/stamp/variables.tf`)).toMatch(/variable "security_activity_log_export_enabled"[\s\S]*?default\s*=\s*false/);
    expect(leer(`${TF}/environments/prod/variables.tf`)).toMatch(/security_activity_log_export_enabled\s*=\s*optional\(bool, false\)/);
  });
});

describe("operaciones alertadas", () => {
  const mapa = audit.match(/activity_alert_operations = \{[\s\S]*?\n  \}\n/)?.[0] ?? "";
  const operaciones = Object.fromEntries([...mapa.matchAll(/^\s+([a-z-]+)\s*=\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]));

  // Verificadas el 2026-10-12 con `az provider operation show` (un nombre equivocado no da error: la alerta
  // simplemente nunca salta).
  it.each([
    ["vm-run-command", "Microsoft.Compute/virtualMachines/runCommand/action"],
    ["runbook-publish", "Microsoft.Automation/automationAccounts/runbooks/publish/action"],
    ["nsg-rule-write", "Microsoft.Network/networkSecurityGroups/securityRules/write"],
    ["storage-key-regen", "Microsoft.Storage/storageAccounts/regeneratekey/action"],
  ])("%s alerta sobre %s", (clave, operacion) => {
    expect(operaciones[clave]).toBe(operacion);
  });

  it("conserva las siete originales de privilegios y borrado de lo que tiene datos", () => {
    for (const clave of ["role-assignment-write", "role-assignment-delete", "role-definition-write", "lock-delete", "keyvault-delete", "mysql-delete", "storage-delete"]) {
      expect(operaciones).toHaveProperty(clave);
    }
    expect(Object.keys(operaciones)).toHaveLength(11);
  });

  it("no alerta sobre listKeys: el provider lo llama en cada plan y la alerta sería ruido", () => {
    expect(Object.values(operaciones).join(" ")).not.toMatch(/listkeys/i);
  });
});

describe("retención de las tablas de seguridad", () => {
  const recurso = monMain.match(/resource "azurerm_log_analytics_workspace_table" "seguridad" \{[\s\S]*?\n\}\n/)?.[0] ?? "";

  it("sin gestionar (0) no crea nada y gestiona exactamente las tres tablas que alimentan una investigación", () => {
    expect(recurso).toMatch(/for_each\s*=\s*var\.security_tables_retention_days > 0 \? toset\(\["AzureDiagnostics", "AzureActivity", "StorageBlobLogs"\]\) : toset\(\[\]\)/);
  });

  it("usa los dos atributos del provider y exige total >= interactiva", () => {
    expect(recurso).toMatch(/retention_in_days\s*=\s*var\.security_tables_retention_days/);
    expect(recurso).toMatch(/total_retention_in_days\s*=\s*var\.security_tables_total_retention_days/);
    expect(recurso).toMatch(/var\.security_tables_total_retention_days >= var\.security_tables_retention_days/);
  });

  it("viene en 0 en el módulo, en el stamp y en el root, con los rangos del provider validados", () => {
    expect(monVars).toMatch(/variable "security_tables_retention_days"[\s\S]*?default\s*=\s*0/);
    expect(monVars).toMatch(/variable "security_tables_total_retention_days"[\s\S]*?default\s*=\s*0/);
    expect(monVars).toMatch(/>= 4 && var\.security_tables_retention_days <= 730/);
    expect(monVars).toContain("1095, 1460, 1826, 2191, 2556, 2922, 3288, 3653, 4018, 4383");
    expect(leer(`${TF}/modules/stamp/variables.tf`)).toMatch(/variable "security_tables_retention_days"[\s\S]*?default\s*=\s*0/);
    expect(leer(`${TF}/environments/prod/variables.tf`)).toMatch(/security_tables_retention_days\s*=\s*optional\(number, 0\)/);
  });

  it("el rollback es un update: la documentación dice igualar la total a la interactiva, no borrar", () => {
    expect(monVars).toMatch(/ROLLBACK: igualarla a la interactiva/);
  });
});

describe("cableado hasta el módulo", () => {
  const stamp = leer(`${TF}/modules/stamp/main.tf`);
  const raiz = leer(`${TF}/environments/prod/main.tf`);

  it("el stamp pasa el Activity Log y el workspace a security_policy, y la retención a monitoring", () => {
    expect(stamp).toMatch(/activity_log_export_enabled\s*=\s*var\.security_activity_log_export_enabled/);
    expect(stamp).toMatch(/workspace_id\s*=\s*module\.monitoring\.workspace_id/);
    expect(stamp).toMatch(/security_tables_retention_days\s*=\s*var\.security_tables_retention_days/);
    expect(stamp).toMatch(/security_tables_total_retention_days\s*=\s*var\.security_tables_total_retention_days/);
  });

  it("el root toma los tres valores del mapa stamps", () => {
    for (const a of ["security_activity_log_export_enabled", "security_tables_retention_days", "security_tables_total_retention_days"]) {
      expect(raiz).toMatch(new RegExp(`${a}\\s*=\\s*each\\.value\\.${a}`));
    }
  });
});
