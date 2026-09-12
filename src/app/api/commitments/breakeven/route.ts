import { NextRequest, NextResponse } from "next/server";
import { AzureCommitmentSimulatorService, type BreakevenInput } from "@/services/azureCommitmentSimulator.service";

export async function POST(request: NextRequest) {
    try {
        const body: BreakevenInput = await request.json().catch(() => ({ paygMonthly: 0 }));
        const result = AzureCommitmentSimulatorService.calculateBreakeven(body);
        return NextResponse.json({ success: true, data: result });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message || "Error al calcular breakeven" }, { status: 500 });
    }
}
