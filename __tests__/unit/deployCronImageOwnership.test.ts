// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps scheduled runner images outside web application deployments", () => {
    const workflow = readFileSync(".github/workflows/deploy-azure.yml", "utf8");
    expect(workflow).not.toContain("Deploy de los cron jobs");
    expect(workflow).not.toContain("triggerType=='Schedule'");
    expect(workflow).toContain('az containerapp job update -g "$RG" -n "$MIGRATE_JOB"');
    expect(workflow).toContain("name: Health check");
});