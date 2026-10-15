import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

it("INFRA-09: ejecuta los controles de lease ARM, fallos y reconciliación", () => {
  const result = spawnSync("python3", ["infra/scripts/test_tfstate_firewall.py"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(result.status, result.stderr).toBe(0);
});

it("INFRA-09: cada identidad tiene datos sólo en su contenedor y el backend tiene recuperación", () => {
  const bootstrap = read("infra/terraform/bootstrap/main.tf");
  for (const name of ["tfstate_blob_prod", "tfstate_blob_staging"]) {
    const start = bootstrap.indexOf(`resource "azurerm_role_assignment" "${name}"`);
    expect(start).toBeGreaterThan(0);
    expect(bootstrap.slice(start, bootstrap.indexOf("\n}", start))).toMatch(
      /scope\s*=\s*".*\/blobServices\/default\/containers\/\$\{azurerm_storage_container\./,
    );
  }
  expect(bootstrap).toMatch(/staging_terraform_sp_object_id != var\.terraform_sp_object_id/);
  expect(bootstrap).toMatch(/container_delete_retention_policy\s*\{\s*days\s*=\s*30/);
  expect(bootstrap).toMatch(/versioning_enabled\s*=\s*true/);
  expect(bootstrap).toMatch(/lock_level\s*=\s*"CanNotDelete"/);
  expect(bootstrap).toMatch(/prevent_destroy\s*=\s*true/);
  expect(bootstrap).toMatch(/default_action\s*=\s*"Deny"/);
  expect(bootstrap).toMatch(/bypass\s*=\s*\["None"\]/);
  for (const file of ["terraform.yml", "kv-firewall-reconcile.yml"]) {
    const wf = read(`.github/workflows/${file}`);
    const inits = wf.split("\n").filter((line) => /terraform init/.test(line) && !line.includes("-backend=false"));
    expect(inits.length).toBeGreaterThan(0);
    for (const init of inits) expect(init).toContain("-lockfile=readonly");
    expect(wf).not.toMatch(/LEASE_CONTAINER: tfstate/);
    expect(wf).not.toContain('-backend-config="container_name=tfstate"');
    const opens = [...wf.matchAll(/tfstate-firewall\.py" open/g)];
    const closes = [...wf.matchAll(/tfstate-firewall\.py" close/g)];
    expect(opens).toHaveLength(file === "terraform.yml" ? 2 : 1);
    expect(closes).toHaveLength(opens.length);
    expect(wf.match(/group: tfstate-firewall/g)).toHaveLength(opens.length);
    expect(wf.match(/if: always\(\) && steps\.backend_login\.outcome == 'success'/g)).toHaveLength(opens.length);
  }
  const rc = read(".github/workflows/kv-firewall-reconcile.yml");
  expect(rc.indexOf('tfstate-firewall.py" reconcile')).toBeLessThan(rc.indexOf('tfstate-firewall.py" open'));
});

it("INFRA-09: el control cruzado falla cerrado, sin confundir errores de red con aislamiento", () => {
  const dir = mkdtempSync(join(tmpdir(), "tfstate-isolation-"));
  const script = join(process.cwd(), "infra/scripts/check-tfstate-isolation.sh");
  try {
    writeFileSync(join(dir, "az"), `#!/usr/bin/env bash
set -eu
echo "$*" >> "$CALLS"
case "$*" in
  *"blob.core.windows.net/$OWN?"*)
    [ "$MODE" != own-denied ] || { echo AuthorizationPermissionMismatch >&2; exit 1; }
    echo 1 ;;
  *)
    case "$MODE" in
      cross-allowed) echo 1 ;;
      network) echo ConnectionError >&2; exit 1 ;;
      missing) echo ContainerNotFound >&2; exit 1 ;;
      generic-authorization) echo 'You do not have the required permissions needed to perform this operation.' >&2; exit 1 ;;
      *) echo '<Code>AuthorizationPermissionMismatch</Code>' >&2; exit 1 ;;
    esac ;;
esac
`);
    chmodSync(join(dir, "az"), 0o755);
    for (const [environment, own] of [["prod", "tfstate-prod"], ["staging", "tfstate-stg"]]) {
      for (const mode of ["denied", "cross-allowed", "network", "missing", "own-denied", "wrong-container", "generic-authorization", "bad-account", "bad-environment"]) {
        const calls = join(dir, "calls");
        writeFileSync(calls, "");
        const result = spawnSync("bash", [script], {
          encoding: "utf8",
          env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, OWN: own, MODE: mode, CALLS: calls,
            TFSTATE_STORAGE: mode === "bad-account" ? "bad/name" : "teststate",
            TFSTATE_CONTAINER: mode === "wrong-container" ? "wrong" : own,
            TFSTATE_ENVIRONMENT: mode === "bad-environment" ? "unknown" : environment },
        });
        expect(result.status, `${environment}: ${mode}: ${result.stderr}`).toBe(mode === "denied" ? 0 : 1);
        if (mode === "denied") {
          const commands = readFileSync(calls, "utf8").trim().split("\n");
          expect(commands).toHaveLength(3);
          for (const command of commands) {
            expect(command).toContain("--resource https://storage.azure.com/");
            expect(command).toContain("https://teststate.blob.core.windows.net/");
          }
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
