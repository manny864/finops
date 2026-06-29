import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { getMigrationsStatus } from "@/modules/storage/migrations";

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Auth error" }, { status: 401 });
    }

    try {
        const status = await getMigrationsStatus();
        return NextResponse.json({ success: true, ...status });
    } catch (err: any) {
        console.error("[migrations/status] error:", err);
        return NextResponse.json({ success: false, error: err?.message || "Error interno" }, { status: 500 });
    }
}
