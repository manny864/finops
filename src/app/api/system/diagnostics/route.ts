import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        // Auth check: only SuperAdmins
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        if (!isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado. Se requiere rol SuperAdmin." }, { status: 403 });
        }

        // 1. MySQL Health Check
        let dbStatus = "ERROR";
        let dbError: string | null = null;
        try {
            const connection = await pool.getConnection();
            await connection.ping();
            connection.release();
            dbStatus = "OK";
        } catch (e: any) {
            dbError = e.message;
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

    } catch (e: any) {
        console.error("Diagnostics error:", e);
        return NextResponse.json({ error: "Error interno en diagnóstico", details: e.message }, { status: 500 });
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
