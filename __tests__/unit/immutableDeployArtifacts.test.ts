// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const workflow = readFileSync(".github/workflows/_deploy.yml", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const terraform = readFileSync(".github/workflows/terraform.yml", "utf8");
describe("immutable deployment references", () => {
    it("pins the official base and Dockerfile frontend to verified digest formats", () => {
        expect(dockerfile).toMatch(/^FROM node:22-alpine@sha256:[a-f0-9]{64} AS base$/m);
        expect(dockerfile).toMatch(/^# syntax=docker\/dockerfile:1@sha256:[a-f0-9]{64}$/m);
        expect(readFileSync(".github/dependabot.yml", "utf8")).toContain("package-ecosystem: docker");
    });
    it("requires both builds to push, checks attached SBOM/provenance and deploys only digests", () => {
        expect(workflow).toContain("--provenance=mode=min --sbom=true --push");
        expect(workflow).toContain('REF="$REPOSITORY@$DIGEST"');
        expect(workflow).toContain("select(test(\"^sha256:[0-9a-f]{64}$\"))");
        expect(workflow).toContain("select(.spdxVersion? and .documentNamespace?)");
        expect(workflow).toContain("select(.buildType? and .materials?)");
        expect(workflow).toContain('--image "$MIGRATOR_IMAGE"');
        expect(workflow).toContain('--image "$RUNTIME_IMAGE"');
        expect(workflow).not.toMatch(/docker push .* &|--image .+:\$\{\{/);
        expect(workflow).toContain("if-no-files-found: error");
    });
    it("requires migration readiness and a versioned Key Vault reference before building", () => {
        expect(workflow).toContain('[ "$MIGRATION_READY" = "true" ]');
        expect(workflow.indexOf("APP_SECRET_MIGRATION_READY")).toBeLessThan(workflow.indexOf("docker buildx build"));
        expect(workflow).toContain('select(.name == "APP_SECRET_ENCRYPTION_KEY"');
        expect(workflow).toContain("[a-fA-F0-9]{32}");
        expect(workflow).not.toMatch(/\beval\b/);
    });
    it("observes the execution returned by job start, not the newest unrelated execution", () => {
        expect(workflow).toContain('EXECUTION=$(az containerapp job start');
        expect(workflow).toContain('--job-execution-name "$EXECUTION"');
        expect(workflow).not.toContain("[0].properties.status");
    });
    it("smokes the built references without external networking before migrations", () => {
        expect(workflow).toContain('--network none --entrypoint sh "$MIGRATOR_IMAGE"');
        expect(workflow).toContain('--network none -e SKIP_DB_INIT=1');
        expect(workflow).toContain('http://127.0.0.1:3000/api/config/public');
        expect(workflow).toContain('[ "$REVISION" = "$BUILD_SHA" ]');
        expect(workflow.indexOf("name: Smoke de los digests")).toBeLessThan(workflow.indexOf("name: Migraciones"));
    });
    it("does not rebuild prod or freeze public identity/billing into Docker layers", () => {
        expect(dockerfile).not.toMatch(/(?:ARG|ENV)\s+NEXT_PUBLIC_/);
        expect(workflow).not.toContain("--build-arg NEXT_PUBLIC_");
        expect(workflow).toContain('if [ "$DEPLOY_ENV" = "staging" ]; then');
        expect(workflow).toContain('az acr import -n "$ACR"');
        expect(workflow).toContain('--registry "$SOURCE_REGISTRY" --source "$IMAGE@$DIGEST"');
        expect(workflow).toContain('[ "$IMPORTED" = "$DIGEST" ]');
        expect(workflow).toContain('NEXT_PUBLIC_CLIENT_ID="$NEXT_PUBLIC_CLIENT_ID"');
        expect(workflow).toContain('publicConfiguration: "runtime-v1"');
    });
    it("passes the same public configuration to Terraform plan/apply and drift", () => {
        expect(terraform.match(/TF_VAR_public_runtime_config:/g)).toHaveLength(2);
        expect(terraform).toContain("TF_VAR_production_public_client_id: ${{ needs.scan.outputs.production_client_id }}");
        expect(readFileSync("infra/terraform/environments/prod/main.tf", "utf8")).toContain("var.public_runtime_config,");
        expect(readFileSync("infra/terraform/environments/prod/main.tf", "utf8")).toContain('lookup(var.public_runtime_config, "NEXT_PUBLIC_CLIENT_ID", "") != var.production_public_client_id');
        const config = readFileSync("src/lib/publicRuntimeConfig.ts", "utf8");
        expect(config).not.toMatch(/process\.env\.NEXT_PUBLIC_/);
        for (const file of ["src/components/AuthProvider.tsx", "src/components/PricingPage.tsx",
            "src/components/RoleAssignmentBanner.tsx", "src/components/billing/AddonsMarketplace.tsx"]) {
            expect(readFileSync(file, "utf8")).not.toMatch(/process\.env\.NEXT_PUBLIC_/);
        }
    });
});
