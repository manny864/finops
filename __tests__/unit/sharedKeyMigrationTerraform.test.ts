import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUTAS_PRODUCCION, renderizarWorker } from "../../infra/scripts/renderizar-runbook-worker";

/**
 * Migración de la cuenta de Storage de claves compartidas a identidad administrada.
 * La clave de cuenta la usan tres clientes: la app (blob_managed_identity_enabled), los
 * backups (AzCopy en la VM del Hybrid Worker) y Terraform (storage_use_azuread). Estos tests
 * cuidan lo que no se nota hasta que falla en producción:
 *
 *  - El provider de prod usa Entra ID para el plano de datos de Storage.
 *  - La VM de backups tiene SU rol de datos, sólo sobre el contenedor, y el runbook worker sube
 *    con esa identidad: sin SAS, sin clave de cuenta y verificando el código de salida de cada
 *    paso (un `mysqldump | gzip` dejaba pasar dumps truncados).
 *  - Apagar Shared Key es un interruptor del stamp que por defecto NO cambia nada, y un check
 *    impide apagarlo con la app todavía en la connection string.
 *
 * El runbook se publica FUERA de Terraform (`content` está en ignore_changes), así que el
 * heredoc es la fuente de verdad pero no se ejecuta solo: acá se renderiza con los valores por
 * defecto, se valida su sintaxis con PowerShell y se ejecuta contra herramientas simuladas.
 */
const TF = "infra/terraform";
const PROD = `${TF}/environments/prod`;
const leer = (ruta: string) => readFileSync(ruta, "utf8");
const hayTerraform = spawnSync("terraform", ["version"], { encoding: "utf8" }).error === undefined;
const hayPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" }).status === 0;
const rutaGzip = spawnSync("which", ["gzip"], { encoding: "utf8" }).stdout.trim();

