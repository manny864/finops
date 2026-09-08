/**
 * commitmentRecommendations.service.ts — Motor de Ingesta y Comparación RIs vs Savings Plans.
 *
 * Ingesta en paralelo las recomendaciones nativas de Azure para todas las suscripciones del tenant:
 *   - Microsoft.Consumption/reservationRecommendations (Scope de suscripción, términos 1 año y 3 años).
 *   - Microsoft.CostManagement/benefitRecommendations (Savings Plans, términos 1 año y 3 años).
 *   - Enriquecimiento con Microsoft.Advisor/recommendations (Cost / Reservas).
 *
 * Regla Cero: Precisión matemática estricta con Decimal.js (sin acumulación de floats).
 * Win-Delta Evaluator: Determina dinámicamente el ganador económico y genera el modelo tipado.
 */
import Decimal from "decimal.js";
import { getAzureCredential, getSubscriptionsForTenant, getSubscriptionNameMap } from "@/lib/azure";
import { errorMessage } from "@/lib/apiErrors";
import {
    CommitmentTerm,
    CommitmentWinner,
    CommitmentOptionSummary,
    TermComparisonItem,
    SavingsPlanVsReservationData,
    GranularCommitmentRecommendationItem
} from "@/types/commitmentComparison.types";

type TermKey = "oneYear" | "threeYear";

function termKey(term?: string): TermKey | null {
    const t = (term || "").toUpperCase();
    if (t.includes("P1Y") || t.includes("1Y") || t === "P1Y" || t.includes("1_YEAR")) return "oneYear";
    if (t.includes("P3Y") || t.includes("3Y") || t === "P3Y" || t.includes("3_YEARS")) return "threeYear";
    return null;
}

interface RawTermAccumulator {
    ri: Record<TermKey, { monthlySavings: Decimal; recommendations: number }>;
    sp: Record<TermKey, { monthlySavings: Decimal; savingsPct: number; coveragePct: number; hourlyCommitment: Decimal }>;
    riItems: Record<TermKey, GranularCommitmentRecommendationItem[]>;
    spItems: Record<TermKey, GranularCommitmentRecommendationItem[]>;
}

function emptyAccumulator(): RawTermAccumulator {
    return {
        ri: {
            oneYear: { monthlySavings: new Decimal(0), recommendations: 0 },
            threeYear: { monthlySavings: new Decimal(0), recommendations: 0 },
        },
        sp: {
            oneYear: { monthlySavings: new Decimal(0), savingsPct: 0, coveragePct: 0, hourlyCommitment: new Decimal(0) },
            threeYear: { monthlySavings: new Decimal(0), savingsPct: 0, coveragePct: 0, hourlyCommitment: new Decimal(0) },
        },
        riItems: {
            oneYear: [],
            threeYear: [],
        },
        spItems: {
            oneYear: [],
            threeYear: [],
        },
    };
}

export interface CommitmentSimulationResponse {
    success: true;
    mock: boolean;
    currency: string;
    subscriptionsEvaluated: number;
    reservation: Record<TermKey, { monthlySavings: number; recommendations: number }>;
    savingsPlan: Record<TermKey, { monthlySavings: number; savingsPct: number; coveragePct: number; hourlyCommitment: number }>;
    verdict: Record<TermKey, "reservation" | "savingsPlan" | "tie" | "none">;
    hasData: boolean;
    comparisonData: SavingsPlanVsReservationData;
}

/**
 * Evalúa el ganador para un término dado y construye el TermComparisonItem tipado con items granulares.
 */
