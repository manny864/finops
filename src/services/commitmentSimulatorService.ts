/**
 * commitmentSimulatorService — Simulación "Savings Plan vs Reservation".
 *
 * Cruza las dos recomendaciones nativas de Azure (números oficiales de Microsoft,
 * no una heurística nuestra):
 *   - Reservas (RI): Consumption ReservationRecommendations (por SKU/región).
 *   - Savings Plan (SP): Cost Management BenefitRecommendations (commitment horario).
 *
 * Ambas requieren scope de SUSCRIPCIÓN (no management group) y rol
 * 'Cost Management Reader' — ya incluido en el tier Essential del onboarding.
 * Se agrega por term (1 y 3 años) a través de todas las suscripciones del tenant.
 *
 * Precisión: montos con decimal.js (Regla Cero) — nunca floats acumulados.
 */
import Decimal from "decimal.js";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";

type TermKey = "oneYear" | "threeYear";

function termKey(term?: string): TermKey | null {
    const t = (term || "").toUpperCase();
    if (t.includes("P1Y") || t.includes("1Y") || t === "P1Y") return "oneYear";
    if (t.includes("P3Y") || t.includes("3Y") || t === "P3Y") return "threeYear";
    return null;
}

export interface CommitmentSimulation {
    success: true;
    mock: false;
    currency: string;
    subscriptionsEvaluated: number;
    reservation: Record<TermKey, { monthlySavings: number; recommendations: number }>;
    savingsPlan: Record<TermKey, { monthlySavings: number; savingsPct: number; coveragePct: number; hourlyCommitment: number }>;
    verdict: Record<TermKey, "reservation" | "savingsPlan" | "tie" | "none">;
    hasData: boolean;
}

const emptyRi = () => ({ oneYear: { monthlySavings: new Decimal(0), recommendations: 0 }, threeYear: { monthlySavings: new Decimal(0), recommendations: 0 } });

export async function getCommitmentSimulation(tenantId: string): Promise<CommitmentSimulation> {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);

    const ri = emptyRi();
    // Para SP nos quedamos con la mejor recomendación (mayor ahorro) por term.
    const sp: Record<TermKey, { monthlySavings: Decimal; savingsPct: number; coveragePct: number; hourlyCommitment: Decimal }> = {
        oneYear: { monthlySavings: new Decimal(0), savingsPct: 0, coveragePct: 0, hourlyCommitment: new Decimal(0) },
        threeYear: { monthlySavings: new Decimal(0), savingsPct: 0, coveragePct: 0, hourlyCommitment: new Decimal(0) },
    };
    let currency = "USD";
    let hasData = false;

    const { ConsumptionManagementClient } = await import("@azure/arm-consumption");
    const { CostManagementClient } = await import("@azure/arm-costmanagement");

    for (const sub of subs) {
        const scope = `/subscriptions/${sub}`;

        // --- Reservas (RI) ---
        try {
            const consumption = new ConsumptionManagementClient(credential, tenantId);
            for await (const rec of consumption.reservationRecommendations.list(`${scope}/`)) {
                const p: any = (rec as any).properties ?? rec;
                const key = termKey(p?.term);
                if (!key) continue;
                // netSavings del RI es el ahorro sobre la ventana de lookback (~30d) → mensual.
                const net = new Decimal(p?.netSavings ?? 0);
                if (net.gt(0)) {
                    ri[key].monthlySavings = ri[key].monthlySavings.plus(net);
                    ri[key].recommendations += 1;
                    hasData = true;
                }
            }
        } catch (e: any) {
            console.warn(`[commitmentSimulator] RI recs failed for ${sub}:`, e?.message);
        }

        // --- Savings Plan (SP) ---
        try {
            const cm = new CostManagementClient(credential);
            for await (const rec of cm.benefitRecommendations.list(scope)) {
                const p: any = (rec as any).properties ?? rec;
                const key = termKey(p?.term);
                if (!key) continue;
                const d: any = p?.recommendationDetails ?? {};
                const savings = new Decimal(d?.savingsAmount ?? 0);
                if (p?.currencyCode) currency = p.currencyCode;
                // Quedarse con la mejor recomendación por term (mayor ahorro).
                if (savings.gt(sp[key].monthlySavings)) {
                    sp[key] = {
                        monthlySavings: savings,
                        savingsPct: Number(d?.savingsPercentage ?? 0),
                        coveragePct: Number(d?.coveragePercentage ?? 0),
                        hourlyCommitment: new Decimal(d?.commitmentAmount ?? 0),
                    };
                    hasData = true;
                }
            }
        } catch (e: any) {
            console.warn(`[commitmentSimulator] SP recs failed for ${sub}:`, e?.message);
        }
    }

    const round2 = (d: Decimal) => parseFloat(d.toFixed(2));
    const verdictFor = (k: TermKey): "reservation" | "savingsPlan" | "tie" | "none" => {
        const r = ri[k].monthlySavings, s = sp[k].monthlySavings;
        if (r.eq(0) && s.eq(0)) return "none";
        if (r.gt(s)) return "reservation";
        if (s.gt(r)) return "savingsPlan";
        return "tie";
    };

    return {
        success: true,
        mock: false,
        currency,
        subscriptionsEvaluated: subs.length,
        reservation: {
            oneYear: { monthlySavings: round2(ri.oneYear.monthlySavings), recommendations: ri.oneYear.recommendations },
            threeYear: { monthlySavings: round2(ri.threeYear.monthlySavings), recommendations: ri.threeYear.recommendations },
        },
        savingsPlan: {
            oneYear: { monthlySavings: round2(sp.oneYear.monthlySavings), savingsPct: sp.oneYear.savingsPct, coveragePct: sp.oneYear.coveragePct, hourlyCommitment: round2(sp.oneYear.hourlyCommitment) },
            threeYear: { monthlySavings: round2(sp.threeYear.monthlySavings), savingsPct: sp.threeYear.savingsPct, coveragePct: sp.threeYear.coveragePct, hourlyCommitment: round2(sp.threeYear.hourlyCommitment) },
        },
        verdict: { oneYear: verdictFor("oneYear"), threeYear: verdictFor("threeYear") },
        hasData,
    };
}
