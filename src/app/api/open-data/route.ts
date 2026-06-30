import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { initializeDatabase } from "@/modules/storage/db";
import { syncOpenDataSet, getSyncState, type OpenDataSet } from "@/lib/openData";

/**
 * IT-08 — Microsoft FinOps Toolkit Open Data sync.
 * GET  /api/open-data           → estado de sincronización de cada dataset.
 * POST /api/open-data?dataset=X → fuerza sync (requiere super-admin).
 */
export async function GET(_request: NextRequest) {
    try {
        await initializeDatabase();
        const state = await getSyncState();
        return NextResponse.json({ success: true, datasets: state });
    } catch (e: unknown) {
        console.error("[open-data] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const dataset = (request.nextUrl.searchParams.get("dataset") || "all") as OpenDataSet | "all";
        const valid = ["all", "services", "regions", "resourceTypes", "pricingUnits", "commitmentEligibility"];
        if (!valid.includes(dataset)) {
            return NextResponse.json({ error: `dataset inválido. Válidos: ${valid.join(", ")}` }, { status: 400 });
        }

        const result = await syncOpenDataSet(dataset);
        return NextResponse.json({ success: true, result });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[open-data] POST error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
