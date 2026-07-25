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
        // "Load Balancer" a secas es el nombre del recurso en Azure. En AWS el
        // servicio es Elastic Load Balancing y lo que se factura es el ALB.
        { type: 'Application Load Balancer', count: scale(1), monthlyCost: round2(16.2 * scale(1)), detail: 'Sin targets sanos registrados en su target group', region: 'us-east-1' },
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
 * Lista de recursos ociosos individuales, con el mismo contrato que devuelve
 * `/api/cleanup/zombies` para un tenant AWS real.
 *
 * Se diferencia de `getAwsOrphanResources`, que es el agregado por tipo para
 * las tarjetas de resumen: la pantalla de limpieza necesita el detalle recurso
 * por recurso porque desde ahi se dispara la remediacion.
 */
export function getAwsZombieResources(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const scale = (n: number) => Math.max(1, Math.round(n * (multiplier / 3 + 0.7)));
    const accounts = getAwsDemoAccounts(tier);
    const acct = (i: number) => accounts[i % accounts.length].account_id;
    const out: Record<string, unknown>[] = [];

    const push = (
        i: number,
        resourceId: string,
        name: string,
        resourceType: string,
        region: string,
        monthlyCost: number,
        reason: string,
        extra: Record<string, unknown> = {}
    ) => {
        out.push({
            resourceId, name, resourceType,
            monthlyCost: round2(monthlyCost),
            id: resourceId, type: resourceType,
            resourceGroup: region,
            subscriptionId: acct(i),
            estimatedMonthlyCost: round2(monthlyCost),
            tags: extra.tags ?? { Environment: i % 2 === 0 ? 'prod' : 'dev' },
            isHygiene: reason === 'oldSnapshots' || reason === 'longStoppedInstances',
            reason,
            ...extra,
        });
    };

    const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'sa-east-1'];

    // Volumenes EBS desasociados: el clasico "cree la instancia, la borre, y el
    // disco quedo".
    for (let i = 0; i < scale(6); i++) {
        const sizeGB = [50, 100, 200, 500][i % 4];
        push(i, `vol-0${(i + 1).toString().padStart(3, '0')}a2b3c4d5e`, `data-${i + 1}`,
            'aws.ec2/volumes', regions[i % regions.length], sizeGB * 0.08, 'unattachedVolumes', { sizeGB, powerState: 'available' });
    }

    // IPs elasticas reservadas y sin asociar.
    for (let i = 0; i < scale(4); i++) {
        push(i, `eipalloc-0${(i + 1).toString().padStart(3, '0')}f6a7b8c`, `52.${20 + i}.100.${i + 4}`,
            'aws.ec2/elastic-ips', regions[i % regions.length], 3.65, 'unattachedPublicIps');
    }

    // Snapshots de mas de 90 dias.
    for (let i = 0; i < scale(9); i++) {
        const sizeGB = [30, 80, 120][i % 3];
        push(i, `snap-0${(i + 1).toString().padStart(3, '0')}c9d0e1f`, `backup-${i + 1}`,
            'aws.ec2/snapshots', regions[i % regions.length], sizeGB * 0.05, 'oldSnapshots', { sizeGB });
    }

    // Instancias apagadas: no pagan computo, pero si sus discos.
    for (let i = 0; i < scale(3); i++) {
        push(i, `i-0${(i + 1).toString().padStart(3, '0')}a1b2c3d4`, `worker-${i + 1}`,
            'aws.ec2/instances', regions[i % regions.length], 16 + i * 8, 'longStoppedInstances', { powerState: 'stopped' });
    }

    return out.sort((a, b) => (b.monthlyCost as number) - (a.monthlyCost as number));
}

/**
 * Cola de aprobaciones de remediación (`/api/remediation/workflow`).
 *
 * Sin este dataset el tenant de demo AWS caía al mock genérico, que lista IDs
 * `/subscriptions/.../providers/Microsoft.Compute/...` y rightsizing de VMs
 * `Standard_D8s_v5`: recursos de Azure dentro de una demo AWS. Acá los
 * identificadores son ARNs y las acciones, las que el motor puede ejecutar de
 * verdad contra EC2/S3.
 */
