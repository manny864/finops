import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = "infra/terraform/environments";
const terraformAvailable = !spawnSync("terraform", ["version"]).error;
const read = (path: string) => readFileSync(path, "utf8");

describe("INFRA-09: private runner network inputs", () => {
  for (const environment of ["prod", "staging"]) {
    it(`${environment}: runner subnets are a root input, not a segmentation stamp`, () => {
      expect(read(`${root}/${environment}/network.tfvars`)).toMatch(
        /^keyvault_runner_subnet_ids = \{/m,
      );
    });

    it.runIf(terraformAvailable)(`${environment}: Terraform evaluates the actual input types`, () => {
      const directory = mkdtempSync(join(tmpdir(), "finops-runner-inputs-"));
      try {
        const definitions = [
          read(`${root}/${environment}/variables.tf`).match(/^variable "network_segmentation" \{[\s\S]*?^\}/m)?.[0],
          read(`${root}/${environment}/main.tf`).match(/^variable "keyvault_runner_subnet_ids" \{[\s\S]*?^\}/m)?.[0],
        ];
        expect(definitions.every(Boolean)).toBe(true);
        writeFileSync(join(directory, "main.tf"),
          definitions.join("\n") + '\nvariable "stamps" {\n  default = { us = {} }\n}\n');
        copyFileSync(`${root}/${environment}/network.tfvars`, join(directory, "network.tfvars"));
        const result = spawnSync("terraform", ["console", "-no-color", "-var-file=network.tfvars"], {
          cwd: directory,
          encoding: "utf8",
          input: "jsonencode({ stamps = keys(var.network_segmentation), runners = var.keyvault_runner_subnet_ids })\n",
        });
        expect(result.status, result.stderr).toBe(0);
        const value = JSON.parse(JSON.parse(result.stdout.trim()));
        expect(value.stamps).toEqual(["us"]);
        expect(value.runners.us).toHaveLength(1);
        expect(value.runners.us[0]).toContain(`cscs-finops-${environment}-runner-rg`);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
