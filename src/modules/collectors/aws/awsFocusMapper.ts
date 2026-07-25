/**
 * AWS CUR to FOCUS Schema Mapper
 * Standardizes AWS Cost and Usage Report (CUR) billing lines and Cost Explorer
 * grouped rows to the FinOps Open Cost & Usage Specification (FOCUS) shape we
 * persist in CostSnapshots.
 */

import type { CeDailyRow } from '@/lib/aws/costExplorer';

export interface AwsCurLineItem {
    "lineItem/UsageAccountId": string;
    "lineItem/ProductCode": string;
    "lineItem/UsageStartDate": string;
    "lineItem/UsageEndDate": string;
    "lineItem/BlendedCost": string;
    "lineItem/UnblendedCost": string;
    "lineItem/LineItemType"?: string;        // Usage | Tax | Credit | DiscountedUsage | SavingsPlanCoveredUsage | SavingsPlanNegation | RIFee | Refund
    "lineItem/CurrencyCode"?: string;
    "lineItem/UsageType"?: string;
    "lineItem/Operation"?: string;
    "lineItem/UsageAmount"?: string;
    "lineItem/ResourceId"?: string;
    "product/ProductName"?: string;
    "product/region"?: string;
    "product/instanceType"?: string;
    "pricing/term"?: string;
    "pricing/unit"?: string;
    "reservation/EffectiveCost"?: string;
    "reservation/AmortizedUpfrontCostForUsage"?: string;
    "savingsPlan/SavingsPlanEffectiveCost"?: string;
    "savingsPlan/AmortizedUpfrontCommitmentForBillingPeriod"?: string;
    "discount/TotalDiscount"?: string;
    "bill/BillingPeriodStartDate"?: string;
    "bill/BillingPeriodEndDate"?: string;
    "bill/InvoiceId"?: string;
    [key: string]: string | undefined;       // tag columns: resourceTags/user:*
}

export interface FocusLineItem {
    ProviderName: string;
    PublisherName: string;
    BillingAccountId: string;                // payer/master account
    SubAccountId: string;                    // linked/usage account
    ServiceName: string;
    ServiceCategory?: string;
    Region?: string;
    ResourceId?: string;
    ResourceType?: string;
    ChargePeriodStart: Date;
    ChargePeriodEnd: Date;
    BillingPeriodStart?: Date;
    BillingPeriodEnd?: Date;
    BilledCost: number;                      // lo que aparece en la factura del periodo
    EffectiveCost: number;                   // con descuento de compromiso aplicado
    AmortizedCost: number;                   // upfront de RI/SP prorrateado en el termino
    UsageQuantity?: number;
    UsageUnit?: string;
    PricingCategory?: string;                // On-Demand | Reserved | Spot | Savings Plan | Free Tier
    ChargeCategory?: string;                 // Usage | Tax | Credit | Adjustment | Fee
    BillingCurrency?: string;
    InvoiceIssuerName?: string;
    Tags: Record<string, string>;
}

/**
 * Map an AWS Service code (e.g. "AmazonEC2") to a FOCUS ServiceCategory.
 * Best-effort; defaults to "Other".
 */
export function awsServiceToCategory(serviceCode: string): string {
    const code = (serviceCode || '').toLowerCase();
    if (code.includes('ec2') || code.includes('compute') || code.includes('lambda') || code.includes('fargate') || code.includes('lightsail') || code.includes('batch')) return 'Compute';
    if (code.includes('s3') || code.includes('ebs') || code.includes('efs') || code.includes('glacier') || code.includes('storage') || code.includes('backup')) return 'Storage';
    if (code.includes('rds') || code.includes('dynamodb') || code.includes('aurora') || code.includes('database') || code.includes('redshift') || code.includes('documentdb') || code.includes('neptune') || code.includes('memorydb') || code.includes('elasticache')) return 'Databases';
    if (code.includes('cloudfront') || code.includes('route53') || code.includes('vpc') || code.includes('directconnect') || code.includes('transitgateway') || code.includes('apigateway')) return 'Networking';
    if (code.includes('iam') || code.includes('kms') || code.includes('cognito') || code.includes('waf') || code.includes('shield') || code.includes('guardduty') || code.includes('securityhub') || code.includes('inspector')) return 'Security';
    if (code.includes('sagemaker') || code.includes('comprehend') || code.includes('rekognition') || code.includes('polly') || code.includes('translate') || code.includes('lex') || code.includes('bedrock')) return 'AI & Machine Learning';
    if (code.includes('cloudwatch') || code.includes('xray') || code.includes('cloudtrail') || code.includes('config')) return 'Management & Governance';
    if (code.includes('sns') || code.includes('sqs') || code.includes('mq') || code.includes('eventbridge') || code.includes('kinesis')) return 'Integration';
    if (code.includes('connect') || code.includes('chime') || code.includes('workspaces')) return 'End User Computing';
    return 'Other';
}

/**
 * Map Cost Explorer GetCostAndUsage daily row to FOCUS.
 * billingAccountId is the payer account (the one whose role we assumed).
 */
