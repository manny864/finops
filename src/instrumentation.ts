/**
 * Next.js instrumentation hook — corre UNA vez cuando el servidor arranca,
 * antes de manejar cualquier request (https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
 *
 * Fase 0.1 (docs/vps-infra-improvement-plan.md): se usa para hidratar
 * `process.env.DB_PASSWORD` / `REDIS_PASSWORD` / `CRON_SECRET` desde Azure
 * Key Vault ANTES de que `src/modules/storage/db.ts` y `src/lib/redis.ts`
 * creen sus singletons (ambos leen `process.env` en su primer uso, así que
 * el orden importa). Si Key Vault no tiene el secret o está deshabilitado,
 * es un no-op y el `.env` del VPS sigue siendo la fuente de verdad.
 */
export async function register() {
  // Solo en el runtime de Node del servidor (no en el edge runtime ni en el browser).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { hydrateInfraSecretsFromKeyVault } = await import("@/lib/secrets/infraSecrets");
    await hydrateInfraSecretsFromKeyVault();
  }
}
