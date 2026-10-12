import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * infra/terraform/modules/security_policy/audit.tf: alertas de Activity Log y
 * Azure Policy en modo auditoría. Los dos interruptores vienen apagados y lo que
 * crean no puede bloquear ni modificar nada. Lo que se cuida acá es lo que no se
 * nota hasta que falla en silencio: un nombre de operación mal escrito hace que la
 * alerta nunca salte, y un `enforce` en true convertiría la auditoría en bloqueo.
 */
const leer = (ruta: string) => readFileSync(ruta, "utf8");
const audit = leer("infra/terraform/modules/security_policy/audit.tf");
const variablesModulo = leer("infra/terraform/modules/security_policy/variables.tf");
const variablesStamp = leer("infra/terraform/modules/stamp/variables.tf");
const variablesProd = leer("infra/terraform/environments/prod/variables.tf");
const mainProd = leer("infra/terraform/environments/prod/main.tf");

const bloque = (inicio: string, fin: string) => {
  const i = audit.indexOf(inicio);
  return audit.slice(i, audit.indexOf(fin, i));
};

describe("auditoría: interruptores", () => {
  it.each([
    ["activity_alerts_enabled", variablesModulo],
    ["policy_audit_enabled", variablesModulo],
    ["security_activity_alerts_enabled", variablesStamp],
    ["security_policy_audit_enabled", variablesStamp],
  ])("%s viene en false", (nombre, fuente) => {
    expect(fuente).toMatch(new RegExp(`variable "${nombre}"[\\s\\S]*?default\\s*=\\s*false`));
  });

  it("por stamp en el entorno: opcionales y en false, y se pasan al stamp", () => {
    expect(variablesProd).toMatch(/security_activity_alerts_enabled\s*=\s*optional\(bool,\s*false\)/);
    expect(variablesProd).toMatch(/security_policy_audit_enabled\s*=\s*optional\(bool,\s*false\)/);
    expect(mainProd).toMatch(/security_activity_alerts_enabled\s*=\s*each\.value\.security_activity_alerts_enabled/);
    expect(mainProd).toMatch(/security_policy_audit_enabled\s*=\s*each\.value\.security_policy_audit_enabled/);
  });

  it("apagados no crean nada: los dos recursos se arman con for_each condicional", () => {
    expect(audit).toMatch(/for_each\s*=\s*var\.activity_alerts_enabled \? local\.activity_alert_operations : \{\}/);
    expect(audit).toMatch(/for_each\s*=\s*var\.policy_audit_enabled \? local\.policy_audit_definitions : \{\}/);
  });

  // Regresión del primer plan de staging (2026-10-12): en un ambiente nuevo action_group_id no se
  // conoce hasta el apply, y un for_each que lo mire rompe el plan con "Invalid for_each argument".
  // En prod no se notaba porque el action group ya estaba en el state.
  it("el for_each no depende de action_group_id (desconocido en un ambiente nuevo); falta de grupo = precondición", () => {
    const recurso = audit.match(/resource "azurerm_monitor_activity_log_alert" "audit" \{[\s\S]*?\n\}/)?.[0] ?? "";
    const forEach = recurso.match(/^\s*for_each\s*=.*$/m)?.[0] ?? "";
    expect(forEach).not.toMatch(/action_group_id/);
    expect(recurso).toMatch(/precondition\s*\{[\s\S]*?var\.action_group_id != null/);
  });
});

describe("alertas de Activity Log", () => {
  const operaciones = [...bloque("activity_alert_operations = {", "}\n}").matchAll(/=\s*"([^"]+)"/g)].map((m) => m[1]);

  it("son nombres de operación con la forma Proveedor/tipo/accion", () => {
    expect(operaciones.length).toBeGreaterThanOrEqual(6);
    for (const op of operaciones) expect(op, op).toMatch(/^Microsoft\.[A-Za-z]+\/[A-Za-z/]+\/(write|delete)$/);
    expect(new Set(operaciones).size).toBe(operaciones.length);
  });

  it("cubre cambios de privilegio y borrado de lo que tiene datos", () => {
    expect(operaciones).toEqual(
      expect.arrayContaining([
        "Microsoft.Authorization/roleAssignments/write",
        "Microsoft.Authorization/roleAssignments/delete",
        "Microsoft.Authorization/locks/delete",
        "Microsoft.KeyVault/vaults/delete",
        "Microsoft.DBforMySQL/flexibleServers/delete",
        "Microsoft.Storage/storageAccounts/delete",
      ]),
    );
  });

  it("NO alerta sobre escrituras del Key Vault: el workflow de Terraform las hace en cada corrida", () => {
    expect(operaciones).not.toContain("Microsoft.KeyVault/vaults/write");
  });

  it("filtra por Succeeded para no mandar un aviso por cada fase de la operación", () => {
    expect(bloque('resource "azurerm_monitor_activity_log_alert"', "# ----")).toMatch(/status\s*=\s*"Succeeded"/);
  });
});

describe("Azure Policy en modo auditoría", () => {
  const definiciones = [...bloque("policy_audit_definitions = {", "}\n}").matchAll(/=\s*"([0-9a-f-]{36})"\s*#\s*(.+)/g)];

  it("son GUID de definiciones integradas, sin repetir, cada una con su nombre en el comentario", () => {
    expect(definiciones.length).toBeGreaterThanOrEqual(8);
    const guids = definiciones.map((m) => m[1]);
    expect(new Set(guids).size).toBe(guids.length);
    for (const [, guid, nombre] of definiciones) {
      expect(guid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(nombre.trim().length).toBeGreaterThan(10);
    }
  });

  it("enforce = false: mide y no bloquea", () => {
    const asignacion = audit.slice(audit.indexOf('resource "azurerm_resource_group_policy_assignment"'));
    expect(asignacion).toMatch(/enforce\s*=\s*false/);
    expect(asignacion).not.toMatch(/enforce\s*=\s*true/);
  });

  it("las asignaciones usan definiciones integradas del proveedor, no definiciones propias", () => {
    expect(audit).toContain('"/providers/Microsoft.Authorization/policyDefinitions/${each.value}"');
  });
});
