/**
 * Optimización de tarifas en AWS: Reserved Instances y Savings Plans.
 *
 * Es el equivalente de `calculateReservationSavings` + `getReservationRecommendations`
 * del lado Azure, pero por un camino distinto a propósito.
 *
 * **Por qué no se replica el cálculo de Azure.** En Azure la recomendación se
 * arma en casa: se lista el inventario con Resource Graph, se consulta el
 * precio de lista en la Retail Prices API y se compara pago por uso contra
 * reserva. En AWS ese camino sería a la vez más caro y menos exacto:
 *
 * - El equivalente de la Retail Prices API es la Price List API, cuyo índice de
 *   EC2 por región pesa cientos de MB y no distingue el descuento que la cuenta
 *   ya tenga negociado (EDP, Private Pricing).
 * - Cost Explorer **ya calcula la recomendación** sobre el uso real de los
 *   últimos 30/60 días, contemplando las reservas y Savings Plans vigentes.
 *   Recomendar sobre el inventario actual sin descontar la cobertura existente
 *   llevaría a sobre-comprar: es el error clásico de las herramientas caseras.
 *
 * Así que acá se leen las recomendaciones nativas y sólo se normalizan al
 * contrato que la página ya consume.
 *
 * **Cómo se mapea al contrato compartido:**
 *
 * - `recommendations[]` (pestaña de recursos) ← recomendaciones de **Reserved
 *   Instances**, que AWS entrega por tipo de instancia y región.
 * - `reservations[]` (pestaña agregada) ← recomendaciones de **Savings Plans**,
 *   que se expresan como un compromiso en USD/hora y no por SKU.
 *
 * **Costo de la consulta.** Cost Explorer cobra por request (USD 0.01), y acá
 * se hacen hasta 4 por cuenta —1 y 3 años, RI y Savings Plans—. Por eso la ruta
 * cachea agresivamente: la recomendación se calcula sobre una ventana de 30
 * días, así que no cambia de forma significativa dentro del mismo día.
 *
 * **Regla Cero.** Los importes llegan como string en el JSON de AWS y se
 * manipulan con `Decimal`. Nunca `parseFloat` sobre un monto.
 *
 * Permisos IAM mínimos: `ce:GetReservationPurchaseRecommendation` y
 * `ce:GetSavingsPlansPurchaseRecommendation`. Ambos de sólo lectura.
 */
import {
    CostExplorerClient,
    GetReservationPurchaseRecommendationCommand,
    GetSavingsPlansPurchaseRecommendationCommand,
    type ReservationPurchaseRecommendation,
    type SavingsPlansPurchaseRecommendation,
} from '@aws-sdk/client-cost-explorer';
import Decimal from 'decimal.js';
import { assumeRole, decryptExternalId, type AwsTempCredentials } from '@/lib/aws/sts';
import pool from '@/modules/storage/db';

/** Cost Explorer es global y sólo responde en us-east-1. */
const CE_ENDPOINT_REGION = 'us-east-1';

/** Meses por año, para anualizar los importes mensuales que devuelve AWS. */
const MONTHS_PER_YEAR = 12;

/** Servicio de EC2 tal como lo nombra Cost Explorer en este endpoint. */
const EC2_SERVICE = 'Amazon Elastic Compute Cloud - Compute';

/** Una fila de la pestaña de recursos. Mismo contrato que el lado Azure. */
export interface AwsRateRecommendation {
    resourceName: string;
    resourceType: string;
    sku: string;
    region: string;
    monthlyCost: number;
    /**
     * En Azure es el costo con licencia incluida (Hybrid Benefit). AWS no tiene
     * un equivalente, así que replica `monthlyCost` en vez de inventar un
     * recargo que no existe.
     */
    monthlyCostLicenseIncluded: number;
    annualCost: number;
    annualCost1Y: number;
    annualCost3Y: number;
    savings1Y: number;
    savings3Y: number;
}

/** Una fila de la pestaña agregada. Mismo contrato que el lado Azure. */
export interface AwsRateOpportunity {
    skuName: string;
    resourceType: string;
    recommendedQuantity: number;
    totalMonthlyPAYGCost: number;
    costWith1YReservation: number;
    netSavings1Y: number;
    costWith3YReservation: number;
    netSavings3Y: number;
}

