/**
 * Transitional job credentials. Each job accepts only its own configured
 * credential; strict mode removes the legacy shared-secret fallback globally.
 */
export function cronSecretForJob(job: string): string | undefined {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(job)) throw new Error("Invalid cron capability.");
    const name = `CRON_JOB_SECRET_${job.toUpperCase().replaceAll("-", "_")}`;
    const scoped = process.env[name];
    if (scoped !== undefined) {
        if (scoped.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
        return scoped;
    }
    if (process.env.CRON_REQUIRE_SCOPED_SECRETS === "true") {
        throw new Error(`${name} is required in scoped cron mode.`);
    }
    return process.env.CRON_SECRET;
}
