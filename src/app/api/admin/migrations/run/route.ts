import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { runMigrations } from "@/modules/storage/migrations";

export async function POST(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Auth error" }, { status: 401 });
    }

    try {
        const results = await runMigrations();
        const summary = {
            applied: results.filter(r => r.status === 'applied').length,
            skipped: results.filter(r => r.status === 'skipped').length,
            failed: results.filter(r => r.status === 'failed').length,
        };
        const status = summary.failed > 0 ? 500 : 200;
        return NextResponse.json({ success: summary.failed === 0, summary, results }, { status });
    } catch (err: any) {
        console.error("[migrations/run] error:", err);
        return NextResponse.json({ success: false, error: err?.message || "Error interno" }, { status: 500 });
    }
}