interface AwsAccountRow {
    account_id: string;
    role_arn: string;
    external_id_encrypted: string;
}

/** Convierte un monto de AWS (string) a Decimal sin perder precisión. */
function amount(raw: string | number | undefined | null): Decimal {
    if (raw === undefined || raw === null || raw === '') return new Decimal(0);
    try {
        return new Decimal(raw);
    } catch {
        return new Decimal(0);
    }
}

async function getAwsAccounts(tenantId: string, accountId?: string | null): Promise<AwsAccountRow[]> {
    const all = !accountId || accountId === 'all' || accountId === 'All';
    const [rows] = await pool.query(
        `SELECT account_id, role_arn, external_id_encrypted
           FROM AwsAccounts
          WHERE tenant_id = ?${all ? '' : ' AND account_id = ?'}`,
        all ? [tenantId] : [tenantId, accountId]
    );
    return (Array.isArray(rows) ? rows : []) as AwsAccountRow[];
}

function ceFor(creds: AwsTempCredentials): CostExplorerClient {
    return new CostExplorerClient({
        region: CE_ENDPOINT_REGION,
        credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
        },
    });
}

/**
 * Clave de una línea de RI: el mismo tipo de instancia en dos regiones son dos
 * recomendaciones distintas, y unirlas sumaría manzanas con naranjas.
 */
function riKey(instanceType: string, region: string): string {
    return `${instanceType}|${region}`;
}

/**
 * Normaliza las recomendaciones de RI de un término.
 *
 * AWS devuelve el ahorro y el costo on-demand **mensuales**; la anualización se
 * hace acá para respetar el contrato de la página, que razona en años.
 */
export function mapRiRecommendations(
    recs: ReservationPurchaseRecommendation[] | undefined
): Map<string, { instanceType: string; region: string; quantity: number; monthlyOnDemand: Decimal; monthlySavings: Decimal }> {
    const out = new Map<string, { instanceType: string; region: string; quantity: number; monthlyOnDemand: Decimal; monthlySavings: Decimal }>();

    for (const rec of recs ?? []) {
        for (const detail of rec.RecommendationDetails ?? []) {
            const ec2 = detail.InstanceDetails?.EC2InstanceDetails;
            const instanceType = ec2?.InstanceType;
            const region = ec2?.Region;
            if (!instanceType || !region) continue;

            const key = riKey(instanceType, region);
            const prev = out.get(key);
            const quantity = Number(detail.RecommendedNumberOfInstancesToPurchase ?? 0) || 0;
            const monthlyOnDemand = amount(detail.EstimatedMonthlyOnDemandCost);
            const monthlySavings = amount(detail.EstimatedMonthlySavingsAmount);

            if (prev) {
                prev.quantity += quantity;
                prev.monthlyOnDemand = prev.monthlyOnDemand.plus(monthlyOnDemand);
                prev.monthlySavings = prev.monthlySavings.plus(monthlySavings);
            } else {
                out.set(key, { instanceType, region, quantity, monthlyOnDemand, monthlySavings });
            }
        }
    }

    return out;
}

/**
 * Une las recomendaciones de 1 y 3 años en las filas que espera la página.
 *
 * Una instancia puede aparecer en un término y no en el otro: AWS deja de
 * recomendar el término largo cuando el uso no es lo bastante estable. En ese
 * caso el ahorro del término ausente queda en 0, que es la lectura correcta —no
 * hay recomendación—, y no se extrapola desde el otro término.
 */
