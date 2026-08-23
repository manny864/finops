/**
 * Cálculo de Simulación de Facturación en Tiempo Real (Partner Billing Engine).
 *
 * GET / POST:
 *   - Recibe: globalMarkupPercentage, fixedManagementFeeUSD, baseCost (opcional, default: 10,000.00).
 *   - Calcula con Decimal.js (Regla Cero de precisión).
 *   - Retorna: baseCost, markupAmount, fixedFeeAmount, totalBilledCost.
 */
import { NextRequest, NextResponse } from 'next/server';
import { simulateBilling, SIMULATION_BASE_COST } from '@/services/tenantPartnerMarkup.service';
import { isValidFixedFee, isValidMarkupPercentage } from '@/types/tenantPartnerMarkup.types';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const markupRaw = searchParams.get('globalMarkupPercentage') ?? searchParams.get('markupPercentage') ?? '0';
    const feeRaw = searchParams.get('fixedManagementFeeUSD') ?? searchParams.get('managementFee') ?? '0';
    const baseRaw = searchParams.get('baseCost') ?? String(SIMULATION_BASE_COST);

    const markup = Number(markupRaw);
    const fee = Number(feeRaw);
    const base = Number(baseRaw);

    const validMarkup = isValidMarkupPercentage(markup) ? markup : 0;
    const validFee = isValidFixedFee(fee) ? fee : 0;
    const validBase = Number.isFinite(base) && base >= 0 ? base : SIMULATION_BASE_COST;

    const simulation = simulateBilling(validMarkup, validFee, validBase);

    return NextResponse.json({
        success: true,
        ...simulation,
    });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const { globalMarkupPercentage, fixedManagementFeeUSD, baseCost } = body as {
        globalMarkupPercentage?: number;
        fixedManagementFeeUSD?: number;
        baseCost?: number;
    };

    const markup = typeof globalMarkupPercentage === 'number' ? globalMarkupPercentage : 0;
    const fee = typeof fixedManagementFeeUSD === 'number' ? fixedManagementFeeUSD : 0;
    const base = typeof baseCost === 'number' && baseCost >= 0 ? baseCost : SIMULATION_BASE_COST;

    const validMarkup = isValidMarkupPercentage(markup) ? markup : 0;
    const validFee = isValidFixedFee(fee) ? fee : 0;

    const simulation = simulateBilling(validMarkup, validFee, base);

    return NextResponse.json({
        success: true,
        ...simulation,
    });
}
