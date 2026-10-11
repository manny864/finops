/**
 * Renderiza el runbook worker de backups (Backup-MySQL-Smart) tal como lo deja Terraform: toma el
 * heredoc de infra/terraform/modules/mysql_backup/main.tf, le quita la sangría y resuelve las
 * variables del módulo con sus valores por defecto (son los de producción: rutas de las
 * herramientas en la VM, carpeta temporal, contenedor y base).
 *
 * Hace falta porque el runbook se publica FUERA de Terraform (`content` está en `ignore_changes`,
 * porque el provider lee mal `runbook_type` y el update falla con 400): el heredoc es la fuente
 * de verdad pero no se publica solo. Con esto lo que se publica es exactamente lo versionado y lo
 * que prueba __tests__/unit/sharedKeyMigrationTerraform.test.ts.
 *
 * Uso (desde la raíz del repositorio):
 *        npx tsx infra/scripts/renderizar-runbook-worker.ts > worker.ps1
 *        npx tsx infra/scripts/renderizar-runbook-worker.ts --main <ruta a un main.tf anterior> > worker-anterior.ps1
 * (la segunda forma sirve para el rollback: `git show <sha>:infra/terraform/modules/mysql_backup/main.tf`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface RutasWorker {
  mysqldump: string;
  gzip: string;
  azcopy: string;
  temp: string;
  contenedor: string;
  bases: string[];
}

export const RUTAS_PRODUCCION: RutasWorker = {
  mysqldump: "C:\\Program Files\\MySQL\\MySQL Workbench 8.0 CE\\mysqldump.exe",
  gzip: "C:\\Program Files\\Git\\usr\\bin\\gzip.exe",
  azcopy: "C:\\Tools\\AzCopy\\azcopy.exe",
  temp: "C:\\TempBackups",
  contenedor: "db-backups",
  bases: ["finops"],
};

// Relativo a la raíz del repositorio: desde ahí se corre el CLI y vitest.
const MAIN_TF = resolve(process.cwd(), "infra/terraform/modules/mysql_backup/main.tf");

export function renderizarWorker(rutas: Partial<RutasWorker> = {}, rutaMain: string = MAIN_TF): string {
  const r = { ...RUTAS_PRODUCCION, ...rutas };
  const fuente = readFileSync(rutaMain, "utf8");
  const i = fuente.indexOf('resource "azurerm_automation_runbook" "worker"');
  if (i < 0) throw new Error("No encuentro el recurso del runbook worker en main.tf");
  const marca = "<<-PS1\n";
  const a = fuente.indexOf(marca, i) + marca.length;
  const b = fuente.indexOf("\n  PS1\n", a);
  if (a < marca.length || b < 0) throw new Error("No encuentro el heredoc del runbook worker");

  const lineas = fuente.slice(a, b).split("\n");
  const sangria = Math.min(...lineas.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  const bases = r.bases.map((db) => `"${db}"`).join(", ");

  const texto = lineas
    .map((l) => (l.trim() ? l.slice(sangria) : ""))
    .join("\n")
    .replaceAll("${var.vm_tool_path_mysqldump}", r.mysqldump)
    .replaceAll("${var.vm_tool_path_gzip}", r.gzip)
    .replaceAll("${var.vm_tool_path_azcopy}", r.azcopy)
    .replaceAll("${var.vm_local_temp_path}", r.temp)
    .replaceAll("${var.storage_container_name}", r.contenedor)
    .replace(/\$\{join\(", ", \[for db in var\.mysql_database_names : "\\"\$\{db\}\\""\]\)\}/, () => bases)
    // En el heredoc de HCL, `$${` es el escape de `${` de PowerShell.
    .replaceAll("$${", "${");

  const sinResolver = texto.match(/\$\{(var|join|azurerm)[^}]*\}/);
  if (sinResolver) throw new Error(`Quedó una interpolación de Terraform sin resolver: ${sinResolver[0]}`);
  return texto;
}

// Ejecutado directamente: imprime el script por stdout.
if (process.argv[1]?.endsWith("renderizar-runbook-worker.ts")) {
  const i = process.argv.indexOf("--main");
  process.stdout.write(`${renderizarWorker({}, i >= 0 ? process.argv[i + 1] : MAIN_TF)}\n`);
}
