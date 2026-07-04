import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/modules/storage/db";
import { syncOpenDataSet } from "@/lib/openData";

/**
 * Cron de sincronización de los Open Data Sets del Microsoft FinOps Toolkit
 * (Regions, Services, ResourceTypes, PricingUnits, CommitmentDiscountEligibility).
 *
 * Estos datasets cambian con muy baja frecuencia (Microsoft los actualiza cada
 * pocas semanas), así que basta con correr este cron SEMANAL. Sin él, las tablas
 * OpenData* quedan vacías/desactualizadas y los lookups (getRegionFriendlyName,
 * getServiceCategory, getResourceTypeMeta) devuelven null.
 *
 * Auth: Authorization: Bearer CRON_SECRET (mismo patrón que /api/cron/sync).
 * Ejemplo crontab (ver README.md, sección Cron Jobs):
 *   0 4 * * 1  → semanal, lunes 04:00.
 *
 * RBAC: no es tenant-scoped (data pública global), sólo protegido por CRON_SECRET.
 */
export async function GET(request: NextRequest) {
    return runOpenDataSync(request);
}

export async function POST(request: NextRequest) {
    return runOpenDataSync(request);
}

async function runOpenDataSync(request: NextRequest) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        await initializeDatabase();
        const result = await syncOpenDataSet("all");

        const summary = Object.entries(result)
            .map(([ds, r]) => `${ds}=${r.status}(${r.count})`)
            .join(" ");
        console.log(`[cron-open-data] ${summary}`);

        const anyError = Object.values(result).some((r) => r.status === "error");
        return NextResponse.json(
            { status: anyError ? "Completed with errors" : "Open data synced", result },
            { status: anyError ? 207 : 200 }
        );
    } catch (e: unknown) {
        console.error("[cron-open-data] Error:", e);
        const message = e instanceof Error ? e.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