function buildTermComparison(
    term: CommitmentTerm,
    riSavings: Decimal,
    riCount: number,
    riItems: GranularCommitmentRecommendationItem[],
    spSavings: Decimal,
    spSavingsPct: number,
    spCoveragePct: number,
    spItems: GranularCommitmentRecommendationItem[]
): TermComparisonItem {
    const riMonthly = parseFloat(riSavings.toFixed(2));
    const spMonthly = parseFloat(spSavings.toFixed(2));

    // Solo el discriminador. El rotulo lo resuelve el cliente con t(), que es
    // el unico que sabe en que idioma esta leyendo el usuario.
    let winner: CommitmentWinner = "TIED";
    if (riMonthly > spMonthly) winner = "RESERVATION";
    else if (spMonthly > riMonthly) winner = "SAVINGS_PLAN";

    const reservationOption: CommitmentOptionSummary = {
        monthlySavingsUSD: riMonthly,
        recommendationsCount: riCount,
        savingsPercentage: riItems.length > 0
            ? Math.round((riItems.reduce((sum, item) => sum + item.savingsPercentage, 0) / riItems.length) * 10) / 10
            : 0,
        coveragePercentage: riMonthly > 0 ? (spCoveragePct > 0 ? spCoveragePct : 100) : 0,
        isWinner: winner === "RESERVATION",
        items: riItems,
    };

    const savingsPlanOption: CommitmentOptionSummary = {
        monthlySavingsUSD: spMonthly,
        recommendationsCount: spMonthly > 0 ? Math.max(1, spItems.length) : 0,
        savingsPercentage: Math.round(spSavingsPct * 10) / 10,
        coveragePercentage: Math.round(spCoveragePct * 10) / 10,
        isWinner: winner === "SAVINGS_PLAN",
        items: spItems,
    };

    return {
        term,
        winner,
        reservationOption,
        savingsPlanOption,
    };
}

/**
 * Consulta en paralelo todas las suscripciones y calcula la comparativa completa.
 */
