# Job credential segmentation (STRIDE-07)

All cron-secret validators use `cronSecretForJob` with their fixed endpoint name.
`invalidate-ai-cache` is different: it requires a SuperAdmin user token, not a
workload credential. Internal prewarm fan-out remains server-side and read-only.

For job `status-snapshot`, inject an independent, randomly generated credential
of at least 32 characters as `CRON_JOB_SECRET_STATUS_SNAPSHOT` in the web app.
The corresponding Container Apps Job receives only that credential as its
`CRON_SECRET` secret reference. All other names follow the same uppercase,
hyphen-to-underscore convention. Keys are not accepted in URLs; trigger and poll
both use the Authorization header. Runners and internal fetches reject redirects.

When a scoped credential is configured for an endpoint, the shared credential
and every other job's credential cease to authorize that endpoint immediately.
`CRON_REQUIRE_SCOPED_SECRETS=true` disables fallback for ALL endpoints. Missing,
short or malformed scoped configuration fails explicitly, without fallback.
Until strict mode is enabled, unconfigured jobs retain existing shared auth to
support an ordered migration without stopping every schedule at once.

## Rollout gate (not yet applied)

1. Inventory the actual scheduled/manual callers and their methods, tenants and
   effects; the source currently has 43 job-secret validators, not the historic
   14-job count. Compare against deployed jobs instead of assuming equivalence.
2. Provision independent versioned secrets and **per-job managed identities**.
   Each identity needs pull permission and read access to only its own secret.
   The current shared jobs identity can read the legacy secret: merely changing
   HTTP credentials does not isolate a compromised Azure workload.
3. Configure web app references and each job in the same maintenance window.
   Do not print values, put them in URLs or use inline secret Terraform vars.
   The current Terraform module still references the shared credential and
   identity; update its model and inspect the per-environment plan before apply.
4. Verify trigger/poll success, another job's credential denied, old credential
   denied, rotation/revocation and failure telemetry for each job. Then enable
   strict mode and remove obsolete shared-secret access from workload identities.
5. Retain `CRON_SECRET` only within the app while internal prewarm uses it; it
   cannot authorize POST/PATCH/DELETE via `X-Cron-Auth`. A separate audience-bound
   Entra workload-token migration remains pending; do not claim shared secrets
   have been eliminated by this transitional implementation.

Rollback restores the prior app/job secret references together; the new code
can temporarily unset the scoped variable and strict mode, restoring legacy
header auth. Never re-enable query authentication.