export function buildRiRows(
    oneYear: ReturnType<typeof mapRiRecommendations>,
    threeYear: ReturnType<typeof mapRiRecommendations>
): AwsRateRecommendation[] {
    const keys = new Set([...oneYear.keys(), ...threeYear.keys()]);
    const rows: AwsRateRecommendation[] = [];

    for (const key of keys) {
        const y1 = oneYear.get(key);
        const y3 = threeYear.get(key);
        const base = y1 ?? y3;
        if (!base) continue;

        // El costo on-demand es el mismo uso mirado desde dos términos; se toma
        // el del término de 1 año por ser el que AWS recomienda más seguido.
        const monthlyOnDemand = (y1 ?? y3)!.monthlyOnDemand;
        const annualCost = monthlyOnDemand.times(MONTHS_PER_YEAR);

        const savings1Y = y1 ? y1.monthlySavings.times(MONTHS_PER_YEAR) : new Decimal(0);
        const savings3Y = y3 ? y3.monthlySavings.times(MONTHS_PER_YEAR).times(3) : new Decimal(0);

        const annualCost1Y = y1 ? annualCost.minus(savings1Y) : new Decimal(0);
        const annualCost3Y = y3 ? annualCost.minus(y3.monthlySavings.times(MONTHS_PER_YEAR)) : new Decimal(0);

        const quantity = Math.max(y1?.quantity ?? 0, y3?.quantity ?? 0);

        rows.push({
            resourceName: quantity > 1 ? `${base.instanceType} ×${quantity}` : base.instanceType,
            resourceType: 'EC2 Instance',
            sku: base.instanceType,
            region: base.region,
            monthlyCost: monthlyOnDemand.toNumber(),
            monthlyCostLicenseIncluded: monthlyOnDemand.toNumber(),
            annualCost: annualCost.toNumber(),
            annualCost1Y: annualCost1Y.toNumber(),
            annualCost3Y: annualCost3Y.toNumber(),
            savings1Y: savings1Y.toNumber(),
            savings3Y: savings3Y.toNumber(),
        });
    }

    return rows.sort((a, b) => Math.max(b.savings1Y, b.savings3Y) - Math.max(a.savings1Y, a.savings3Y));
}

/**
 * Normaliza una recomendación de Savings Plans.
 *
 * Un Savings Plan no se compra "por unidad" como una reserva: es un compromiso
 * en USD/hora. Se expone `recommendedQuantity` como el compromiso horario
 * redondeado a dos decimales para que la columna de cantidad diga algo útil en
 * vez de un 1 constante, y el tipo aclara que se mide en USD/hora.
 */
export function mapSavingsPlan(
    rec: SavingsPlansPurchaseRecommendation | undefined,
    term: '1Y' | '3Y'
): AwsRateOpportunity | null {
    const summary = rec?.SavingsPlansPurchaseRecommendationSummary;
    if (!summary) return null;

    const hourlyCommitment = amount(summary.HourlyCommitmentToPurchase);
    const monthlySavings = amount(summary.EstimatedMonthlySavingsAmount);
    const monthlyOnDemand = amount(summary.CurrentOnDemandSpend);

    // Sin compromiso ni ahorro no hay nada que recomendar; devolver una fila en
    // cero solo ensuciaria la tabla.
    if (hourlyCommitment.isZero() && monthlySavings.isZero()) return null;

    const monthlyCommitment = monthlyOnDemand.minus(monthlySavings);

    return {
        skuName: rec?.SavingsPlansType === 'EC2_INSTANCE_SP'
            ? 'EC2 Instance Savings Plans'
            : rec?.SavingsPlansType === 'SAGEMAKER_SP'
                ? 'SageMaker Savings Plans'
                : 'Compute Savings Plans',
        resourceType: 'SavingsPlans',
        recommendedQuantity: hourlyCommitment.toDecimalPlaces(2).toNumber(),
        totalMonthlyPAYGCost: monthlyOnDemand.toNumber(),
        costWith1YReservation: term === '1Y' ? monthlyCommitment.toNumber() : 0,
        netSavings1Y: term === '1Y' ? monthlySavings.times(MONTHS_PER_YEAR).toNumber() : 0,
        costWith3YReservation: term === '3Y' ? monthlyCommitment.toNumber() : 0,
        netSavings3Y: term === '3Y' ? monthlySavings.times(MONTHS_PER_YEAR).times(3).toNumber() : 0,
    };
}

