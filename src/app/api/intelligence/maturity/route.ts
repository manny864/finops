import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
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

    // Mock Scoring Aggregation Function
    const calculateMaturityScore = () => {
      // Logic to calculate based on actual audit data would go here
      // Returning mock data for now
      return {
        overallScore: 58,
        pillars: {
          ResourceCleanup: 45,
          TaggingCompliance: 62,
          CostEfficiency: 68
        }
      };
    };

    const maturityData = calculateMaturityScore();

    return NextResponse.json({ data: maturityData });

  } catch (error: any) {
    console.error("Maturity API Error:", error);
    return NextResponse.json({ error: "Fallo en la validación de madurez." }, { status: 500 });
  }
}
