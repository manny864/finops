import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

it("INFRA-10: tres frameworks bloqueantes sin OIDC ni exclusiones globales", () => {
  const workflow = read(".github/workflows/terraform.yml");
  const scan = workflow.slice(workflow.indexOf("\n  scan:"), workflow.indexOf("\n  plan-apply:"));
  expect(scan).toContain("--framework terraform dockerfile github_actions");
  expect(scan).toContain("python3 infra/scripts/check-checkov-exceptions.py");
  expect(scan).toContain("python3 infra/scripts/test-checkov-regressions.py");
  expect(scan).toContain("-r infra/checkov/requirements.txt");
  expect(scan).not.toMatch(/^\s+id-token:|uses: azure\/login|^\s+environment:/m);
  expect(scan).not.toMatch(/skip_check|skip-check|soft.fail|hard.fail.on|baseline:/);
  const gate = scan.slice(scan.indexOf("- name: Checkov"), scan.indexOf("# continue-on-error"));
  expect(gate).not.toMatch(/continue-on-error|if:|[|][|] true/);
  expect(scan).toMatch(/name: Subir hallazgos[\s\S]*continue-on-error: true/);
  for (const path of ["infra/checkov/**", ".github/workflows/**", "Dockerfile",
    "infra/scripts/check-checkov-exceptions.py", "infra/scripts/test-checkov-regressions.py"]) {
    expect(workflow.slice(0, workflow.indexOf("\njobs:"))).toContain(`'${path}'`);
  }
  expect(read("infra/checkov/requirements.txt").trim()).toBe("checkov==3.3.26");
  const config = read("infra/checkov/config.yml");
  expect(config).toContain("skip-download: true");
  expect(config).toContain("download-external-modules: false");
  expect(config).not.toMatch(/skip-check|skip-path|baseline|soft-fail|hard-fail/);
});

it("INFRA-10: excepciones caducadas, incompletas o de controles protegidos bloquean", () => {
  const result = spawnSync("python3", ["-c", `
import datetime, runpy
validate = runpy.run_path("infra/scripts/check-checkov-exceptions.py")["validate"]
today = datetime.date(2026, 10, 15)
valid = "# checkov:skip=CKV_AZURE_33:owner=CloudOps; expires=2027-01-15; Queue unused; Blob Entra RBAC only."
assert not validate(valid, "test.tf", today)
for changed in [
    valid.replace("2027-01-15", "2026-10-15"),
    valid.replace("2027-01-15", "2026-10-14"),
    valid.replace("2027-01-15", "2028-01-15"),
    valid.replace("2027-01-15", "2027-99-15"),
    valid.replace("owner=CloudOps; ", ""),
    valid.replace("CKV_AZURE_33", "CKV_AZURE_35"),
    valid.replace("CKV_AZURE_33", "CKV_AZURE_109"),
    valid.replace("CKV_AZURE_33", "CKV2_AZURE_40"),
    valid.replace("CKV_AZURE_33", "CKV_AZURE_236"),
    valid.replace("CKV_AZURE_33", "CKV_AZURE_33,CKV_AZURE_59"),
    valid.replace("CKV_AZURE_33", "CKV2_FINOPS_1"),
]:
    assert validate(changed, "test.tf", today), changed
`], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
});

it("INFRA-10: controles negativos ejecutan el scanner real y no aceptan scans vacíos", () => {
  const script = read("infra/scripts/test-checkov-regressions.py");
  for (const check of ["CKV2_FINOPS_1", "CKV2_AZURE_40", "CKV_AZURE_236",
    "CKV2_GHA_1", "CKV_DOCKER_8", "CKV_AZURE_59"]) {
    expect(script).toContain(check);
  }
  expect(script).toContain('result.returncode == 1 and expected in failed');
  expect(script).toContain('report["summary"]["parsing_errors"] == 0');
  expect(script).toContain('report["summary"]["passed"] > 0');
  expect(script).toContain('assert "CKV2_FINOPS_1" in evaluated');
});
