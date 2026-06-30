import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { refreshRatesFromAPI, SUPPORTED_CURRENCIES, getRate } from "@/lib/fx";
import pool from "@/modules/storage/db";

export async function GET(_request: NextRequest) {
    try {
        const ratesMap: Record<string, string> = {};
        for (const c of SUPPORTED_CURRENCIES) {
            if (c === "USD") { ratesMap[c] = "1"; continue; }
            try {
                const r = await getRate(c);
                ratesMap[c] = r.toString();
            } catch {
                ratesMap[c] = "?";
            }
        }
        let lastUpdate: string | null = null;
        try {
            const [rows] = await pool.query(`SELECT MAX(rate_date) as d FROM FxRates`);
            const arr = rows as Array<{ d: string }>;
            if (arr.length > 0) lastUpdate = arr[0].d || null;
        } catch { /* tabla puede no existir */ }
        return NextResponse.json({ success: true, rates: ratesMap, lastUpdate });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
        const result = await refreshRatesFromAPI();
        return NextResponse.json({ success: true, ...result });
    } catch (err: any) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        }
        return NextResponse.json({ success: false, error: err?.message || "Refresh falló" }, { status: 500 });
    }
}