export function mapCeDailyToFocus(row: CeDailyRow, billingAccountId: string): FocusLineItem {
    const start = new Date(`${row.date}T00:00:00Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return {
        ProviderName: 'AWS',
        PublisherName: 'Amazon Web Services',
        BillingAccountId: billingAccountId,
        SubAccountId: billingAccountId,            // CE doesn't split by linked account in this query
        ServiceName: row.serviceCode,
        ServiceCategory: awsServiceToCategory(row.serviceCode),
        Region: row.region === 'NoRegion' ? undefined : row.region,
        ChargePeriodStart: start,
        ChargePeriodEnd: end,
        BilledCost: row.unblendedCost,
        EffectiveCost: row.amortizedCost || row.unblendedCost,
        // CE ya devuelve la metrica AmortizedCost directamente (a diferencia
        // del CUR, donde hay que sumar las columnas de upfront prorrateado).
        AmortizedCost: row.amortizedCost || row.unblendedCost,
        UsageQuantity: row.usageQuantity,
        PricingCategory: 'On-Demand',              // CE aggregates; CUR has the real breakdown
        ChargeCategory: 'Usage',
        BillingCurrency: 'USD',
        Tags: {},
    };
}

/**
 * Map a full AWS CUR line item (CUR 2.0 or legacy 1.0) to FOCUS.
 */
export function mapCurRowToFocus(row: AwsCurLineItem, payerAccountId: string): FocusLineItem {
    const blended = parseFloat(row["lineItem/BlendedCost"] || '0');
    const unblended = parseFloat(row["lineItem/UnblendedCost"] || '0');
    const reservationEffective = parseFloat(row["reservation/EffectiveCost"] || '0');
    const spEffective = parseFloat(row["savingsPlan/SavingsPlanEffectiveCost"] || '0');
    const billed = unblended || blended;
    // EffectiveCost: prefer amortized values when present (RI / Savings Plan rows)
    const effective = reservationEffective || spEffective || billed;

    // AmortizedCost (FOCUS): el pago upfront de un RI/Savings Plan aparece
    // INTEGRO en BilledCost del mes en que se compro, lo que distorsiona
    // cualquier serie temporal. La vista amortizada lo reparte a lo largo del
    // termino. AWS expone ese prorrateo en columnas dedicadas; cuando la linea
    // no es de compromiso, amortizado == efectivo.
    const riAmortizedUpfront = parseFloat(row["reservation/AmortizedUpfrontCostForUsage"] || '0');
    const spAmortizedUpfront = parseFloat(row["savingsPlan/AmortizedUpfrontCommitmentForBillingPeriod"] || '0');
    const amortized = riAmortizedUpfront || spAmortizedUpfront || effective;

    const lineType = row["lineItem/LineItemType"] || 'Usage';
    let pricingCategory: string = 'On-Demand';
    let chargeCategory: string = 'Usage';
    if (lineType.startsWith('SavingsPlan')) pricingCategory = 'Savings Plan';
    else if (lineType === 'DiscountedUsage' || lineType === 'RIFee') pricingCategory = 'Reserved';
    else if ((row["pricing/term"] || '').toLowerCase() === 'reserved') pricingCategory = 'Reserved';
    else if ((row["lineItem/UsageType"] || '').toLowerCase().includes('spot')) pricingCategory = 'Spot';

    if (lineType === 'Tax') chargeCategory = 'Tax';
    else if (lineType === 'Credit' || lineType === 'Refund') chargeCategory = 'Credit';
    else if (lineType === 'RIFee') chargeCategory = 'Fee';
    else if (lineType === 'SavingsPlanRecurringFee' || lineType === 'SavingsPlanNegation') chargeCategory = 'Adjustment';

    const serviceCode = row["lineItem/ProductCode"] || 'Unknown';
    const serviceName = row["product/ProductName"] || serviceCode;

    const tags: Record<string, string> = {};
    for (const key of Object.keys(row)) {
        if (key.startsWith('resourceTags/user:')) {
            const tagKey = key.replace('resourceTags/user:', '');
            const v = row[key];
            if (v) tags[tagKey] = v;
        }
    }

    return {
        ProviderName: 'AWS',
        PublisherName: 'Amazon Web Services',
        BillingAccountId: payerAccountId,
        SubAccountId: row["lineItem/UsageAccountId"] || payerAccountId,
        ServiceName: serviceName,
        ServiceCategory: awsServiceToCategory(serviceCode),
        Region: row["product/region"] || undefined,
        ResourceId: row["lineItem/ResourceId"] || undefined,
        ResourceType: row["product/instanceType"] || undefined,
        ChargePeriodStart: new Date(row["lineItem/UsageStartDate"]),
        ChargePeriodEnd: new Date(row["lineItem/UsageEndDate"]),
        BillingPeriodStart: row["bill/BillingPeriodStartDate"] ? new Date(row["bill/BillingPeriodStartDate"]) : undefined,
        BillingPeriodEnd: row["bill/BillingPeriodEndDate"] ? new Date(row["bill/BillingPeriodEndDate"]) : undefined,
        BilledCost: billed,
        EffectiveCost: effective,
        AmortizedCost: amortized,
        UsageQuantity: row["lineItem/UsageAmount"] ? parseFloat(row["lineItem/UsageAmount"]!) : undefined,
        UsageUnit: row["pricing/unit"] || undefined,
        PricingCategory: pricingCategory,
        ChargeCategory: chargeCategory,
        BillingCurrency: row["lineItem/CurrencyCode"] || 'USD',
        InvoiceIssuerName: 'Amazon Web Services, Inc.',
        Tags: tags,
    };
}

/**
 * Legacy wrapper kept for backward compatibility with the original stub.
 */
export function mapAwsCurToFocus(curRow: AwsCurLineItem): FocusLineItem {
    return mapCurRowToFocus(curRow, curRow["lineItem/UsageAccountId"] || '');
}

