# Application secret key migration (INT-03)

New writes require `APP_SECRET_ENCRYPTION_KEY`: a dedicated random 32-byte key
encoded as 64 hex characters or canonical base64, injected through a versioned
Key Vault secret reference. It is not an authentication, MFA, database or cache
key. Missing or malformed keys fail closed.

Existing `enc:v1` data requires `APP_SECRET_LEGACY_V1_KEY`, explicitly set to the
exact material selected by the previous runtime. That runtime selected the first
nonempty value among MFA_ENCRYPTION_KEY, AZURE_KEYVAULT_CACHE_KEY,
ENCRYPTION_SECRET, NEXTAUTH_SECRET, AUTH_SECRET, JWT_SECRET, SESSION_SECRET,
AZURE_CLIENT_SECRET, DB_PASSWORD, DATABASE_URL, then an insecure built-in seed.
Inspect configuration within the environment; never copy values into reports.
If records used different keys historically, stop and inventory them: this
migrator deliberately does not guess keys or silently skip unreadable values.

## Execution record (2026-10-16)

Executed in staging and prod: protected on-demand backup, isolated restore
verified and deleted, versioned Key Vault references with the app identity,
dry-run, transactional apply (staging 0 values, prod 2 global AI values now
`enc:v2`) and readiness set. Legacy material matched the previous runtime's
first resolved key (`infra-azure-client-secret`). These app secret references
were added outside Terraform: add them to `key_vault_secret_ids` and
`key_vault_secret_env` in `TF_VARS`/`TF_VARS_PROD` before the next apply.

## Deployment gate

Do not deploy the new application without first provisioning both references,
checking that v1 values decrypt, and testing recovery in staging. No live keys,
data or Azure configuration have been changed by adding this code.

The reusable deployment workflow fails before any build or SQL migration unless
the GitHub environment variable `APP_SECRET_MIGRATION_READY` is exactly `true`
and the existing web app resolves `APP_SECRET_ENCRYPTION_KEY` through a versioned
Key Vault reference (including its managed identity). Set readiness only after
the steps below have been completed and recorded. This is an operator attestation,
not an automated proof of a successful restore or of the stored key's strength.
Removing the variable blocks subsequent deployments. Do not set it merely to
make CI green; leave it unset while the live migration is pending.

1. Schedule a maintenance window and pause secret writes/background consumers.
2. Take a protected database backup and preserve exact old key versions.
   Verify a restore in an isolated environment. Backups can contain plaintext
   legacy secrets and must have equivalent access controls.
3. Inject the new dedicated key and explicit old key into the new runtime and
   migration process. Keep the old deployment available but do not resume it
   against a database already migrated to v2.
4. Run `npx tsx scripts/rotate-app-secrets.ts --dry-run`. It authenticates every
   populated Tenants.ai_api_key / Tenants.itsm_api_key_encrypted and both global
   AI keys, re-encrypts in memory and verifies round trips, without printing
   identifiers, ciphertext or plaintext. A missing schema/key or corrupt value
   aborts the migration.
5. After reviewing the result, run with `--apply --backup-confirmed`. All rows
   are locked and updated in one transaction; any error rolls back. This is
   intended for a bounded maintenance window, not a large online migration.
6. Start the new application; verify tenant/global AI and ITSM with synthetic
   credentials, new writes and readbacks. Confirm no v1/plaintext records remain
   using counts only, then resume writes/jobs. Remove the legacy key reference
   only after the rollback retention period.
7. Rollback requires the matching database backup plus old key version and old
   application. Do not roll back only the image: the old code cannot read v2.

Coordinate the first v2 deployment in the maintenance window: deploy the new
revision without production traffic using the approved digest, run the migration
and synthetic checks there, and switch traffic only after readiness is recorded.
The ordinary automatic workflow is deliberately not the bootstrap mechanism for
this one-time migration. Do not resume an old cron/application against v2 data.

Repeated migration is safe but rewrites ciphertext using fresh nonces. For a
future v2 key rotation, add a new envelope/key version before changing the v2
key: overwriting it in place would make existing v2 records unreadable.

The older `encrypt-existing-ai-keys.ts` only encrypts plaintext AI values;
it is not a rotation mechanism and does not cover ITSM or enterprise AI.
