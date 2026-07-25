/**
 * Datos de demo para tenants AWS.
 *
 * POR QUÉ UN MÓDULO APARTE Y NO UN FLAG EN mockData.ts
 * ---------------------------------------------------
 * Los mocks de Azure están llenos de identificadores que no existen en AWS:
 * `/subscriptions/<guid>/resourceGroups/...`, SKUs `Standard_D8s_v3`, resource
 * groups. Mostrarle eso a un prospecto de AWS destruye la credibilidad de la
 * demo en el primer vistazo — es el error que la demo justamente debe evitar.
 *
 * En AWS los equivalentes son otros y hay que respetarlos:
 *   - Cuenta de 12 dígitos en vez de suscripción (GUID).
 *   - Tags / Cost Categories en vez de Resource Groups (AWS no tiene RG).
 *   - Familias de instancia (`m5.xlarge`) en vez de SKUs de VM.
 *   - Savings Plans y Reserved Instances en vez de Azure Reservations.
 *   - Códigos de servicio tal como los devuelve Cost Explorer (`AmazonEC2`),
 *     que no son los nombres comerciales.
 *
 * ESCALA POR TIER
 * ---------------
 * Se usa el mismo `multiplier` que `mockData.ts` (1 / 3 / 10 / 50) para que un
 * tenant de demo AWS y uno de Azure del mismo tier muestren magnitudes
 * comparables. Si divergen, la demo sugiere que AWS "cuesta distinto" por un
 * artefacto de los datos falsos.
 *
 * DETERMINISMO
 * ------------
 * Nada usa `Math.random()`: una demo que cambia de números al refrescar parece
 * rota. Las series se derivan de la fecha y del índice.
 */

export type MockTier = 'essential' | 'pro' | 'business' | 'enterprise';

export function awsMultiplierForTier(tier: string): number {
    switch ((tier || '').toLowerCase()) {
        case 'pro':
        case 'professional': return 3;
        case 'business': return 10;
        case 'enterprise': return 50;
        default: return 1;
    }
}

function round2(n: number): number {
    return Number(n.toFixed(2));
}

/** Cuántas cuentas AWS ve cada tier. Enterprise es el único multi-cuenta serio. */
function accountCountFor(multiplier: number): number {
    if (multiplier >= 50) return 8;
    if (multiplier >= 10) return 4;
    if (multiplier >= 3) return 2;
    return 1;
}

/**
 * IDs de cuenta de 12 dígitos, estables y evidentemente ficticios. AWS no
 * reserva un rango para documentación (como sí hace con las IP de RFC 5737),
 * pero un patrón repetitivo deja claro que son de demo y evita el accidente de
 * mostrar el número de una cuenta real.
 */
const DEMO_ACCOUNT_IDS = [
    '111122223333', '444455556666', '777788889999', '123456789012',
    '210987654321', '112233445566', '665544332211', '998877665544',
];

const DEMO_ACCOUNT_ALIASES = [
    'prod-workloads', 'staging', 'data-platform', 'shared-services',
    'security-tooling', 'sandbox-dev', 'analytics', 'dr-secondary',
];

export function getAwsDemoAccounts(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const n = accountCountFor(multiplier);
    const now = Date.now();
    return Array.from({ length: n }).map((_, i) => ({
        id: `demo-aws-${i + 1}`,
        account_id: DEMO_ACCOUNT_IDS[i],
        alias: DEMO_ACCOUNT_ALIASES[i],
        role_arn: `arn:aws:iam::${DEMO_ACCOUNT_IDS[i]}:role/CSCloudFinOpsReadOnly`,
        // Sólo las primeras cuentas tienen CUR configurado: refleja el caso real,
        // donde el CUR se habilita progresivamente y no en todas a la vez.
        cur_bucket: i < 2 ? `finops-cur-${DEMO_ACCOUNT_IDS[i]}` : null,
        cur_prefix: i < 2 ? 'cur/daily' : null,
        cur_report_name: i < 2 ? 'finops-hourly-resource' : null,
        last_sync_at: new Date(now - (i + 1) * 3600_000).toISOString(),
        // Una cuenta en error a propósito: la demo debe mostrar cómo se ve un
        // problema, no sólo el camino feliz.
        sync_status: i === n - 1 && n > 2 ? 'ERROR' : 'OK',
        last_error_message: i === n - 1 && n > 2
            ? 'AccessDenied: el rol no tiene ce:GetCostAndUsage'
            : null,
        created_at: new Date(now - (30 + i * 5) * 86400_000).toISOString(),
    }));
}

