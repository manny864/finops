import { afterEach, describe, expect, it, vi } from "vitest";
import { cronSecretForJob } from "@/lib/cronJobSecret";
afterEach(() => vi.unstubAllEnvs());
describe("per-job credentials during migration", () => {
    it("different jobs resolve different credentials, not another job's credential", () => {
        vi.stubEnv("CRON_SECRET", "legacy".repeat(8));
        vi.stubEnv("CRON_JOB_SECRET_SYNC", "s".repeat(48));
        vi.stubEnv("CRON_JOB_SECRET_STATUS_SNAPSHOT", "t".repeat(48));
        expect(cronSecretForJob("sync")).toBe("s".repeat(48));
        expect(cronSecretForJob("status-snapshot")).toBe("t".repeat(48));
    });
    it("strict mode never falls back to the shared credential", () => {
        vi.stubEnv("CRON_REQUIRE_SCOPED_SECRETS", "true");
        vi.stubEnv("CRON_SECRET", "legacy".repeat(8));
        expect(() => cronSecretForJob("no-such-job")).toThrow(/required/);
    });
    it("a malformed configured credential never falls back to shared", () => {
        vi.stubEnv("CRON_JOB_SECRET_SYNC", "short");
        vi.stubEnv("CRON_SECRET", "legacy".repeat(8));
        expect(() => cronSecretForJob("sync")).toThrow(/32/);
    });
});
