import { NextRequest, NextResponse } from 'next/server';
import { getAssessment } from '@/modules/core/aiProvider';
import jwt from 'jsonwebtoken';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, metrics } = body;

        if (!tenantId || !metrics) {
            return NextResponse.json({ error: "Faltan parámetros (tenantId, metrics)" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "Acceso denegado. El token no coincide con el tenant." }, { status: 403 });
        }

        const markdownReport = await getAssessment(metrics);

        return NextResponse.json({ success: true, report: markdownReport });

    } catch (error: any) {
        console.error("Error in /api/intelligence/assessment:", error);
        return NextResponse.json({ error: "Error procesando el assessment", details: error.message }, { status: 500 });
    }
}
