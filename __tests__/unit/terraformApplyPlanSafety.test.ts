// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

function validate(plan: object, replacement = "") {
    const directory = mkdtempSync(join(tmpdir(), "terraform-plan-test-"));
    try {
        const path = join(directory, "plan.json");
        writeFileSync(path, JSON.stringify(plan));
        return spawnSync(process.execPath, ["scripts/validate-terraform-apply-plan.mjs", path], {
            encoding: "utf8", env: { ...process.env, REPLACE_ADDR: replacement },
        });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

it("accepts non-destructive changes and passing checks", () => {
    expect(validate({ resource_changes: [{ address: "lock", change: { actions: ["create"] } }], checks: [{ status: "pass" }] }).status).toBe(0);
});

it("blocks an unrequested replacement", () => {
    const result = validate({ resource_changes: [{ address: "database", change: { actions: ["delete", "create"] } }] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("database");
});

it("only exempts the explicitly requested replacement address", () => {
    const plan = { resource_changes: [{ address: "runbook", change: { actions: ["delete", "create"] } }] };
    expect(validate(plan, "runbook").status).toBe(0);
    expect(validate(plan, "database").status).toBe(1);
});

it.each(["fail", "unknown", "error"])("blocks unresolved check status %s", (status) => {
    expect(validate({ checks: [{ status, address: { to_display: "replicas_web_acotadas" } }] }).status).toBe(1);
});

it("blocks an errored plan", () => {
    expect(validate({ errored: true }).status).toBe(1);
});

it("uses targeted AcrPull propagation instead of deferring all stamp data sources", () => {
    const production = readFileSync("infra/terraform/environments/prod/main.tf", "utf8");
    const stamp = readFileSync("infra/terraform/modules/stamp/main.tf", "utf8");
    expect(production).not.toMatch(/^\s*depends_on\s*=\s*\[module\.acr\]/m);
    expect(stamp).toContain("depends_on      = [azurerm_role_assignment.acr_pull]");
    expect(stamp).toContain("time_sleep.acr_pull_propagation");
});