/**
 * Reparto de gasto por servicio. Los códigos son los que devuelve Cost Explorer
 * en la dimensión SERVICE, no los nombres comerciales.
 */
const AWS_SERVICE_MIX: Array<{ code: string; label: string; share: number; category: string }> = [
    { code: 'AmazonEC2', label: 'Amazon Elastic Compute Cloud', share: 0.34, category: 'Compute' },
    { code: 'AmazonRDS', label: 'Amazon Relational Database Service', share: 0.14, category: 'Databases' },
    { code: 'AmazonS3', label: 'Amazon Simple Storage Service', share: 0.11, category: 'Storage' },
    { code: 'AWSELB', label: 'Elastic Load Balancing', share: 0.06, category: 'Networking' },
    { code: 'AmazonCloudFront', label: 'Amazon CloudFront', share: 0.06, category: 'Networking' },
    { code: 'AWSLambda', label: 'AWS Lambda', share: 0.05, category: 'Compute' },
    { code: 'AmazonEKS', label: 'Amazon Elastic Kubernetes Service', share: 0.05, category: 'Containers' },
    { code: 'AmazonDynamoDB', label: 'Amazon DynamoDB', share: 0.04, category: 'Databases' },
    { code: 'AWSDataTransfer', label: 'AWS Data Transfer', share: 0.04, category: 'Networking' },
    { code: 'AmazonCloudWatch', label: 'Amazon CloudWatch', share: 0.03, category: 'Management and Governance' },
    { code: 'AWSSecretsManager', label: 'AWS Secrets Manager', share: 0.02, category: 'Security' },
    { code: 'AmazonSageMaker', label: 'Amazon SageMaker', share: 0.02, category: 'AI and Machine Learning' },
    { code: 'AWSGlue', label: 'AWS Glue', share: 0.02, category: 'Analytics' },
    { code: 'AmazonRoute53', label: 'Amazon Route 53', share: 0.01, category: 'Networking' },
    { code: 'AWSKMS', label: 'AWS Key Management Service', share: 0.01, category: 'Security' },
];

const AWS_REGIONS = [
    { code: 'us-east-1', share: 0.46 },
    { code: 'us-west-2', share: 0.21 },
    { code: 'eu-west-1', share: 0.16 },
    { code: 'sa-east-1', share: 0.11 },
    { code: 'ap-southeast-1', share: 0.06 },
];

/** Gasto mensual base, alineado con `dashboard_summary` de mockData.ts. */
export function awsMonthlyTotal(multiplier: number): number {
    return 12500 * multiplier;
}

export function getAwsCostByService(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const total = awsMonthlyTotal(multiplier);
    return AWS_SERVICE_MIX.map((s) => ({
        serviceCode: s.code,
        serviceName: s.label,
        category: s.category,
        cost: round2(total * s.share),
        percent: Math.round(s.share * 100),
    }));
}

export function getAwsCostByRegion(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const total = awsMonthlyTotal(multiplier);
    return AWS_REGIONS.map((r) => ({
        region: r.code,
        cost: round2(total * r.share),
        percent: Math.round(r.share * 100),
    }));
}

/**
 * Serie diaria con estacionalidad semanal y tendencia suave, misma forma que la
 * de Azure para que los gráficos se comporten igual.
 */
export function getAwsDailyHistogram(tier: string, days = 400) {
    const multiplier = awsMultiplierForTier(tier);
    const dailyBase = awsMonthlyTotal(multiplier) / 30;
    return Array.from({ length: days }).map((_, i) => {
        const d = new Date(Date.now() - (days - 1 - i) * 86400_000);
        const dow = d.getUTCDay();
        const weekendFactor = (dow === 0 || dow === 6) ? 0.72 : 1;
        const trend = 0.82 + 0.36 * (i / (days - 1));
        const noise = 0.9 + 0.2 * Math.abs(Math.sin(i * 1.7));
        return {
            date: d.toISOString().slice(0, 10),
            cost: round2(dailyBase * trend * weekendFactor * noise),
        };
    });
}

/**
 * Recomendaciones de rightsizing con familias de instancia reales. Las
 * transiciones son las que un FinOps recomendaría de verdad: bajar un escalón
 * dentro de la familia, o migrar a Graviton (m5 → m6g), que es la palanca de
 * ahorro más citada en AWS.
 */
