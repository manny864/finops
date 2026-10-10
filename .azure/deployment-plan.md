# Production hardening deployment - 2026-10-10

Status: Deployed
Recipe: Terraform through the existing GitHub Actions workflows (no azd migration).

## 1. Scope and authorization

The user requested a Graphify-grounded review, security/optimization fixes,
commit, merge, push, Terraform apply and deployment verification.
The subscription confirmation prompt returned an instruction to work autonomously.
Do not treat that response as approval for unexplained infrastructure drift.

## 2. Existing target

- Repository: manny864/finops; base branch: main.
- Subscription: ec03e8ce-ceee-4638-b303-64ae431d5b1e.
- Region: westus2; resource group: cscs-finops-prod-westus2-rg.
- App: cscs-finops-prod-westus2-web.
- Infrastructure workflow: .github/workflows/terraform.yml.
- Application workflow: .github/workflows/deploy-azure.yml.

## 3. Proposed changes

- Review and integrate PR #117 only after checking its exact diff.
- Close verified corporate SUPERADMIN escalation and real-tenant mock bypasses.
- Reject email-less user identities in the tenant-list handler.
- Fail closed for missing/short Azure AI cron secrets.
- Remove the global stamp/ACR dependency while keeping the AcrPull propagation wait.
- Keep Shared Keys enabled until backup scripts migrate.
- Do not activate Cloudflare ingress restrictions; ACA accepts IPv4 ranges only.

## 4. Apply gates

Run a new production plan from the integrated main SHA without confirmation.
Classify every create/update/delete/replace, including drift outside PR #117.
Do not apply an unexplained plan or any unapproved destructive change.
Do not claim the handoff's two-lock expectation matches actual production.
Capture Azure inventory before and after any apply attempt.
Verify firewall cleanup, lock scopes, app health and revision after deployment.

## 5. Validation steps

- Focused Vitest regressions for each changed security boundary.
- Typecheck, lint, full unit/integration tests and production build.
- Terraform fmt/validate and remote plan through the existing authenticated pipeline.
- Static RBAC and managed-identity wiring review.
- Current-head CI and post-deploy endpoint checks.

## 6. Known limitations

Graphify graph.json predates the October 10 changes; use it as a map and verify source.
The review is broad but does not claim every source line was inspected.
The prior PR plan contains many updates beyond the handoff's expected two locks.
Existing-vault adoption uses a data source; a create-only lock will not protect it.

## 7. Validation proof

- 2026-10-10 current apply validation: Terraform validate/fmt succeeded,
	typecheck and production build succeeded; full suite 4,921 passed, 50 skipped.
- Plan run 38086902781, commit e4ea027: 2 lock creates, 89 in-place updates,
	zero destroys/replacements and no failed replica check. Updates reconcile
	tags (Environment prod -> PROD); app additionally removes APP_VERSION, which
	the existing post-apply step restores from the unchanged container image.
- Static RBAC review: stamp identity retains scoped AcrPull and Storage Blob
	Data Contributor; no role replacement in the current plan. App health: ok.

- requestAuthTenantAccess + authGuard: 17 tests passed.
- adminMockAuthorization + requestAuthTenantAccess: 9 tests passed.
- syncAzureAiTenantId: 12 tests passed.
- Live Resource Graph: production app exists, provisioningState Succeeded.
- PR #117 head 615f141: current checks succeeded; not proof of safe apply scope.
- Full suite after workflow guard: 4,911 passed, 50 skipped.
- Typecheck and production Next.js build succeeded; touched-source lint: zero errors.
- Terraform init -backend=false, validate and fmt -check succeeded locally.
- PR plan: 3 adds, 89 updates, 1 destroy; failed replicas check. Apply blocked.
- New main plan run 38061470356: 2 adds, 89 updates, zero destroys. RBAC replacement resolved.
- replicas_web_acotadas still fails: production config has web_max_replicas=5.
- PR #117 merged as c88a9ac; security fixes pushed as f45361c.
- Integrated build succeeded. Handler test cache isolation corrected and focused tests passed.

## 8. Execution status

Terraform apply completed successfully on 2026-10-10 through run 38087177000
at commit e4ea027: 2 added, 89 changed, 0 destroyed. MySQL and Key Vault
CanNotDelete locks were created; the safety guard, APP_VERSION restoration
and temporary Key Vault firewall cleanup steps all succeeded.
Post-apply health is ok and status operational, app version
0e0f0b103891eea5a26cb514b135b0439ca37bbc. Azure confirms revision 0000313,
Running/Succeeded and scale min=1, max=5. The configured maximum is preserved.
Inventory capture reported no new ordinary resources or cleanup concerns;
authorization locks are evidenced by Terraform creation logs, not that inventory.
The user explicitly requested removing the fixed replica cap and Terraform apply.
The replica check now validates integer min/max ranges without a fixed ceiling;
the configured production maximum remains unchanged. Local Terraform validate/fmt,
17 focused tests, typecheck and 4,921 full-suite tests passed on 2026-10-10.
Obtain and review a current-commit remote plan before apply; destructive changes
remain blocked. Do not change subscription or silently reduce capacity.
Deployment and endpoint verification are complete for this apply.