/** Une las filas de Savings Plans de ambos términos en una sola por tipo. */
export function mergeSavingsPlanRows(rows: (AwsRateOpportunity | null)[]): AwsRateOpportunity[] {
    const byType = new Map<string, AwsRateOpportunity>();

    for (const row of rows) {
        if (!row) continue;
        const prev = byType.get(row.skuName);
        if (!prev) {
            byType.set(row.skuName, { ...row });
            continue;
        }
        prev.recommendedQuantity = Math.max(prev.recommendedQuantity, row.recommendedQuantity);
        prev.totalMonthlyPAYGCost = Math.max(prev.totalMonthlyPAYGCost, row.totalMonthlyPAYGCost);
        prev.costWith1YReservation = prev.costWith1YReservation || row.costWith1YReservation;
        prev.netSavings1Y = prev.netSavings1Y || row.netSavings1Y;
        prev.costWith3YReservation = prev.costWith3YReservation || row.costWith3YReservation;
        prev.netSavings3Y = prev.netSavings3Y || row.netSavings3Y;
    }

    return [...byType.values()].sort((a, b) => Math.max(b.netSavings1Y, b.netSavings3Y) - Math.max(a.netSavings1Y, a.netSavings3Y));
}

/**
 * Recomendaciones de tarifa de todas las cuentas AWS del tenant.
 *
 * @param accountId Limita a una cuenta; `null`/'all' recorre todas.
 */
export async function getAwsRateRecommendations(
    tenantId: string,
    accountId?: string | null
): Promise<{ recommendations: AwsRateRecommendation[]; reservations: AwsRateOpportunity[] }> {
    const accounts = await getAwsAccounts(tenantId, accountId);
    if (accounts.length === 0) return { recommendations: [], reservations: [] };

    const perAccount = await Promise.all(accounts.map(async (account) => {
        let creds: AwsTempCredentials;
        try {
            creds = await assumeRole(
                account.role_arn,
                decryptExternalId(account.external_id_encrypted),
                `FinOps-${tenantId.slice(0, 8)}`
            );
        } catch (e) {
            // Un rol revocado en una cuenta no puede dejar sin recomendaciones
            // a las demas cuentas del tenant.
            console.warn(`[AwsRates] AssumeRole fallo en ${account.account_id}:`, (e as Error).message);
            return { recommendations: [] as AwsRateRecommendation[], reservations: [] as AwsRateOpportunity[] };
        }

        const client = ceFor(creds);

        const riFor = async (term: 'ONE_YEAR' | 'THREE_YEARS') => {
            try {
                const res = await client.send(new GetReservationPurchaseRecommendationCommand({
                    Service: EC2_SERVICE,
                    AccountId: account.account_id,
                    LookbackPeriodInDays: 'THIRTY_DAYS',
                    TermInYears: term,
                    // Sin pago adelantado: es la unica opcion cuyo ahorro se
                    // puede comparar mes a mes contra el pago por uso sin
                    // amortizar un desembolso inicial.
                    PaymentOption: 'NO_UPFRONT',
                }));
                return mapRiRecommendations(res.Recommendations);
            } catch (e) {
                console.warn(`[AwsRates] RI ${term} fallo en ${account.account_id}:`, (e as Error).message);
                return mapRiRecommendations(undefined);
            }
        };

        const spFor = async (term: 'ONE_YEAR' | 'THREE_YEARS') => {
            try {
                const res = await client.send(new GetSavingsPlansPurchaseRecommendationCommand({
                    SavingsPlansType: 'COMPUTE_SP',
                    TermInYears: term,
                    PaymentOption: 'NO_UPFRONT',
                    LookbackPeriodInDays: 'THIRTY_DAYS',
                }));
                return mapSavingsPlan(res.SavingsPlansPurchaseRecommendation, term === 'ONE_YEAR' ? '1Y' : '3Y');
            } catch (e) {
                console.warn(`[AwsRates] SavingsPlans ${term} fallo en ${account.account_id}:`, (e as Error).message);
                return null;
            }
        };

        const [ri1, ri3, sp1, sp3] = await Promise.all([
            riFor('ONE_YEAR'),
            riFor('THREE_YEARS'),
            spFor('ONE_YEAR'),
            spFor('THREE_YEARS'),
        ]);

        return {
            recommendations: buildRiRows(ri1, ri3),
            reservations: mergeSavingsPlanRows([sp1, sp3]),
        };
    }));

    return {
        recommendations: perAccount.flatMap((a) => a.recommendations)
            .sort((a, b) => Math.max(b.savings1Y, b.savings3Y) - Math.max(a.savings1Y, a.savings3Y)),
        reservations: mergeSavingsPlanRows(perAccount.flatMap((a) => a.reservations)),
    };
}