export function getAwsRightsizing(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const base = [
        { instanceId: 'i-0a1b2c3d4e5f60001', name: 'api-prod-01', current: 'm5.2xlarge', recommended: 'm5.xlarge', region: 'us-east-1', maxCpu: 11.4, savings: 138.24, reason: 'CPU máxima 11% en 14 días' },
        { instanceId: 'i-0a1b2c3d4e5f60002', name: 'worker-batch-03', current: 'c5.4xlarge', recommended: 'c6g.2xlarge', region: 'us-east-1', maxCpu: 34.8, savings: 291.60, reason: 'Migrable a Graviton: ~20% mejor precio/rendimiento' },
        { instanceId: 'i-0a1b2c3d4e5f60003', name: 'rds-report-node', current: 'r5.xlarge', recommended: 'r6g.large', region: 'us-west-2', maxCpu: 18.2, savings: 104.40, reason: 'Sobredimensionada en memoria y CPU' },
        { instanceId: 'i-0a1b2c3d4e5f60004', name: 'legacy-etl-01', current: 't2.large', recommended: 't3.large', region: 'eu-west-1', maxCpu: 42.0, savings: 21.90, reason: 'Generación anterior: t3 cuesta menos con igual capacidad' },
        { instanceId: 'i-0a1b2c3d4e5f60005', name: 'dev-jenkins', current: 'm5.large', recommended: 'STOP', region: 'us-east-1', maxCpu: 1.1, savings: 69.12, reason: 'Sin uso fuera de horario laboral: candidata a apagado programado' },
    ];
    // Los tiers altos ven más recomendaciones porque tienen más flota.
    const repeats = multiplier >= 50 ? 4 : multiplier >= 10 ? 2 : 1;
    return Array.from({ length: repeats }).flatMap((_, r) =>
        base.map((b, i) => ({
            ...b,
            instanceId: r === 0 ? b.instanceId : `${b.instanceId.slice(0, -1)}${r * 5 + i + 1}`,
            name: r === 0 ? b.name : `${b.name}-${r + 1}`,
            savings: round2(b.savings * (1 + r * 0.12)),
        }))
    );
}

/**
 * Recursos huérfanos: los cuatro clásicos de AWS que sangran dinero en silencio.
 * Las Elastic IP sin asociar y los NAT Gateway ociosos son los dos hallazgos más
 * frecuentes en una primera auditoría, por eso encabezan la lista.
 */
export function getAwsOrphanResources(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const scale = (n: number) => Math.max(1, Math.round(n * (multiplier / 3 + 0.7)));
    return [
        { type: 'Elastic IP', count: scale(4), monthlyCost: round2(3.6 * scale(4)), detail: 'Direcciones asignadas sin instancia asociada', region: 'us-east-1' },
        { type: 'EBS Volume', count: scale(6), monthlyCost: round2(8.0 * scale(6)), detail: 'Volúmenes en estado "available" (desasociados)', region: 'us-east-1' },
        { type: 'EBS Snapshot', count: scale(23), monthlyCost: round2(0.5 * scale(23)), detail: 'Snapshots de volúmenes ya eliminados', region: 'us-west-2' },
        { type: 'NAT Gateway', count: scale(2), monthlyCost: round2(32.4 * scale(2)), detail: 'Sin tráfico procesado en 30 días', region: 'eu-west-1' },
        { type: 'Load Balancer', count: scale(1), monthlyCost: round2(16.2 * scale(1)), detail: 'Sin targets sanos registrados', region: 'us-east-1' },
    ];
}

/**
 * Cobertura de compromisos. En AWS lo que se compara es Savings Plans (más
 * flexible, cubre EC2/Fargate/Lambda) contra Reserved Instances (más descuento
 * pero atado a familia y región).
 */