describe("Terraform deja de depender de la clave de cuenta", () => {
  it("el provider de prod usa Entra ID para el plano de datos de Storage", () => {
    const provider = leer(`${PROD}/main.tf`).match(/provider "azurerm" \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(provider).toMatch(/^\s*storage_use_azuread\s*=\s*true\s*$/m);
  });
});

describe("la VM de backups sube con su identidad", () => {
  const backup = leer(`${TF}/modules/mysql_backup/main.tf`);
  const rol = backup.match(/resource "azurerm_role_assignment" "vm_backups_blob_contributor" \{[\s\S]*?\n\}/)?.[0] ?? "";

  it("recibe Storage Blob Data Contributor sobre el contenedor, con la identidad de la VM", () => {
    expect(rol).toContain('role_definition_name = "Storage Blob Data Contributor"');
    expect(rol).toMatch(/scope\s*=\s*var\.storage_container_resource_id/);
    expect(rol).toMatch(/principal_id\s*=\s*azurerm_windows_virtual_machine\.this\.identity\[0\]\.principal_id/);
  });

  it("el scope llega armado desde el módulo storage, sin el atributo deprecado del provider", () => {
    const salida = leer(`${TF}/modules/storage/outputs.tf`);
    expect(salida).toMatch(/blobServices\/default\/containers\/\$\{azurerm_storage_container\.backups\.name\}/);
    expect(salida).not.toMatch(/value\s*=\s*azurerm_storage_container\.backups\.resource_manager_id/);
    expect(leer(`${TF}/modules/stamp/outputs.tf`)).toContain("module.storage.backups_container_resource_manager_id");
    expect(leer(`${PROD}/main.tf`)).toMatch(/storage_container_resource_id\s*=\s*module\.stamp\[var\.default_stamp\]\.backups_container_resource_manager_id/);
  });
});

describe("Shared Key: interruptor del stamp", () => {
  const stamp = leer(`${TF}/modules/stamp/main.tf`);
  const stampVars = leer(`${TF}/modules/stamp/variables.tf`);
  const prodVars = leer(`${PROD}/variables.tf`);

  it("viene encendido en todos lados: apagarlo es una decisión, no un default", () => {
    expect(stampVars).toMatch(/variable "storage_shared_access_key_enabled"[\s\S]*?default\s*=\s*true/);
    expect(prodVars).toMatch(/variable "storage_shared_access_key_enabled"[\s\S]*?default\s*=\s*true/);
    expect(leer(`${TF}/modules/storage/variables.tf`)).toMatch(/variable "shared_access_key_enabled"[\s\S]*?default\s*=\s*true/);
  });

  it("el stamp ya no lo fija en true: lo toma de su variable", () => {
    expect(stamp).toMatch(/shared_access_key_enabled\s*=\s*var\.storage_shared_access_key_enabled/);
    expect(stamp).not.toMatch(/shared_access_key_enabled\s*=\s*true/);
  });

  it("llega desde una variable de nivel raíz y no desde each.value: Checkov no resuelve for_each y CKV2_AZURE_41 fallaría en CI", () => {
    const main = leer(`${PROD}/main.tf`);
    expect(main).toMatch(/storage_shared_access_key_enabled\s*=\s*var\.storage_shared_access_key_enabled/);
    expect(main).not.toMatch(/storage_shared_access_key_enabled\s*=\s*each\.value/);
    expect(prodVars).not.toMatch(/storage_shared_access_key_enabled\s*=\s*optional/);
  });

  describe.skipIf(!hayTerraform)("el check evaluado con terraform console", () => {
    const checks = leer(`${PROD}/checks.tf`);
    const condicion = checks.slice(checks.indexOf('check "shared_key_apagada_requiere_app_con_identidad"')).match(/condition\s*=\s*(.+)/)?.[1];

    function evaluar(vars: Record<string, unknown>): string {
      const dir = mkdtempSync(join(tmpdir(), "terraform-sharedkey-test-"));
      try {
        writeFileSync(
          join(dir, "variables.tf"),
          [
            'variable "blob_managed_identity_enabled" {\n  type = bool\n  default = false\n}',
            'variable "storage_shared_access_key_enabled" {\n  type = bool\n  default = true\n}',
          ].join("\n"),
        );
        const env: NodeJS.ProcessEnv = { ...process.env };
        for (const [k, v] of Object.entries(vars)) env[`TF_VAR_${k}`] = typeof v === "string" ? v : JSON.stringify(v);
        const r = spawnSync("terraform", [`-chdir=${dir}`, "console"], { encoding: "utf8", input: `${condicion}\n`, env });
        expect(r.status, r.stderr).toBe(0);
        return r.stdout.trim();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it("existe y tiene condición", () => {
      expect(condicion).toBeDefined();
    });

    it.each([
      [false, true, true],
      [false, false, false],
      [true, false, true],
      [true, true, true],
    ])("app con identidad=%s, Shared Key encendida=%s => pasa=%s", (identidad, encendida, pasa) => {
      const r = evaluar({ blob_managed_identity_enabled: identidad, storage_shared_access_key_enabled: encendida });
      expect(r).toBe(String(pasa));
    });
  });
});

describe("runbook worker de backups: sube con la identidad de la VM", () => {
  const backup = leer(`${TF}/modules/mysql_backup/main.tf`);

  const renderizar = (rutas: { mysqldump: string; gzip: string; azcopy: string; temp: string }) => renderizarWorker(rutas);

  const win = { mysqldump: "C:\\mysqldump.exe", gzip: "C:\\gzip.exe", azcopy: "C:\\azcopy.exe", temp: "C:\\TempBackups" };

  it("ya no usa SAS, ni la variable STORAGE_SAS_TOKEN, ni depende de un '?' en la URL", () => {
    const t = renderizar(win);
    expect(t).not.toMatch(/sasToken|STORAGE_SAS_TOKEN/i);
    expect(t).not.toContain("IndexOf('?')");
    expect(t).toContain('$env:AZCOPY_AUTO_LOGIN_TYPE = "MSI"');
  });

  it("separa mysqldump de gzip y mira el código de salida de cada paso", () => {
    const t = renderizar(win);
    const sinComentarios = t.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(sinComentarios).not.toMatch(/cmd \/c/);
    expect(t).toContain("--result-file=");
    expect(t).toContain("$dumpProcess.ExitCode");
    expect(t).toContain("$gzipProcess.ExitCode");
    expect(t).toContain("-- Dump completed on");
    expect(t).toMatch(/-ArgumentList "-t /);
    expect(t).toContain("$uploadProcess.ExitCode");
  });

  it("conserva la corrección de nombres fijos para monthly/ y yearly/", () => {
    const t = renderizar(win);
    expect(t).toContain("$monthlyName");
    expect(t).toContain("$yearlyName");
    expect(t).not.toMatch(/monthly\/\$fileName|yearly\/\$fileName/);
  });

  it("el generador usa como defaults los valores de producción del módulo (variables.tf)", () => {
    const vars = leer(`${TF}/modules/mysql_backup/variables.tf`);
    const defecto = (nombre: string) => vars.match(new RegExp(`variable "${nombre}" \\{[\\s\\S]*?default\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`))?.[1]?.replaceAll("\\\\", "\\");
    expect(defecto("vm_tool_path_mysqldump")).toBe(RUTAS_PRODUCCION.mysqldump);
    expect(defecto("vm_tool_path_gzip")).toBe(RUTAS_PRODUCCION.gzip);
    expect(defecto("vm_tool_path_azcopy")).toBe(RUTAS_PRODUCCION.azcopy);
    expect(defecto("vm_local_temp_path")).toBe(RUTAS_PRODUCCION.temp);
    expect(defecto("storage_container_name")).toBe(RUTAS_PRODUCCION.contenedor);
  });

  it("el provider no publica el contenido: el runbook sigue ignorando `content`", () => {
    const i = backup.indexOf('resource "azurerm_automation_runbook" "worker"');
    const bloque = backup.slice(i, backup.indexOf('resource "azurerm_automation_runbook" "orchestrator"'));
    expect(bloque).toMatch(/ignore_changes\s*=\s*\[runbook_type, tags, content\]/);
  });

  describe.skipIf(!hayPwsh || !rutaGzip)("renderizado y ejecutado con PowerShell", () => {
    function correr(escenario: { dump?: "ok" | "falla" | "truncado"; azcopyExit?: number; cuenta?: string }) {
      const dir = mkdtempSync(join(tmpdir(), "worker-backup-test-"));
      try {
        const bin = join(dir, "bin");
        const temp = join(dir, "TempBackups");
        mkdirSync(bin);
        const logAzcopy = join(dir, "azcopy.log");
        const fake = (nombre: string, cuerpo: string) => {
          writeFileSync(join(bin, nombre), `#!/bin/sh\n${cuerpo}\n`);
          chmodSync(join(bin, nombre), 0o755);
          return join(bin, nombre);
        };
        const mysqldump = fake(
          "mysqldump",
          [
            'out=""',
            'for a in "$@"; do case "$a" in --result-file=*) out="${a#--result-file=}";; esac; done',
            'case "$FAKE_DUMP" in',
            '  falla) echo "parcial" > "$out"; exit 2;;',
            "  truncado) printf -- '-- MySQL dump\\nSELECT 1;\\n' > \"$out\"; exit 0;;",
            "  *) printf -- '-- MySQL dump\\nSELECT 1;\\n-- Dump completed on 2026-01-01  1:12:00\\n' > \"$out\"; exit 0;;",
            "esac",
          ].join("\n"),
        );
        const azcopy = fake("azcopy", 'echo "$AZCOPY_AUTO_LOGIN_TYPE|$*" >> "$FAKE_AZCOPY_LOG"\nexit "${FAKE_AZCOPY_EXIT:-0}"');
        const script = join(dir, "worker.ps1");
        writeFileSync(script, renderizar({ mysqldump, gzip: rutaGzip, azcopy, temp }));
        const harness = join(dir, "harness.ps1");
        writeFileSync(
          harness,
          [
            "function Get-AutomationVariable { param([string]$Name)",
            "  switch ($Name) { 'MYSQL_HOST' { 'host.example' } 'MYSQL_USER' { 'usuario' } 'MYSQL_PASS' { 'clave' } 'STORAGE_ACCOUNT_NAME' { $env:T_CUENTA } } }",
            // 1 de enero: corren daily, monthly y yearly.
            "function Get-Date { [datetime]::new(2026, 1, 1, 1, 12, 0) }",
            `try { . '${script}' } catch { Write-Output "ERROR_FINAL: $($_.Exception.Message)"; exit 1 }`,
          ].join("\n"),
        );
        const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", harness], {
          encoding: "utf8",
          env: {
            ...process.env,
            T_CUENTA: escenario.cuenta ?? "cuentaprueba",
            FAKE_DUMP: escenario.dump ?? "ok",
            FAKE_AZCOPY_LOG: logAzcopy,
            FAKE_AZCOPY_EXIT: String(escenario.azcopyExit ?? 0),
          },
        });
        return {
          status: r.status,
          salida: `${r.stdout}\n${r.stderr}`,
          azcopy: existsSync(logAzcopy) ? readFileSync(logAzcopy, "utf8").trim().split("\n") : [],
          restos: existsSync(temp) ? readdirSync(temp) : [],
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it("la sintaxis del script renderizado es válida", () => {
      const dir = mkdtempSync(join(tmpdir(), "worker-sintaxis-test-"));
      try {
        const f = join(dir, "worker.ps1");
        writeFileSync(f, renderizar(win));
        const r = spawnSync(
          "pwsh",
          ["-NoProfile", "-Command", `$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('${f}',[ref]$t,[ref]$e) | Out-Null; $e | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }; exit $e.Count`],
          { encoding: "utf8" },
        );
        expect(r.stdout, r.stderr).toBe("");
        expect(r.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("camino feliz el 1 de enero: sube daily, monthly y yearly con la identidad, sin SAS, y no deja archivos", () => {
      const r = correr({});
      expect(r.status, r.salida).toBe(0);
      expect(r.azcopy).toHaveLength(3);
      for (const linea of r.azcopy) {
        expect(linea.startsWith("MSI|copy ")).toBe(true);
        expect(linea).not.toContain("?");
      }
      expect(r.azcopy[0]).toContain("https://cuentaprueba.blob.core.windows.net/db-backups/finops/daily/finops_2026-01-01_0112.sql.gz");
      expect(r.azcopy[1]).toContain("https://cuentaprueba.blob.core.windows.net/db-backups/finops/monthly/finops_2026-01.sql.gz");
      expect(r.azcopy[2]).toContain("https://cuentaprueba.blob.core.windows.net/db-backups/finops/yearly/finops_2026.sql.gz");
      expect(r.restos).toEqual([]);
    });

    it("mysqldump que falla: el ciclo termina en error, no sube nada y no deja archivos", () => {
      const r = correr({ dump: "falla" });
      expect(r.status).not.toBe(0);
      expect(r.salida).toContain("mysqldump exit 2");
      expect(r.azcopy).toEqual([]);
      expect(r.restos).toEqual([]);
    });

    it("dump truncado (sin '-- Dump completed'): no se comprime ni se sube", () => {
      const r = correr({ dump: "truncado" });
      expect(r.status).not.toBe(0);
      expect(r.salida).toContain("Dump completed");
      expect(r.azcopy).toEqual([]);
      expect(r.restos).toEqual([]);
    });

    it("AzCopy que falla: el ciclo termina en error y lo dice por destino", () => {
      const r = correr({ azcopyExit: 1 });
      expect(r.status).not.toBe(0);
      expect(r.salida).toContain("azcopy exit 1");
      expect(r.restos).toEqual([]);
    });

    it("una variable de Automation vacía corta antes de tocar la base", () => {
      const r = correr({ cuenta: "" });
      expect(r.status).not.toBe(0);
      expect(r.salida).toContain("Variables de Automation vacias");
      expect(r.azcopy).toEqual([]);
    });
  });
});
