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
      const seed = tId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const VisibilityAndAllocation = 40 + (seed % 60);
      const UsageOptimization = 30 + (seed % 70);
      const RateOptimization = 20 + ((seed*2) % 80);
      const ForecastingAndBudgeting = 50 + (seed % 50);
      const GovernanceAndAutomation = 45 + ((seed*3) % 55);
      
      const overallScore = Math.floor((VisibilityAndAllocation + UsageOptimization + RateOptimization + ForecastingAndBudgeting + GovernanceAndAutomation) / 5);

      return {
        overallScore,
        pillars: {
          VisibilityAndAllocation,
          UsageOptimization,
          RateOptimization,
          ForecastingAndBudgeting,
          GovernanceAndAutomation
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
