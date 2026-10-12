import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Auditoría del servidor MySQL (hallazgo H-04 de docs/security/auditoria-terraform-2026-10-11.md).
 * Sin ella no queda registro de quién se conectó ni de los DDL y los cambios de permisos. Es un
 * interruptor que viene APAGADO: se ensaya en staging y recién después se enciende en prod, porque suma
 * ingesta de logs. Estos tests cuidan que:
 *
 *  - apagado no crea nada (prod no cambia hasta decidirlo);
 *  - las clases de evento son válidas para Azure y son las de seguridad, no las de volumen;
 *  - el interruptor llega desde el mapa `stamps` hasta el módulo.
 */
const TF = "infra/terraform";
const leer = (ruta: string) => readFileSync(ruta, "utf8");
const mysql = leer(`${TF}/modules/mysql/main.tf`);
const mysqlVars = leer(`${TF}/modules/mysql/variables.tf`);

// Valores admitidos de `audit_log_events`, leídos de Azure el 2026-10-12 con
// `az mysql flexible-server parameter show -n audit_log_events --query allowedValues`.
const ADMITIDOS = ["DDL", "DML_SELECT", "DML_NONSELECT", "DCL", "ADMIN", "DML", "GENERAL", "CONNECTION", "CONNECTION_V2", "TABLE_ACCESS"];

describe("recursos de auditoría del módulo mysql", () => {
  const bloque = (nombre: string) => mysql.match(new RegExp(`resource "azurerm_mysql_flexible_server_configuration" "${nombre}" \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
  const habilitado = bloque("audit_log_enabled");
  const eventos = bloque("audit_log_events");

  it("apagado no crea nada: los dos parámetros llevan count condicionado al interruptor", () => {
    expect(habilitado).toMatch(/count\s*=\s*var\.audit_log_enabled \? 1 : 0/);
    expect(eventos).toMatch(/count\s*=\s*var\.audit_log_enabled \? 1 : 0/);
  });

  it("usan los nombres de parámetro de Azure y prenden con ON", () => {
    expect(habilitado).toMatch(/name\s*=\s*"audit_log_enabled"/);
    expect(habilitado).toMatch(/value\s*=\s*"ON"/);
    expect(eventos).toMatch(/name\s*=\s*"audit_log_events"/);
    expect(eventos).toMatch(/value\s*=\s*var\.audit_log_events/);
  });

  it("se encadenan: Azure serializa los cambios de parámetros y dos en paralelo chocan", () => {
    expect(habilitado).toMatch(/depends_on\s*=\s*\[azurerm_mysql_flexible_server_configuration\.require_tls\]/);
    expect(eventos).toMatch(/depends_on\s*=\s*\[azurerm_mysql_flexible_server_configuration\.audit_log_enabled\]/);
  });
});

describe("valores por defecto", () => {
  it("la auditoría viene apagada en el módulo, en el stamp y en el mapa stamps del root", () => {
    expect(mysqlVars).toMatch(/variable "audit_log_enabled"[\s\S]*?default\s*=\s*false/);
    expect(leer(`${TF}/modules/stamp/variables.tf`)).toMatch(/variable "mysql_audit_log_enabled"[\s\S]*?default\s*=\s*false/);
    expect(leer(`${TF}/environments/prod/variables.tf`)).toMatch(/mysql_audit_log_enabled\s*=\s*optional\(bool, false\)/);
  });

  const porDefecto = mysqlVars.match(/variable "audit_log_events"[\s\S]*?default\s*=\s*"([^"]+)"/)?.[1] ?? "";
  const clases = porDefecto.split(",");

  it("todas las clases por defecto son admitidas por Azure", () => {
    expect(clases.length).toBeGreaterThan(0);
    for (const c of clases) expect(ADMITIDOS).toContain(c);
  });

  it("incluyen los intentos de conexión fallidos (CONNECTION_V2), los DDL y los cambios de permisos", () => {
    expect(clases).toEqual(expect.arrayContaining(["CONNECTION_V2", "DDL", "DCL"]));
    expect(clases).not.toContain("CONNECTION"); // no registra los intentos fallidos
  });

  it("dejan afuera las clases de volumen: ADMIN (SHOW STATUS), DML y GENERAL", () => {
    for (const c of ["ADMIN", "DML", "DML_SELECT", "DML_NONSELECT", "GENERAL", "TABLE_ACCESS"]) expect(clases).not.toContain(c);
  });
});

describe("cableado hasta el módulo", () => {
  it("el stamp pasa el interruptor al módulo mysql", () => {
    expect(leer(`${TF}/modules/stamp/main.tf`)).toMatch(/audit_log_enabled\s*=\s*var\.mysql_audit_log_enabled/);
  });

  it("el root lo toma del mapa stamps", () => {
    expect(leer(`${TF}/environments/prod/main.tf`)).toMatch(/mysql_audit_log_enabled\s*=\s*each\.value\.mysql_audit_log_enabled/);
  });

  it("la plantilla de staging lo enciende (se ensaya ahí antes que en prod)", () => {
    expect(leer(`${TF}/environments/staging/terraform.tfvars.example`)).toMatch(/mysql_audit_log_enabled\s*=\s*true/);
  });
});
