import pool from "@/modules/storage/db";

export type CronRunStatus = "ok" | "warning" | "error";

export async function recordCronRun(args: {
    cronName: string;
    status: CronRunStatus;
    durationMs?: number | null;
    summary?: string | null;
    details?: Record<string, unknown> | null;
}): Promise<void> {
    try {
        await pool.query(
            `INSERT INTO SystemCronRuns (cron_name, status, duration_ms, summary, details)
             VALUES (?, ?, ?, ?, ?)`,
            [
                args.cronName,
                args.status,
                args.durationMs ?? null,
                args.summary ?? null,
                args.details ? JSON.stringify(args.details) : null,
            ]
        );
    } catch (error) {
        console.warn("[cronRunTracker] failed to persist cron run:", (error as Error)?.message || error);
    }
}
