import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { refreshRatesFromAPI, SUPPORTED_CURRENCIES, getRate } from "@/lib/fx";
import pool from "@/modules/storage/db";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

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
    } catch (err) {
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
        const result = await refreshRatesFromAPI();
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        }
        return NextResponse.json({ success: false, error: errorMessage(err) || "Refresh falló" }, { status: 500 });
    }
}
