import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

const MOCK_PAYLOAD = {
    success: true,
    mock: true,
    commitments: [
        {
            id: 1,
            billingAccountId: "12345678",
            commitmentAmount: 5000000,
            consumedAmount: 2850000,
            remainingAmount: 2150000,
            burnRateMonthly: 475000,
            startDate: "2025-09-01",
            endDate: "2026-08-31",
            currency: "USD",
            progressPercent: 57,
            daysRemaining: 64,
            projectedConsumption: 5160000,
            status: "onTrack",
            monthlyTarget: 416666.67,
        },
    ],
    aggregates: {
        totalCommitment: 5000000,
        totalConsumed: 2850000,
        totalRemaining: 2150000,
        overallProgress: 57,
        overallStatus: "onTrack",
    },
};

function computeStatus(
    consumed: number,
    commitment: number,
    projected: number
): "onTrack" | "atRisk" | "overConsumption" {
    if (projected > commitment) return "overConsumption";
    // atRisk: projected < 90% of commitment (under-consumption risk)
    if (projected < commitment * 0.9) return "atRisk";
    return "onTrack";
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro: tenantId" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(MOCK_PAYLOAD);
        }

        try {
            const [tenants]: any = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ?", [tenantId]);
            if (!tenants || tenants.length === 0) {
                return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
            }
            const tier = String(tenants[0].tier || "");
            if (tier.toLowerCase() !== "enterprise" && !isSuperAdmin) {
                return NextResponse.json({ error: "Feature bloqueada. Requiere plan Enterprise." }, { status: 403 });
            }

            const [rows]: any = await pool.query(
                `SELECT
                    id,
                    billing_account_id AS billingAccountId,
                    billing_profile_id AS billingProfileId,
                    commitment_amount AS commitmentAmount,
                    consumed_amount AS consumedAmount,
                    remaining_amount AS remainingAmount,
                    burn_rate_monthly AS burnRateMonthly,
                    start_date AS startDate,
                    end_date AS endDate,
                    currency,
                    last_updated AS lastUpdated
                 FROM MACCCommitments
                 WHERE tenant_id = ?
                 ORDER BY start_date DESC`,
                [tenantId]
            );

            if (!rows || rows.length === 0) {
                return NextResponse.json({ success: true, mock: false, commitments: [], aggregates: null });
            }

            const today = new Date();

            const commitments = rows.map((r: any) => {
                const endDate = new Date(r.endDate);
                const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / 86400000));
                const commitmentAmount = Number(r.commitmentAmount);
                const consumedAmount = Number(r.consumedAmount);
                const burnRate = Number(r.burnRateMonthly);
                const progressPercent = commitmentAmount > 0 ? Math.round((consumedAmount / commitmentAmount) * 100) : 0;
                const projectedConsumption = consumedAmount + burnRate * (daysRemaining / 30);
                const remainingAmount = commitmentAmount - consumedAmount;
                const totalMonths = commitmentAmount > 0 ? commitmentAmount / burnRate : 0;
                const monthlyTarget = commitmentAmount / Math.max(1, totalMonths);
                const status = computeStatus(consumedAmount, commitmentAmount, projectedConsumption);

                return {
                    id: r.id,
                    billingAccountId: r.billingAccountId,
                    billingProfileId: r.billingProfileId,
                    commitmentAmount,
                    consumedAmount,
                    remainingAmount,
                    burnRateMonthly: burnRate,
                    startDate: String(r.startDate).substring(0, 10),
                    endDate: String(r.endDate).substring(0, 10),
                    currency: r.currency,
                    progressPercent,
                    daysRemaining,
                    projectedConsumption,
                    status,
                    monthlyTarget,
                };
            });

            const totalCommitment = commitments.reduce((s: number, c: any) => s + c.commitmentAmount, 0);
            const totalConsumed = commitments.reduce((s: number, c: any) => s + c.consumedAmount, 0);
            const totalRemaining = commitments.reduce((s: number, c: any) => s + c.remainingAmount, 0);
            const overallProgress = totalCommitment > 0 ? Math.round((totalConsumed / totalCommitment) * 100) : 0;
            const totalProjected = commitments.reduce((s: number, c: any) => s + c.projectedConsumption, 0);
            const overallStatus = computeStatus(totalConsumed, totalCommitment, totalProjected);

            return NextResponse.json({
                success: true,
                mock: false,
                commitments,
                aggregates: { totalCommitment, totalConsumed, totalRemaining, overallProgress, overallStatus },
            });
        } catch (dbErr: any) {
            console.error("MACC DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({
                success: false, mock: false,
                commitments: [],
                aggregates: { totalCommitment: 0, totalConsumed: 0, totalRemaining: 0, overallProgress: 0, overallStatus: "onTrack" },
                error: `Sin datos disponibles: ${dbErr?.message || "error"}`,
            });
        }
    } catch (error: any) {
        console.error("MACC API Error:", error);
        return NextResponse.json({ error: "Error al obtener MACC.", details: error.message }, { status: 500 });
    }
}
