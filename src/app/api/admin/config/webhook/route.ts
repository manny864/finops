import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

        const [rows] = await pool.query("SELECT webhook_url FROM Tenants WHERE tenant_id = ?", [tenantId]);
        const tenants = rows as any[];
        
        if (tenants.length === 0) {
            return NextResponse.json({ webhook_url: "" });
        }

        return NextResponse.json({ webhook_url: tenants[0].webhook_url || "" });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

        const body = await request.json();
        const { tenantId, webhookUrl } = body;

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await pool.query("UPDATE Tenants SET webhook_url = ? WHERE tenant_id = ?", [webhookUrl, tenantId]);

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
