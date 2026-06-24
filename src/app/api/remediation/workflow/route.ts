import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import jwt from "jsonwebtoken";

// Ayudante de Autenticación
async function authenticateRequest(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Missing Bearer token");
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;
    if (!decoded || !decoded.tid) {
        throw new Error("Invalid token structure");
    }
    return {
        tenantId: decoded.tid,
        email: decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "unknown@user.com"
    };
}

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const user = await authenticateRequest(request);
        const tenantId = request.nextUrl.searchParams.get('tenantId') || user.tenantId;

        const [rows] = await pool.query(
            `SELECT * FROM RemediationRequests 
             WHERE tenant_id = ? 
             ORDER BY requested_at DESC`,
            [tenantId]
        );

        return NextResponse.json({ success: true, data: rows });
    } catch (error: any) {
        console.error("GET RemediationRequests Error:", error);
        return NextResponse.json({ error: error.message }, { status: 401 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        const user = await authenticateRequest(request);
        const body = await request.json();
        
        const { tenantId, resourceId, resourceName, actionType, estimatedSavings } = body;
        if (!tenantId || !resourceId || !resourceName || !actionType) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Validate tenant security
        if (tenantId !== user.tenantId && !user.email.endsWith("@cscloudsolutions.com.ar")) {
            return NextResponse.json({ error: "Cross-tenant action not allowed" }, { status: 403 });
        }

        const [result] = await pool.query(
            `INSERT INTO RemediationRequests 
             (tenant_id, resource_id, resource_name, action_type, estimated_savings, requested_by) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [tenantId, resourceId, resourceName, actionType, estimatedSavings || 0, user.email]
        );

        return NextResponse.json({ success: true, insertedId: (result as any).insertId });
    } catch (error: any) {
        console.error("POST RemediationRequests Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        await initializeDatabase();
        const user = await authenticateRequest(request);
        const body = await request.json();
        
        const { id, status, tenantId } = body;
        if (!id || !status || !['Approved', 'Rejected'].includes(status)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        if (tenantId !== user.tenantId && !user.email.endsWith("@cscloudsolutions.com.ar")) {
            return NextResponse.json({ error: "Cross-tenant action not allowed" }, { status: 403 });
        }

        const [result] = await pool.query(
            `UPDATE RemediationRequests 
             SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ? 
             WHERE id = ? AND tenant_id = ? AND status = 'Pending'`,
            [status, user.email, id, tenantId]
        );

        if ((result as any).affectedRows === 0) {
            return NextResponse.json({ error: "Request not found or already resolved" }, { status: 404 });
        }

        // TODO (Fase 3): Si status === 'Approved', llamar a ARM SDK para efectuar la acción real.
        // Por ahora, simplemente se marca como resuelto en la BD para cumplir con el WorkFlow.

        return NextResponse.json({ success: true, message: `Request ${status}` });
    } catch (error: any) {
        console.error("PATCH RemediationRequests Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