export function getAwsRemediationApprovals(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const accounts = getAwsDemoAccounts(tier);
    const acct = (i: number) => accounts[i % accounts.length].account_id;
    const h = 3600_000;
    const now = Date.now();
    const base = [
        {
            resource_id: `arn:aws:ec2:us-east-1:${acct(0)}:volume/vol-0001a2b3c4d5e`,
            resource_name: 'data-1 (gp3 512 GB en estado available)',
            action_type: 'DELETE_RESOURCE',
            estimated_savings: 40.96,
            status: 'Pending',
            requested_by: 'zombie-scanner@demo.local',
            requestedHoursAgo: 3,
        },
        {
            // Mismo ahorro que la primera recomendación de getAwsRightsizing:
            // la demo tiene que contar una sola historia entre pantallas.
            resource_id: `arn:aws:ec2:us-east-1:${acct(0)}:instance/i-0a1b2c3d4e5f60001`,
            resource_name: 'api-prod-01 (m5.2xlarge → m5.xlarge)',
            action_type: 'RIGHTSIZE_INSTANCE',
            estimated_savings: 138.24,
            status: 'Pending',
            requested_by: 'rightsizing-engine@demo.local',
            requestedHoursAgo: 9,
        },
        {
            resource_id: `arn:aws:ec2:eu-west-1:${acct(1)}:elastic-ip/eipalloc-0001f6a7b8c`,
            resource_name: '52.20.100.4 (Elastic IP sin asociar)',
            action_type: 'RELEASE_ELASTIC_IP',
            estimated_savings: 3.65,
            status: 'Approved',
            requested_by: 'zombie-scanner@demo.local',
            requestedHoursAgo: 48,
        },
        {
            // S3 no cambia de "tier" sino de storage class: el nombre de la
            // acción tiene que coincidir con la API que se invoca de verdad.
            resource_id: `arn:aws:s3:::finops-demo-logs-${acct(2)}`,
            resource_name: `finops-demo-logs-${acct(2)} (S3 Standard → Glacier Instant Retrieval)`,
            action_type: 'CHANGE_STORAGE_CLASS',
            estimated_savings: 65.00,
            status: 'Approved',
            requested_by: 'storage-efficiency@demo.local',
            requestedHoursAgo: 72,
        },
        {
            resource_id: `arn:aws:ec2:us-east-1:${acct(0)}:instance/i-0a1b2c3d4e5f60005`,
            resource_name: 'dev-jenkins (m5.large sin uso fuera de horario)',
            action_type: 'STOP_INSTANCE',
            estimated_savings: 69.12,
            status: 'Rejected',
            requested_by: 'smart-shutdown@demo.local',
            requestedHoursAgo: 96,
        },
    ];
    // Más cuentas conectadas, más hallazgos en cola: lo que escala es la
    // cantidad de solicitudes, no el ahorro por recurso (que es un precio de
    // lista y no depende del tamaño del cliente).
    const repeats = multiplier >= 50 ? 3 : multiplier >= 10 ? 2 : 1;
    return Array.from({ length: repeats }).flatMap((_, r) =>
        base.map((b, i) => {
            const requestedAt = new Date(now - (b.requestedHoursAgo + r * 6) * h);
            const resolved = b.status !== 'Pending';
            return {
                id: r * base.length + i + 1,
                resource_id: r === 0 ? b.resource_id : `${b.resource_id}-${r + 1}`,
                resource_name: r === 0 ? b.resource_name : `${b.resource_name.replace(' (', `-${r + 1} (`)}`,
                action_type: b.action_type,
                estimated_savings: round2(b.estimated_savings * (1 + r * 0.08)),
                status: b.status,
                requested_by: b.requested_by,
                requested_at: requestedAt.toISOString(),
                resolved_at: resolved ? new Date(requestedAt.getTime() + h).toISOString() : null,
                resolved_by: resolved ? 'admin@demo.local' : null,
            };
        })
    );
}

/**
 * Reglas de alerta de costo. El mock genérico habla de "Prod Subscription" y de
 * umbrales por suscripción: en AWS la unidad de facturación es la cuenta, y las
 * palancas que se vigilan son otras (cobertura de Savings Plans, egress, NAT).
 */
export function getAwsAlertRules(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const baseThreshold = awsMonthlyTotal(multiplier);
    const accounts = getAwsDemoAccounts(tier);
    const h = 3600_000;
    const now = Date.now();
    const usd = (n: number) => Math.round(n).toLocaleString('en-US');
    const rules = [
        { id: 'mock-aws-alert-1', ruleName: 'Budget Alert > 80%', ruleType: 'budget', thresholdValue: 80, thresholdUnit: 'percent', channel: 'email', channelTarget: 'finops@demo.local', enabled: true, lastTriggeredAt: new Date(now - 15 * 24 * h).toISOString(), triggerCount: 3 },
        { id: 'mock-aws-alert-2', ruleName: `Threshold $${usd(baseThreshold)} USD`, ruleType: 'threshold', thresholdValue: Math.round(baseThreshold), thresholdUnit: 'usd', channel: 'webhook', channelTarget: 'https://hooks.demo.local/finops', enabled: true, lastTriggeredAt: new Date(now - 3 * 24 * h).toISOString(), triggerCount: 1 },
        { id: 'mock-aws-alert-3', ruleName: 'Cost Anomaly Detection (25%)', ruleType: 'anomaly', thresholdValue: 25, thresholdUnit: 'percent', channel: 'teams', channelTarget: 'https://hooks.teams.example/webhook-finops', enabled: true, lastTriggeredAt: new Date(now - 10 * h).toISOString(), triggerCount: 7 },
        { id: 'mock-aws-alert-4', ruleName: 'Forecast Overrun > 110%', ruleType: 'forecast', thresholdValue: 110, thresholdUnit: 'percent', channel: 'slack', channelTarget: '#finops-alerts', enabled: false, lastTriggeredAt: null, triggerCount: 0 },
        // El alias de la cuenta, no un GUID: es como el equipo identifica de
        // verdad al pagador dentro de la organización.
        { id: 'mock-aws-alert-5', ruleName: `Cuenta ${accounts[0].alias} > $${usd(baseThreshold * 0.6)}`, ruleType: 'threshold', thresholdValue: Math.round(baseThreshold * 0.6), thresholdUnit: 'usd', channel: 'email', channelTarget: 'director@demo.local', enabled: true, lastTriggeredAt: new Date(now - 48 * h).toISOString(), triggerCount: 2 },
        { id: 'mock-aws-alert-6', ruleName: 'NAT Gateway data processing > $500', ruleType: 'threshold', thresholdValue: 500, thresholdUnit: 'usd', channel: 'servicenow', channelTarget: 'https://demo.service-now.com/api/finops/alert', enabled: true, lastTriggeredAt: new Date(now - 6 * h).toISOString(), triggerCount: 12 },
        { id: 'mock-aws-alert-7', ruleName: 'Data Transfer Out > 20 TB', ruleType: 'threshold', thresholdValue: Math.round(baseThreshold * 0.12), thresholdUnit: 'usd', channel: 'teams', channelTarget: 'https://hooks.teams.example/webhook-ops', enabled: true, lastTriggeredAt: null, triggerCount: 0 },
        { id: 'mock-aws-alert-8', ruleName: 'Savings Plans coverage < 60%', ruleType: 'threshold', thresholdValue: 60, thresholdUnit: 'percent', channel: 'servicenow', channelTarget: 'https://demo.service-now.com/api/finops/critical', enabled: true, lastTriggeredAt: new Date(now - 2 * h).toISOString(), triggerCount: 4 },
        { id: 'mock-aws-alert-9', ruleName: 'Amazon S3 storage growth > 15% MoM', ruleType: 'anomaly', thresholdValue: 15, thresholdUnit: 'percent', channel: 'teams', channelTarget: 'https://hooks.teams.example/webhook-exec', enabled: true, lastTriggeredAt: new Date(now - 30 * h).toISOString(), triggerCount: 19 },
        { id: 'mock-aws-alert-10', ruleName: 'Monthly Forecast Overrun > 105%', ruleType: 'forecast', thresholdValue: 105, thresholdUnit: 'percent', channel: 'email', channelTarget: 'cfo@demo.local', enabled: true, lastTriggeredAt: null, triggerCount: 0 },
    ];
    // Mismo escalonado que el mock genérico: cada tier destraba más reglas.
    const count = multiplier >= 50 ? 10 : multiplier >= 10 ? 7 : multiplier >= 3 ? 5 : 2;
    return rules.slice(0, count);
}

/**
 * Punto de entrada por ruta, espejo de `getMockDataForRoute` pero con datos
 * AWS. Devuelve `null` si la ruta no tiene equivalente AWS, para que el caller
 * caiga al mock genérico en vez de mostrar una pantalla vacía.
 */
/**
 * Reparto de costos por centro de costo para la demo AWS.
 *
 * El contrato lo fija `/api/intelligence/chargeback`: `aggregated` alimenta el
 * grafico de torta y `detailed` la tabla. En AWS `resourceGroup` transporta la
 * region y `chargeType` el nombre del servicio, porque AWS no tiene el
 * ChargeType de Azure ni el concepto de grupo de recursos.
 */
export function getAwsChargebackMock(tier: string) {
    const multiplier = awsMultiplierForTier(tier);
    const total = awsMonthlyTotal(multiplier);
    const shares = [
        { name: 'Engineering', share: 0.42 },
        { name: 'Data', share: 0.24 },
        { name: 'Marketing', share: 0.14 },
        { name: 'Security', share: 0.09 },
        { name: 'Sin asignar', share: 0.11 },
    ];
    const aggregated = shares.map(s => ({ name: s.name, value: round2(total * s.share) }));

    const regions = getAwsCostByRegion(tier);
    const services = getAwsCostByService(tier);
    const detailed: Array<{ cost: number; date: string; resourceGroup: string; chargeType: string; costCenter: string }> = [];
    const today = new Date();
    // 14 dias por centro de costo: suficiente para que la tabla pagine y el
    // total cierre contra el agregado sin generar miles de filas.
    for (let d = 13; d >= 0; d--) {
        const date = new Date(today);
        date.setDate(today.getDate() - d);
        const day = date.toISOString().slice(0, 10);
        shares.forEach((cc, i) => {
            const svc = services[(i + d) % services.length];
            const reg = regions[(i + d) % regions.length];
            detailed.push({
                cost: round2((total * cc.share) / 14),
                date: day,
                resourceGroup: reg.region,
                chargeType: svc.serviceName,
                costCenter: cc.name,
            });
        });
    }
    return { aggregated, detailed };
}

/**
 * Reglas de reparto de recursos compartidos en AWS.
 *
 * Los equivalentes de ExpressRoute y del cluster AKS compartido son Direct
 * Connect y un cluster EKS multi-equipo; se suma un NAT gateway porque en AWS
 * es un costo compartido tipico que ningun equipo reclama como propio.
 */
export function getAwsAllocationRulesMock() {
    return [
        { id: 'rule-1', resourceName: 'dxcon-corp-primary', targetCostCenter: 'Marketing', allocationPercentage: 35.0 },
        { id: 'rule-2', resourceName: 'dxcon-corp-primary', targetCostCenter: 'Engineering', allocationPercentage: 65.0 },
        { id: 'rule-3', resourceName: 'eks-shared-prod', targetCostCenter: 'MobileApp', allocationPercentage: 80.0 },
        { id: 'rule-4', resourceName: 'eks-shared-prod', targetCostCenter: 'WebPortal', allocationPercentage: 20.0 },
        { id: 'rule-5', resourceName: 'nat-0a1b2c3d4e5f6a7b8', targetCostCenter: 'Engineering', allocationPercentage: 50.0 },
        { id: 'rule-6', resourceName: 'nat-0a1b2c3d4e5f6a7b8', targetCostCenter: 'Data', allocationPercentage: 50.0 },
    ];
}

export function getAwsMockDataForRoute(route: string, tier: string): Record<string, unknown> | null {
    const multiplier = awsMultiplierForTier(tier);
    const total = awsMonthlyTotal(multiplier);
    const base = { success: true, mock: true, provider: 'AWS' as const, currency: 'USD' };

    switch (route) {
        case 'tags_compliance': {
            const cuenta = '123456789012';
            const rec = (arn: string, name: string, missing: string[], region: string) => ({
                resourceId: arn, id: arn, name,
                type: `aws.${arn.split(':')[2]}/${arn.split(':')[5].split('/')[0]}`,
                subscriptionId: cuenta, resourceGroup: region, location: region,
                reason: missing.length === 0 ? 'Cumple con las políticas' : `Faltan etiquetas obligatorias: ${missing.join(', ')}`,
                missingTags: missing, isCompliant: missing.length === 0,
            });
            const allResources = [
                rec(`arn:aws:ec2:us-east-1:${cuenta}:instance/i-0a1b2c3d`, 'web-01', [], 'us-east-1'),
                rec(`arn:aws:ec2:us-east-1:${cuenta}:instance/i-0e4f5a6b`, 'web-02', ['Owner'], 'us-east-1'),
                rec(`arn:aws:rds:eu-west-1:${cuenta}:db/pedidos-prod`, 'pedidos-prod', [], 'eu-west-1'),
                rec(`arn:aws:s3:::datos-historicos`, 'datos-historicos', ['Environment', 'CostCenter'], 'global'),
                rec(`arn:aws:ec2:us-west-2:${cuenta}:volume/vol-0c7d8e9f`, 'vol-datos-01', ['CostCenter'], 'us-west-2'),
            ];
            const cumplen = allResources.filter(r => r.isCompliant).length;
            return {
                success: true,
                provider: 'AWS',
                data: {
                    complianceScore: Math.round((cumplen / allResources.length) * 100),
                    allResources,
                    // AWS no tiene un contenedor equivalente al grupo de
                    // recursos: el bloque se oculta en vez de informar 100%.
                    rgComplianceScore: null,
                    resourceGroups: [],
                },
            };
        }
        case 'resources_search': {
            // Recursos AWS reales: ARNs, tipos de servicio y regiones. La
            // columna de grupo de recursos transporta la region, que es la
            // convencion del proyecto: AWS no tiene grupos de recursos.
            const cuenta = '123456789012';
            const owners = ['ana.rivas@demo.com', 'diego.paz@demo.com', 'lucia.mena@demo.com'];
            const regiones = ['us-east-1', 'eu-west-1', 'us-west-2', 'sa-east-1'];
            const tipos = [
                { svc: 'ec2', tipo: 'instance', pre: 'i-0' },
                { svc: 'ec2', tipo: 'volume', pre: 'vol-0' },
                { svc: 's3', tipo: 'bucket', pre: 'bkt-' },
                { svc: 'rds', tipo: 'db', pre: 'db-' },
                { svc: 'lambda', tipo: 'function', pre: 'fn-' },
            ];
            const totalCount = Math.round(69 * multiplier);
            const rows = Array.from({ length: 15 }, (_, i) => {
                const t = tipos[i % tipos.length];
                const region = regiones[i % regiones.length];
                const rid = `${t.pre}${(100 + i).toString(16)}a2b3c4d`;
                return {
                    id: `arn:aws:${t.svc}:${region}:${cuenta}:${t.tipo}/${rid}`,
                    name: rid,
                    type: `aws.${t.svc}/${t.tipo}`,
                    subscriptionId: cuenta,
                    subscriptionName: 'produccion',
                    resourceGroup: region,
                    tags: {
                        Owner: owners[i % owners.length],
                        CostCenter: `Application ${(i % 4) + 1}`,
                        Environment: i % 2 === 0 ? 'Production' : 'Staging',
                    },
                    // La Tagging API no expone fecha de creacion; se informa
                    // null igual que en produccion, no una fecha inventada.
                    createdTime: null,
                    periodCost: round2((total * 0.02) * (0.6 + 0.4 * Math.abs(Math.sin(i)))),
                };
            });
            return {
                ...base, page: 1, pageSize: 15, rows, total: totalCount,
                kpis: { costGroups: 4, subscriptions: 1, resourceGroups: regiones.length, resources: totalCount },
            };
        }
        case 'resources_inventory': {
            const byType = [
                { type: 'instance', count: Math.round(28 * multiplier) },
                { type: 'volume', count: Math.round(24 * multiplier) },
                { type: 'bucket', count: Math.round(18 * multiplier) },
                { type: 'network-interface', count: Math.round(16 * multiplier) },
                { type: 'db', count: Math.round(9 * multiplier) },
                { type: 'function', count: Math.round(6 * multiplier) },
            ];
            const totalRecursos = byType.reduce((acc, t) => acc + t.count, 0);
            return {
                ...base,
                byType,
                bySubscription: [{ subscriptionId: '123456789012', subscriptionName: 'produccion', count: totalRecursos }],
                kpis: {
                    costGroups: 4,
                    subscriptions: 1,
                    // En AWS la dimension equivalente al grupo de recursos es la
                    // region, y por eso el numero es chico: son regiones, no
                    // decenas de grupos.
                    resourceGroups: 4,
                    resources: totalRecursos,
                    owners: 3,
                },
            };
        }
        case 'resources_created_by': {
            const rows = [
                { userName: 'ana.rivas@demo.com', resources: Math.round(29 * multiplier), resourceGroups: 3, subscriptions: 1 },
                { userName: 'diego.paz@demo.com', resources: Math.round(32 * multiplier), resourceGroups: 2, subscriptions: 1 },
                { userName: 'lucia.mena@demo.com', resources: Math.round(4 * multiplier), resourceGroups: 1, subscriptions: 1 },
                { userName: 'terraform-ci', resources: Math.round(11 * multiplier), resourceGroups: 4, subscriptions: 1 },
            ];
            return {
                ...base, rows,
                kpis: {
                    createdBy: rows.length, costGroups: 4, subscriptions: 1,
                    resourceGroups: 4, resources: rows.reduce((acc, r) => acc + r.resources, 0),
                },
            };
        }
        case 'resources_costs_by_tag': {
            const tag = (key: string, values: Array<[string, number]>) => ({
                key,
                totalCost: round2(values.reduce((acc, [, c]) => acc + c, 0) * multiplier),
                values: values.map(([value, cost]) => ({ value, cost: round2(cost * multiplier) })),
            });
            const tags = [
                tag('Department', [['Marketing', 1417.8], ['Corporate', 1394.1], ['IT', 895.5], ['Finance', 738.1], ['Engineering', 622.9]]),
                tag('Environment', [['production', 3800.2], ['staging', 900.4], ['development', 314.2]]),
                tag('Application', [['checkout-api', 2100.0], ['data-pipeline', 1450.5], ['portal-web', 980.2]]),
                tag('CostCenter', [['Application 1', 2400.0], ['Application 2', 1600.0], ['Application 3', 900.0]]),
                tag('CreatedBy', [['terraform-ci', 3400.1], ['ana.rivas@demo.com', 850.0]]),
            ];
            return {
                ...base, tags,
                kpis: {
                    resources: Math.round(1926 * multiplier),
                    resourcesWithTags: Math.round(1065 * multiplier),
                    resourcesWithoutTags: Math.round(861 * multiplier),
                    tagNames: tags.length,
                    tagValues: tags.reduce((acc, t) => acc + t.values.length, 0),
                },
            };
        }
        case 'sustainability': {
            // Regiones AWS con la intensidad de carbono que declara carbonData.
            // `storageCount` es 0 a proposito y no por falta de datos: el rol de
            // onboarding no concede s3:ListAllMyBuckets, asi que la huella de
            // almacenamiento queda fuera del alcance en AWS. Mostrar un numero
            // inventado aca haria que la demo prometiera algo que el producto
            // no entrega.
            const escala = Math.max(1, Math.round(multiplier));
            const byRegion = [
                { region: 'us-east-1', resources: 8 * escala, intensity: 380, kgCO2e: round2(4200.5 * multiplier) },
                { region: 'eu-west-1', resources: 5 * escala, intensity: 160, kgCO2e: round2(1100.2 * multiplier) },
                { region: 'eu-north-1', resources: 3 * escala, intensity: 40, kgCO2e: round2(520.8 * multiplier) },
                { region: 'ap-southeast-1', resources: 4 * escala, intensity: 480, kgCO2e: round2(2680.0 * multiplier) },
                { region: 'sa-east-1', resources: 2 * escala, intensity: 100, kgCO2e: round2(640.3 * multiplier) },
            ];
            const footprint = round2(byRegion.reduce((acc, r) => acc + r.kgCO2e, 0));
            return {
                ...base,
                footprint,
                avoided: round2(340.2 * multiplier),
                vmCount: byRegion.reduce((acc, r) => acc + r.resources, 0),
                storageCount: 0,
                zombieCount: 3 * escala,
                byRegion,
                recommendations: [
                    { fromRegion: 'us-east-1', currentIntensity: 380, toRegion: 'ca-central-1', targetIntensity: 130, reductionPct: 65.8, projectedReductionKgCO2: round2(2763.9 * multiplier), impactedResources: 8 * escala },
                    { fromRegion: 'ap-southeast-1', currentIntensity: 480, toRegion: 'ap-northeast-1', targetIntensity: 480, reductionPct: 0, projectedReductionKgCO2: 0, impactedResources: 4 * escala },
                ].filter((r) => r.reductionPct > 0),
                equivalencies: {
                    carKm: Math.round(footprint * 4.6),
                    treesYear: Math.round(footprint / 21),
                    phoneCharges: Math.round(footprint * 121),
                },
            };
        }
        case 'rates': {
            // En AWS las recomendaciones de tarifa las calcula Cost Explorer
            // sobre el uso real, asi que la demo muestra tipos de instancia y
            // Savings Plans, no SKUs de maquina virtual ni reservas de Azure.
            // El descuento de cada termino sigue el orden de magnitud que
            // publica AWS: ~40% a 1 anio y ~60% a 3 anios sin pago adelantado.
            const familias = [
                { sku: 'm5.2xlarge', region: 'us-east-1', qty: 4, mensual: 0.22 },
                { sku: 'r6g.xlarge', region: 'us-east-1', qty: 3, mensual: 0.14 },
                { sku: 'c6i.4xlarge', region: 'us-west-2', qty: 2, mensual: 0.11 },
                { sku: 'm5.xlarge', region: 'eu-west-1', qty: 5, mensual: 0.09 },
                { sku: 't3.large', region: 'sa-east-1', qty: 6, mensual: 0.04 },
            ];
            const recommendations = familias.map((f) => {
                const monthlyCost = round2(total * f.mensual);
                const annualCost = round2(monthlyCost * 12);
                const savings1Y = round2(annualCost * 0.4);
                const savings3Y = round2(annualCost * 3 * 0.6);
                return {
                    resourceName: `${f.sku} ×${f.qty}`,
                    resourceType: 'EC2 Instance',
                    sku: f.sku,
                    region: f.region,
                    monthlyCost,
                    monthlyCostLicenseIncluded: monthlyCost,
                    annualCost,
                    annualCost1Y: round2(annualCost - savings1Y),
                    annualCost3Y: round2(annualCost - (savings3Y / 3)),
                    savings1Y,
                    savings3Y,
                };
            });
            // Los Savings Plans no se compran por unidad sino por compromiso en
            // USD/hora: por eso `recommendedQuantity` lleva el compromiso y no
            // una cantidad de instancias.
            const spOnDemand = round2(total * 0.45);
            const savingsPlans = [
                {
                    skuName: 'Compute Savings Plans',
                    resourceType: 'SavingsPlans',
                    recommendedQuantity: round2((spOnDemand * 0.66) / 730),
                    totalMonthlyPAYGCost: spOnDemand,
                    costWith1YReservation: round2(spOnDemand * 0.66),
                    netSavings1Y: round2(spOnDemand * 0.34 * 12),
                    costWith3YReservation: round2(spOnDemand * 0.5),
                    netSavings3Y: round2(spOnDemand * 0.5 * 36),
                },
                {
                    skuName: 'EC2 Instance Savings Plans',
                    resourceType: 'SavingsPlans',
                    recommendedQuantity: round2((total * 0.18 * 0.6) / 730),
                    totalMonthlyPAYGCost: round2(total * 0.18),
                    costWith1YReservation: round2(total * 0.18 * 0.6),
                    netSavings1Y: round2(total * 0.18 * 0.4 * 12),
                    costWith3YReservation: round2(total * 0.18 * 0.44),
                    netSavings3Y: round2(total * 0.18 * 0.56 * 36),
                },
            ];
            return { ...base, recommendations, reservations: savingsPlans };
        }
        case 'budgets': {
            // Los presupuestos de la demo se expresan sobre el gasto AWS del
            // tier, no sobre cifras fijas: un limite que no guarda relacion con
            // el consumo mostrado deja la barra siempre al 100% o siempre al 5%.
            const limite = round2(total * 1.15);
            return {
                ...base,
                data: [
                    { name: 'Presupuesto Cloud Q3', limit: limite, currentSpend: round2(total * 0.86), status: 'On Track' },
                    { name: 'Campana Marketing', limit: round2(total * 0.2), currentSpend: round2(total * 0.23), status: 'Exceeded' },
                ],
            };
        }

        case 'budgets_burn': {
            const cuentas = getAwsDemoAccounts(tier);
            // El presupuesto nativo cuelga de la cuenta: en AWS Budgets no hay
            // un scope jerarquico como el management group de Azure.
            const reparto = [
                { costCenter: 'IT & Ops', share: 0.38, uso: 0.80 },
                { costCenter: 'Marketing', share: 0.14, uso: 0.96 },
                { costCenter: 'R&D', share: 0.28, uso: 1.19 },
                { costCenter: 'HR', share: 0.06, uso: 0.60 },
            ];
            return {
                ...base,
                burnData: reparto.map((r, i) => ({
                    costCenter: r.costCenter,
                    subscriptionId: cuentas[i % cuentas.length].account_id,
                    budget: round2(total * r.share * 1.1),
                    actual: round2(total * r.share * 1.1 * r.uso),
                    estimated: false,
                })),
            };
        }

        case 'cost-projection': {
            // 400 dias para que el grafico de proyeccion tenga 13 meses de
            // historico. Se escala con el total AWS del tier y no con el de
            // Azure: si no, la demo AWS mostraria una proyeccion que no cierra
            // contra su propio dashboard.
            const dailyBase = total / 30.44;
            const DAYS = 400;
            const dailyHistory = Array.from({ length: DAYS }).map((_, i) => {
                const d = new Date(Date.now() - (DAYS - 1 - i) * 86400000);
                const dow = d.getUTCDay();
                const weekendFactor = (dow === 0 || dow === 6) ? 0.72 : 1;
                const trend = 0.85 + 0.3 * (i / (DAYS - 1));
                const noise = 0.95 + 0.1 * Math.abs(Math.sin(i * 1.3));
                return { date: d.toISOString().slice(0, 10), cost: round2(dailyBase * trend * weekendFactor * noise) };
            });
            const byMonth = new Map<string, number>();
            for (const { date, cost } of dailyHistory) {
                const m = date.slice(0, 7);
                byMonth.set(m, (byMonth.get(m) || 0) + cost);
            }
            const monthlyHistory = Array.from(byMonth.entries())
                .map(([month, cost]) => ({ month, cost: round2(cost) }))
                .sort((a, b) => a.month.localeCompare(b.month));
            return { ...base, dailyHistory, monthlyHistory };
        }

        case 'chargeback': {
            const cb = getAwsChargebackMock(tier);
            return { ...base, data: cb.aggregated, detailed: cb.detailed };
        }

        case 'allocation-rules':
            return { ...base, data: getAwsAllocationRulesMock() };

        case 'aws-accounts':
            return { ...base, accounts: getAwsDemoAccounts(tier) };

        case 'dashboard_summary': {
            const histogram = getAwsDailyHistogram(tier);
            // `dashboardData` alimenta la pagina de fugas financieras, que
            // agrupa por `type` los items con issueType 'cost'. Sin esto la
            // demo AWS mostraba la pagina vacia.
            const AWS_LEAK_TYPES: Record<string, string> = {
                'aws.ec2/volumes': 'EBS Volume',
                'aws.ec2/elastic-ips': 'Elastic IP',
                'aws.ec2/snapshots': 'EBS Snapshot',
                'aws.ec2/instances': 'EC2 (Stopped)',
            };
            const dashboardData = getAwsZombieResources(tier).map((r) => ({
                ...r,
                type: AWS_LEAK_TYPES[r.resourceType as string] ?? r.resourceType,
                issueType: 'cost',
                potentialSavings: r.monthlyCost,
            }));
            return {
                ...base,
                actualCost: round2(total),
                projectedCost: round2(total * 1.18),
                potentialSavings: round2(total * 0.22),
                accountsEvaluated: accountCountFor(multiplier),
                histogram,
                topServices: getAwsCostByService(tier).slice(0, 5),
                dashboardData,
                zombieCount: dashboardData.length,
            };
        }

        case 'anomalies': {
            const baseMean = round2(total / 30);
            const std = round2(baseMean * 0.15);
            const today = new Date();
            // Pseudo-aleatorio determinista: el grafico tiene que ser estable
            // entre renders, si no la demo "parpadea".
            const rand = (i: number) => {
                const x = Math.sin(i * 12.9898) * 43758.5453;
                return x - Math.floor(x);
            };
            const spikeDays = new Set([7, 22, 41, 55, 58]);
            const dailyCosts: Array<{ date: string; amount: number }> = [];
            for (let i = 59; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                const idx = 59 - i;
                let amount = baseMean + (rand(idx) - 0.5) * std * 1.4 + Math.sin(idx / 7) * std * 0.4;
                if (spikeDays.has(idx)) amount = baseMean + std * (4 + rand(idx + 100) * 2);
                dailyCosts.push({ date: d.toISOString().slice(0, 10), amount: Math.max(50, round2(amount)) });
            }
            const upperBound = baseMean + 3 * std;
            const spikes = dailyCosts.filter(d => d.amount > upperBound);
            const services = getAwsCostByService(tier).map(s => s.serviceName);
            const regions = getAwsCostByRegion(tier).map(r => r.region);
            const accounts = getAwsDemoAccounts(tier);
            // Unidades de facturacion reales de AWS: NAT gateway se cobra por
            // GB procesado, S3 por GB-mes, EC2 por hora de instancia.
            const metrics = ['GB-month', 'Instance Hours', 'NAT GB processed', 'Requests', 'Provisioned IOPS'];
            const STATUS_CYCLE = ['Open', 'Postponed', 'Dismissed', 'Completed', 'Completed', 'Open'] as const;
            const anomalies = spikes.map((sp, i) => {
                const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
                const detectedAt = new Date(`${sp.date}T06:00:00.000Z`);
                const primaryService = services[i % services.length];
                const secondaryService = services[(i + 2) % services.length];
                const totalDelta = Math.max(0, sp.amount - baseMean);
                const primaryPct = 55 + Math.round(rand(i + 300) * 20);
                return {
                    id: i + 1,
                    date: sp.date,
                    status,
                    service: primaryService,
                    // En AWS el equivalente de la suscripcion es la cuenta.
                    subscription_id: accounts[i % accounts.length].account_id,
                    amount: sp.amount,
                    expected_amount: baseMean,
                    z_score: (sp.amount - baseMean) / std,
                    metric: metrics[i % metrics.length],
                    severity: sp.amount > baseMean + 5 * std ? 'Critical' : 'High',
                    description: `Pico inusual detectado en ${primaryService} — desviación de +$${(sp.amount - baseMean).toFixed(0)} vs media móvil.`,
                    // El "resource group" en AWS es la region: es la dimension
                    // que el sync guarda en esa columna.
                    top_contributors: totalDelta > 0 ? [
                        {
                            resource_group: regions[i % regions.length],
                            service_name: primaryService,
                            cost: round2(baseMean * 0.3 + totalDelta * (primaryPct / 100)),
                            baseline_avg: round2(baseMean * 0.3),
                            delta: round2(totalDelta * (primaryPct / 100)),
                            delta_pct_of_total: primaryPct,
                        },
                        {
                            resource_group: regions[(i + 1) % regions.length],
                            service_name: secondaryService,
                            cost: round2(baseMean * 0.15 + totalDelta * ((100 - primaryPct) / 100)),
                            baseline_avg: round2(baseMean * 0.15),
                            delta: round2(totalDelta * ((100 - primaryPct) / 100)),
                            delta_pct_of_total: 100 - primaryPct,
                        },
                    ] : [],
                    detected_at: detectedAt.toISOString(),
                    resolved_at: status !== 'Open'
                        ? new Date(detectedAt.getTime() + (4 + rand(i + 200) * 36) * 3600_000).toISOString()
                        : null,
                };
            });
            return { ...base, mean: baseMean, stdDev: std, dailyCosts, anomalies };
        }

        case 'top_expenses': {
            const services = getAwsCostByService(tier);
            const regions = getAwsCostByRegion(tier);
            const accounts = getAwsDemoAccounts(tier);
            // El gasto se reparte entre las cuentas con pesos decrecientes para
            // que el ranking tenga forma realista y no sea plano.
            const weights = [0.42, 0.27, 0.16, 0.09, 0.06];
            return {
                ...base,
                // Sin CUR no hay tags en CostSnapshots, asi que el ranking por
                // centro de costo cae en "Untagged/Unknown": el mock lo refleja
                // en vez de simular una asignacion que el producto no entrega.
                topCostGroups: [{ name: 'Untagged/Unknown', cost: round2(total) }],
                topSubscriptions: accounts.slice(0, 3).map((a, i) => ({
                    name: `${a.alias} (${a.account_id})`,
                    cost: round2(total * (weights[i] ?? 0.05)),
                })),
                unattributedSubscriptionCost: 0,
                topResourceGroups: regions.slice(0, 3).map(r => ({ name: r.region, cost: round2(r.cost) })),
                topResources: services.slice(0, 3).map((s, i) => ({
                    name: `${s.serviceName} \u2014 ${regions[i % regions.length].region}`,
                    cost: round2(s.cost),
                })),
            };
        }

        case 'white_board': {
            // Refleja lo que la API sirve de verdad para un tenant AWS: los
            // bloques de costo salen de CostSnapshots, pero no hay inventario de
            // recursos (por eso `untagged` en cero) ni Advisor (recomendaciones
            // vacias, pendiente de la Fase 8). Inflar esos numeros haria que la
            // demo prometa algo que el producto todavia no entrega.
            const monthLabel = (offset: number) => {
                const d = new Date();
                d.setUTCMonth(d.getUTCMonth() - offset);
                return d.toISOString().slice(0, 7);
            };
            const annual = total * 12;
            const previous = round2(annual * 0.88);
            const services = getAwsCostByService(tier);
            const regions = getAwsCostByRegion(tier);
            return {
                ...base,
                costs: {
                    currentFYCost: round2(annual),
                    previousFYCost: previous,
                    costProjected: round2(annual * 1.12),
                    costChangePct: round2(((annual - previous) / previous) * 100),
                    top3Services: services.slice(0, 3).map(s => ({ name: s.serviceName, cost: round2(s.cost * 12) })),
                    last3MonthsTrend: [
                        { month: monthLabel(2), cost: round2(total * 0.9) },
                        { month: monthLabel(1), cost: round2(total * 1.05) },
                        { month: monthLabel(0), cost: round2(total * 1.1) },
                    ],
                },
                security: { pct: 53.4, withMfa: accountCountFor(multiplier), total: accountCountFor(multiplier) * 2 },
                vulnerabilities: { high: 0, medium: 0, low: 0 },
                governance: {
                    untagged: { count: 0, total: 0, countPct: 0, cost: 0, costPct: 0, trend: [] },
                    top3ComplianceWins: [],
                },
                top3ThreatCategories: [],
                // En AWS se rankea por costo, no por cantidad de recursos: es el
                // dato que existe (ver getAwsTop5Regions en la API).
                top5Locations: regions.slice(0, 5).map(r => ({ name: r.region, count: round2(r.cost) })),
                top5Inventory: services.slice(0, 5).map(s => ({ name: s.serviceName, count: round2(s.cost) })),
                recommendations: { open: 0, potentialCostSavings: 0, trend: [] },
                costAnomalyTrend: [
                    { month: monthLabel(2), count: 1 },
                    { month: monthLabel(1), count: 3 },
                    { month: monthLabel(0), count: 2 },
                ],
                top5CostGroups: {
                    totalCost: round2(annual * 0.7),
                    groups: regions.slice(0, 5).map(r => ({ name: r.region, cost: round2(r.cost * 12) })),
                },
            };
        }

        case 'captured_savings': {
            // Misma forma que el dataset de Azure: la pagina de Ahorro
            // Capturado es agnostica y grafica la serie de DailySnapshots.
            const monthLabel = (offset: number) => {
                const d = new Date();
                d.setUTCDate(1);
                d.setUTCMonth(d.getUTCMonth() - offset);
                return d.toISOString().slice(0, 10);
            };
            const history = Array.from({ length: 6 }).map((_, i) => {
                const potentialSavings = round2(total * 0.22 * (0.7 + i * 0.08));
                return {
                    date: monthLabel(5 - i),
                    totalWasted: round2(potentialSavings * 2.3),
                    potentialSavings,
                };
            });
            const latest = history[history.length - 1];
            const previous = history[history.length - 2];
            return {
                ...base,
                history,
                current: {
                    potentialSavings: latest.potentialSavings,
                    totalWasted: latest.totalWasted,
                    date: latest.date,
                },
                changePct: round2(((latest.potentialSavings - previous.potentialSavings) / previous.potentialSavings) * 100),
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

        case 'cleanup_zombies':
            return { ...base, data: getAwsZombieResources(tier) };

        case 'zombies':
        case 'orphans': {
            const orphans = getAwsOrphanResources(tier);
            return {
                ...base,
                resources: orphans,
                totalMonthlyWaste: round2(orphans.reduce((acc, o) => acc + o.monthlyCost, 0)),
            };
        }

        case 'approvals':
            return { ...base, data: getAwsRemediationApprovals(tier) };

        case 'alerts':
            return { ...base, rules: getAwsAlertRules(tier) };

        case 'cost-by-region':
            return { ...base, regions: getAwsCostByRegion(tier), total: round2(total) };

        default:
            return null;
    }
}
