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
  // Solo en el runtime de Node del servidor (no en el edge runtime ni en el browser)
  // y SOLO en producción: el .env.development local apunta al mismo Key Vault
  // que producción (para poder probar secretos de tenant), así que si esto
  // corriera en dev pisaría silenciosamente DB_PASSWORD/REDIS_PASSWORD/
  // CRON_SECRET locales con los valores reales de producción desde
  // infra-db-password/infra-redis-password/infra-cron-secret, rompiendo la
  // conexión a la DB local (causó "Access denied for user 'finops_user'" en
  // desarrollo). En producción NODE_ENV=production siempre.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { hydrateInfraSecretsFromKeyVault } = await import("@/lib/secrets/infraSecrets");
    await hydrateInfraSecretsFromKeyVault();
  }
}