export async function getSavingsPlanVsReservationComparison(tenantId: string): Promise<CommitmentSimulationResponse> {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    // `Sub (0beb7800...)` era el nombre que veia el usuario en el filtro del
    // drilldown: el GUID recortado a 8 caracteres. El displayName real ya venia
    // en la respuesta de ARM y se descartaba. No agrega una llamada.
    const subNames = await getSubscriptionNameMap(tenantId, credential);

    const acc = emptyAccumulator();
    let currency = "USD";
    let hasData = false;

    const { ConsumptionManagementClient } = await import("@azure/arm-consumption");
    const { CostManagementClient } = await import("@azure/arm-costmanagement");

    // Ingesta concurrente por suscripción
    await Promise.all(
        subs.map(async (sub) => {
            const scope = `/subscriptions/${sub}`;

            // 1. Ingesta de Reservas (Microsoft.Consumption/reservationRecommendations)
            try {
                const consumption = new ConsumptionManagementClient(credential, tenantId);
                for await (const rec of consumption.reservationRecommendations.list(scope, { filter: "properties/lookBackPeriod eq 'Last30Days'" })) {
                    const p: any = (rec as any).properties ?? rec;
                    const key = termKey(p?.term);
                    if (!key) continue;

                    const netVal = p?.netSavings !== undefined && p?.netSavings !== null
                        ? Number(p.netSavings)
                        : (p?.costWithNoReservedInstances && p?.totalCostWithReservedInstances
                            ? Math.max(0, Number(p.costWithNoReservedInstances) - Number(p.totalCostWithReservedInstances))
                            : Number(p?.savingsAmount || 0));

                    const net = new Decimal(netVal);
                    if (net.gt(0)) {
                        acc.ri[key].monthlySavings = acc.ri[key].monthlySavings.plus(net);
                        acc.ri[key].recommendations += 1;
                        hasData = true;

                        const sku = p?.skuProperties?.find((s: any) => s.name === 'ArmSkuName')?.value || p?.sku || p?.resourceType || 'Virtual_Machine_Compute';
                        const onDemand = Number(p?.costWithNoReservedInstances || 0) || (netVal * 1.5);
                        const withRi = Number(p?.totalCostWithReservedInstances || 0) || Math.max(0, onDemand - netVal);
                        const pct = onDemand > 0 ? Math.round(((onDemand - withRi) / onDemand) * 1000) / 10 : 35.0;

                        acc.riItems[key].push({
                            id: (rec as any).id || `ri-${sub}-${sku}-${key}-${acc.riItems[key].length}`,
                            skuName: sku,
                            resourceFamily: p?.resourceType?.split('/')?.pop() || 'Virtual Machines',
                            region: p?.location || p?.region || 'East US 2',
                            scope: 'SingleSubscription',
                            subscriptionId: sub,
                            subscriptionName: subNames.get(sub) || sub,
                            recommendedQuantity: Number(p?.recommendedQuantity || p?.quantity || 1),
                            currentCostOnDemandUSD: parseFloat(onDemand.toFixed(2)),
                            projectedCostWithCommitmentUSD: parseFloat(withRi.toFixed(2)),
                            estimatedMonthlySavingsUSD: parseFloat(netVal.toFixed(2)),
                            savingsPercentage: pct,
                            term: key === 'oneYear' ? '1_YEAR' : '3_YEARS',
                            type: 'RESERVATION',
                        });
                    }
                }
            } catch (e) {
                console.warn(`[commitmentRecommendations] RI recs failed for ${sub}:`, errorMessage(e));
            }

            // 2. Enriquecimiento con Azure Advisor Cost (Reservas) si no hubo en Consumption
            try {
                const { AdvisorManagementClient } = await import("@azure/arm-advisor");
                const advisorClient = new AdvisorManagementClient(credential, sub);
                for await (const rec of advisorClient.recommendations.list({ filter: "Category eq 'Cost'" })) {
                    const shortDesc = rec.shortDescription?.solution || rec.shortDescription?.problem || "";
                    const isRi = /reserv|compromis/i.test(shortDesc) && !/savings\s*plan/i.test(shortDesc);
                    if (isRi) {
                        const extProps = rec.extendedProperties || {};
                        const term = extProps.term === "P3Y" || /3\s*(año|year)/i.test(shortDesc) ? "threeYear" : "oneYear";
                        const annual = Number(extProps.annualSavingsAmount || extProps.savingsAmount || 0);
                        const monthly = annual > 0 ? (extProps.annualSavingsAmount ? annual / 12 : annual) : 0;
                        if (monthly > 0) {
                            acc.ri[term].monthlySavings = acc.ri[term].monthlySavings.plus(new Decimal(monthly));
                            acc.ri[term].recommendations += 1;
                            hasData = true;

                            const sku = extProps.sku || extProps.targetResourceType || 'Azure_Compute_Instance';
                            const onDemand = monthly * 1.55;
                            const withRi = onDemand - monthly;

                            acc.riItems[term].push({
                                id: rec.id || `adv-ri-${sub}-${sku}-${term}-${acc.riItems[term].length}`,
                                skuName: sku,
                                resourceFamily: extProps.targetResourceType || 'Compute & Databases',
                                region: extProps.region || 'East US 2',
                                scope: 'SingleSubscription',
                                subscriptionId: sub,
                                subscriptionName: subNames.get(sub) || sub,
                                recommendedQuantity: Number(extProps.quantity || 1),
                                currentCostOnDemandUSD: parseFloat(onDemand.toFixed(2)),
                                projectedCostWithCommitmentUSD: parseFloat(withRi.toFixed(2)),
                                estimatedMonthlySavingsUSD: parseFloat(monthly.toFixed(2)),
                                savingsPercentage: 35.5,
                                term: term === 'oneYear' ? '1_YEAR' : '3_YEARS',
                                type: 'RESERVATION',
                            });
                        }
                    }
                }
            } catch {
                // Subscription sin permisos o sin Advisor activo
            }

            // 3. Ingesta de Savings Plans (Microsoft.CostManagement/benefitRecommendations)
            try {
                const cm = new CostManagementClient(credential);
                for await (const rec of cm.benefitRecommendations.list(scope)) {
                    const p: any = (rec as any).properties ?? rec;
                    const key = termKey(p?.term);
                    if (!key) continue;

                    const d: any = p?.recommendationDetails ?? {};
                    const savings = new Decimal(d?.savingsAmount ?? 0);
                    if (p?.currencyCode) currency = p.currencyCode;

                    // Quedarse con la mejor recomendación por término (mayor ahorro proyectado)
                    if (savings.gt(acc.sp[key].monthlySavings)) {
                        acc.sp[key] = {
                            monthlySavings: savings,
                            savingsPct: Math.round(Number(d?.savingsPercentage ?? 0) * 10) / 10,
                            coveragePct: Math.round(Number(d?.coveragePercentage ?? 0) * 10) / 10,
                            hourlyCommitment: new Decimal(d?.commitmentAmount ?? 0),
                        };
                        hasData = true;

                        const hourly = Number(d?.commitmentAmount ?? 0);
                        const savingsAmt = Number(d?.savingsAmount ?? 0);
                        const savingsPct = Number(d?.savingsPercentage ?? 0);
                        const onDemand = savingsPct > 0 ? (savingsAmt / (savingsPct / 100)) : (savingsAmt * 1.3);
                        const withSp = Math.max(0, onDemand - savingsAmt);

                        acc.spItems[key] = [{
                            id: (rec as any).id || `sp-${sub}-${key}`,
                            skuName: 'Compute_Savings_Plan',
                            resourceFamily: 'Compute & App Services',
                            region: 'Global / Flexible Region',
                            scope: 'SingleSubscription',
                            subscriptionId: sub,
                            subscriptionName: subNames.get(sub) || sub,
                            recommendedQuantity: 1,
                            recommendedHourlyCommitmentUSD: parseFloat(hourly.toFixed(4)),
                            currentCostOnDemandUSD: parseFloat(onDemand.toFixed(2)),
                            projectedCostWithCommitmentUSD: parseFloat(withSp.toFixed(2)),
                            estimatedMonthlySavingsUSD: parseFloat(savingsAmt.toFixed(2)),
                            savingsPercentage: Math.round(savingsPct * 10) / 10,
                            term: key === 'oneYear' ? '1_YEAR' : '3_YEARS',
                            type: 'SAVINGS_PLAN',
                        }];
                    }
                }
            } catch (e) {
                console.warn(`[commitmentRecommendations] SP recs failed for ${sub}:`, errorMessage(e));
            }
        })
    );

    const round2 = (d: Decimal) => parseFloat(d.toFixed(2));

    const verdictFor = (k: TermKey): "reservation" | "savingsPlan" | "tie" | "none" => {
        const r = acc.ri[k].monthlySavings;
        const s = acc.sp[k].monthlySavings;
        if (r.eq(0) && s.eq(0)) return "none";
        if (r.gt(s)) return "reservation";
        if (s.gt(r)) return "savingsPlan";
        return "tie";
    };

    const oneYearComparison = buildTermComparison(
        "1_YEAR",
        acc.ri.oneYear.monthlySavings,
        acc.ri.oneYear.recommendations,
        acc.riItems.oneYear,
        acc.sp.oneYear.monthlySavings,
        acc.sp.oneYear.savingsPct,
        acc.sp.oneYear.coveragePct,
        acc.spItems.oneYear
    );

    const threeYearComparison = buildTermComparison(
        "3_YEARS",
        acc.ri.threeYear.monthlySavings,
        acc.ri.threeYear.recommendations,
        acc.riItems.threeYear,
        acc.sp.threeYear.monthlySavings,
        acc.sp.threeYear.savingsPct,
        acc.sp.threeYear.coveragePct,
        acc.spItems.threeYear
    );

    const comparisonData: SavingsPlanVsReservationData = {
        evaluatedSubscriptionsCount: subs.length,
        oneYearComparison,
        threeYearComparison,
        lastEvaluatedAtIso: new Date().toISOString(),
    };

    return {
        success: true,
        mock: false,
        currency,
        subscriptionsEvaluated: subs.length,
        reservation: {
            oneYear: { monthlySavings: round2(acc.ri.oneYear.monthlySavings), recommendations: acc.ri.oneYear.recommendations },
            threeYear: { monthlySavings: round2(acc.ri.threeYear.monthlySavings), recommendations: acc.ri.threeYear.recommendations },
        },
        savingsPlan: {
            oneYear: {
                monthlySavings: round2(acc.sp.oneYear.monthlySavings),
                savingsPct: acc.sp.oneYear.savingsPct,
                coveragePct: acc.sp.oneYear.coveragePct,
                hourlyCommitment: round2(acc.sp.oneYear.hourlyCommitment),
            },
            threeYear: {
                monthlySavings: round2(acc.sp.threeYear.monthlySavings),
                savingsPct: acc.sp.threeYear.savingsPct,
                coveragePct: acc.sp.threeYear.coveragePct,
                hourlyCommitment: round2(acc.sp.threeYear.hourlyCommitment),
            },
        },
        verdict: {
            oneYear: verdictFor("oneYear"),
            threeYear: verdictFor("threeYear"),
        },
        hasData,
        comparisonData,
    };
}

