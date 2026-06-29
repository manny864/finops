import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
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
    } catch (e: any) {
        return NextResponse.json({ error: "Error consultando estado", details: e.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        const email = (decoded?.preferred_username || decoded?.unique_name || decoded?.upn || decoded?.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (!isSuperAdmin) {
            return NextResponse.json({ error: "Solo super-admin puede sincronizar Open Data." }, { status: 403 });
        }

        const dataset = (request.nextUrl.searchParams.get("dataset") || "all") as OpenDataSet | "all";
        const valid = ["all", "services", "regions", "resourceTypes", "pricingUnits", "commitmentEligibility"];
        if (!valid.includes(dataset)) {
            return NextResponse.json({ error: `dataset inválido. Válidos: ${valid.join(", ")}` }, { status: 400 });
        }

        const result = await syncOpenDataSet(dataset);
        return NextResponse.json({ success: true, result });
    } catch (e: any) {
        return NextResponse.json({ error: "Error en la sincronización", details: e.message }, { status: 500 });
    }
}
