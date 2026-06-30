import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);

        // 1. MySQL Health Check
        let dbStatus = "ERROR";
        let dbError: string | null = null;
        try {
            const connection = await pool.getConnection();
            await connection.ping();
            connection.release();
            dbStatus = "OK";
        } catch (e: unknown) {
            dbError = e instanceof Error ? e.message : String(e);
        }

        // 2. Env Vars Check
        const requiredEnvVars = [
            "DB_HOST",
            "DB_USER",
            "DB_PASSWORD",
            "DB_NAME",
            "NEXT_PUBLIC_CLIENT_ID"
        ];
        const envStatus: Record<string, string> = {};
        let allEnvVarsSet = true;

        requiredEnvVars.forEach(v => {
            const isSet = !!process.env[v];
            envStatus[v] = isSet ? "configured" : "missing";
            if (!isSet) allEnvVarsSet = false;
        });

        // 3. System Uptime
        const uptime = process.uptime(); // uptime in seconds

        return NextResponse.json({
            success: true,
            status: (dbStatus === "OK" && allEnvVarsSet) ? "HEALTHY" : "DEGRADED",
            database: {
                status: dbStatus,
                error: dbError
            },
            environment: {
                status: allEnvVarsSet ? "OK" : "MISSING_VARS",
                variables: envStatus
            },
            system: {
                uptimeSeconds: uptime,
                uptimeFormatted: formatUptime(uptime),
                nodeVersion: process.version,
                platform: process.platform
            }
        });

    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Diagnostics error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / (3600*24));
    const h = Math.floor((seconds % (3600*24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
}