export function getAwsCommitmentSimulation(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const computeSpend = awsMonthlyTotal(multiplier) * 0.39;
    const spY1 = round2(computeSpend * 0.20);
    const spY3 = round2(computeSpend * 0.28);
    const riY1 = round2(computeSpend * 0.22);
    const riY3 = round2(computeSpend * 0.34);
    return {
        currency: 'USD',
        accountsEvaluated: accountCountFor(multiplier),
        onDemandSpend: round2(computeSpend),
        savingsPlan: {
            oneYear: { monthlySavings: spY1, savingsPct: 20, coveragePct: 64, hourlyCommitment: round2(computeSpend * 0.6 / 730) },
            threeYear: { monthlySavings: spY3, savingsPct: 28, coveragePct: 71, hourlyCommitment: round2(computeSpend * 0.68 / 730) },
        },
        reservedInstances: {
            oneYear: { monthlySavings: riY1, savingsPct: 22, coveragePct: 48 },
            threeYear: { monthlySavings: riY3, savingsPct: 34, coveragePct: 52 },
        },
        currentCoveragePct: multiplier >= 10 ? 41 : 12,
        // A 1 año gana Savings Plans por flexibilidad; a 3, RI por profundidad
        // de descuento — pero sólo si la flota es estable, que es la condición
        // que la UI debe explicar.
        verdict: { oneYear: 'savingsPlan', threeYear: 'reservedInstances' },
        hasData: true,
    };
}

/** Cost Categories / tags: el equivalente AWS de agrupar por Resource Group. */
export function getAwsCostGroups(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const total = awsMonthlyTotal(multiplier);
    const groups = [
        { name: 'Production', tagKey: 'Environment', tagValue: 'prod', share: 0.58 },
        { name: 'Staging', tagKey: 'Environment', tagValue: 'staging', share: 0.14 },
        { name: 'Data Platform', tagKey: 'CostCenter', tagValue: 'data', share: 0.12 },
        { name: 'Development', tagKey: 'Environment', tagValue: 'dev', share: 0.09 },
        { name: 'Sin etiquetar', tagKey: null, tagValue: null, share: 0.07 },
    ];
    return groups.map((g) => ({
        ...g,
        cost: round2(total * g.share),
        percent: Math.round(g.share * 100),
    }));
}

/**
 * Punto de entrada por ruta, espejo de `getMockDataForRoute` pero con datos
 * AWS. Devuelve `null` si la ruta no tiene equivalente AWS, para que el caller
 * caiga al mock genérico en vez de mostrar una pantalla vacía.
 */
export function getAwsMockDataForRoute(route: string, tier: string): Record<string, unknown> | null {
    const multiplier = awsMultiplierForTier(tier);
    const total = awsMonthlyTotal(multiplier);
    const base = { success: true, mock: true, provider: 'AWS' as const, currency: 'USD' };

    switch (route) {
        case 'aws-accounts':
            return { ...base, accounts: getAwsDemoAccounts(tier) };

        case 'dashboard_summary': {
            const histogram = getAwsDailyHistogram(tier);
            return {
                ...base,
                actualCost: round2(total),
                projectedCost: round2(total * 1.18),
                potentialSavings: round2(total * 0.22),
                accountsEvaluated: accountCountFor(multiplier),
                histogram,
                topServices: getAwsCostByService(tier).slice(0, 5),
            };
        }

        case 'cost-by-category': {
            // Se agregan los servicios AWS en las mismas categorías FinOps que
            // usa la vista de Azure, para que el gráfico sea comparable.
            const byCategory = new Map<string, number>();
            for (const s of getAwsCostByService(tier)) {
                byCategory.set(s.category, (byCategory.get(s.category) || 0) + s.cost);
            }
            const categories = Array.from(byCategory.entries())
                .map(([category, cost]) => ({
                    category,
                    cost: round2(cost),
                    percent: Math.round((cost / total) * 100),
                }))
                .sort((a, b) => b.cost - a.cost);
            return {
                ...base,
                categories,
                total: round2(total),
                topCategory: categories[0]?.category ?? 'Compute',
                diagnostics: { requestedDays: 30, effectiveDays: 30, rowsFound: categories.length },
            };
        }

        case 'cost_groups':
        case 'cost-groups':
            return { ...base, groups: getAwsCostGroups(tier), total: round2(total) };

        case 'commitment-simulator':
        case 'simulator':
            return { ...base, ...getAwsCommitmentSimulation(tier) };

        case 'rightsizing':
            return { ...base, recommendations: getAwsRightsizing(tier) };

        case 'zombies':
        case 'orphans': {
            const orphans = getAwsOrphanResources(tier);
            return {
                ...base,
                resources: orphans,
                totalMonthlyWaste: round2(orphans.reduce((acc, o) => acc + o.monthlyCost, 0)),
            };
        }

        case 'cost-by-region':
            return { ...base, regions: getAwsCostByRegion(tier), total: round2(total) };

        default:
            return null;
    }
}
