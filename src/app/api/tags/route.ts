import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });

        const [rows] = await pool.query("SELECT * FROM TaggingPolicies WHERE tenant_id = ?", [tenantId]);
        return NextResponse.json({ policies: rows });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { tenantId, tagKey, required } = body;
        
        if (!tenantId || !tagKey) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

        await pool.query(
            "INSERT INTO TaggingPolicies (tenant_id, tag_key, required) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE required = VALUES(required)",
            [tenantId, tagKey, required]
        );
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const body = await req.json();
        const { id } = body;
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        
        await pool.query("DELETE FROM TaggingPolicies WHERE id = ?", [id]);
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
