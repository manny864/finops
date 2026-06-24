import { NextRequest, NextResponse } from "next/server";
import { findExpiredResources } from "@/services/ttlService";
import jwt from "jsonwebtoken";


export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }



        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }
        
        const email = decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") ;

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        const expiredResources = await findExpiredResources(tenantId);
        
        return NextResponse.json({ expiredResources });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
