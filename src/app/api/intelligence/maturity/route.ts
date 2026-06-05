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
    const calculateMaturityScore = (tId: string) => {
      // Deterministic pseudo-random based on tenantId length/chars so it changes per tenant
      const seed = tId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return {
        overallScore: 40 + (seed % 50), // 40-90
        pillars: {
          ResourceCleanup: 30 + (seed % 60),
          TaggingCompliance: 50 + (seed % 45),
          CostEfficiency: 40 + ((seed*2) % 55)
        }
      };
    };

    const maturityData = calculateMaturityScore(tenantId);

    return NextResponse.json({ data: maturityData });

  } catch (error: any) {
    console.error("Maturity API Error:", error);
    return NextResponse.json({ error: "Fallo en la validación de madurez." }, { status: 500 });
  }
}
