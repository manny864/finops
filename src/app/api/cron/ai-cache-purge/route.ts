import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/modules/storage/db";
import { serverError } from "@/lib/apiErrors";
import { aiCachePurgeExpired } from "@/lib/aiCache";

/**
 * AISEC-05: borra de AiCache las filas vencidas y las legadas sin tenant_id (ya no se
 * leen). Por tandas; idempotente. Mismo esquema de auth que support-attachments-cleanup.
 */
export async function GET(request: NextRequest) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        await initializeDatabase();

        let deleted = 0;
        for (let i = 0; i < 20; i++) {
            const n = await aiCachePurgeExpired(5000);
            deleted += n;
            if (n < 5000) break;
        }
        return NextResponse.json({ success: true, deleted });
    } catch (e: unknown) {
        return serverError(e, { context: "GET /api/cron/ai-cache-purge" });
    }
}
