import { NextRequest, NextResponse } from "next/server";
import db from "@/modules/storage/db";
import jwt from "jsonwebtoken";

// GET Historical data
export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token de autenticación" }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido" }, { status: 401 });
        }

        const tenantId = decoded.tid;

        // Query the DB
        const [rows] = await db.query(
            "SELECT DATE_FORMAT(scan_date, '%Y-%m-%d') as scan_date, total_wasted_usd, potential_savings_usd FROM SavingsHistory WHERE tenant_id = ? ORDER BY scan_date ASC",
            [tenantId]
        );

        let data = rows as any[];

        return NextResponse.json({ data });

    } catch (error) {
        console.error("History API Error:", error);
        return NextResponse.json({ error: "Fallo al obtener el historial" }, { status: 500 });
    }
}

// POST new record (Triggered by automated scanner)
export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token de autenticación" }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido" }, { status: 401 });
        }

        const tenantId = decoded.tid;
        const body = await request.json();
        
        if (body.total_wasted_usd === undefined || body.potential_savings_usd === undefined) {
            return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
        }

        const today = new Date().toISOString().split('T')[0];

        // Insert or update for the day
        await db.query(
            `INSERT INTO SavingsHistory (tenant_id, scan_date, total_wasted_usd, potential_savings_usd) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE total_wasted_usd = VALUES(total_wasted_usd), potential_savings_usd = VALUES(potential_savings_usd)`,
            [tenantId, today, body.total_wasted_usd, body.potential_savings_usd]
        );

        return NextResponse.json({ success: true, message: "Registro guardado exitosamente." });

    } catch (error) {
        console.error("History POST API Error:", error);
        return NextResponse.json({ error: "Fallo al guardar el registro histórico" }, { status: 500 });
    }
}
