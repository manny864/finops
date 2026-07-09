import { toMoneyNumber } from "@/lib/money";

export interface FocusCostEntry {
    BilledCost: number;
    EffectiveCost: number;
    ChargeCategory: string;
    ProviderName: string;
    SubAccountId: string;
    ServiceName: string;
    UsageDate?: string;
    ChargePeriodStart?: string;
    ChargePeriodEnd?: string;
    PublisherName?: string;
    CommitmentDiscountId?: string;
    Tags?: string;
}

export function mapAzureToFocus(row: any[], columns: any[]): FocusCostEntry {
    let costIndex = -1;
    let dateIndex = -1;
    let serviceIndex = -1;
    let subIndex = -1;
    let chargeTypeIndex = -1;
    let publisherIndex = -1;

    columns.forEach((col, idx) => {
        const name = col.name.toLowerCase();
        if (name === 'pretaxcost' || name === 'amortizedcost' || name === 'actualcost' || name === 'cost' || name === 'totalcost' || name === 'costusd') costIndex = idx;
        else if (name === 'usagedate') dateIndex = idx;
        else if (name === 'servicename') serviceIndex = idx;
        else if (name === 'subscriptionid') subIndex = idx;
        else if (name === 'chargetype') chargeTypeIndex = idx;
        else if (name === 'publishertype' || name === 'publishername') publisherIndex = idx;
    });

    // Azure often provides a single date. For FOCUS, we use it as ChargePeriodStart/End if exact ranges are missing.
    const usageDate = dateIndex !== -1 && row[dateIndex] ? String(row[dateIndex]) : undefined;


    const cost = costIndex !== -1 ? toMoneyNumber(row[costIndex]) : 0;

    return {
        BilledCost: cost,
        EffectiveCost: cost,
        ChargeCategory: chargeTypeIndex !== -1 && row[chargeTypeIndex] ? String(row[chargeTypeIndex]) : 'Usage',
        ProviderName: publisherIndex !== -1 && row[publisherIndex] ? String(row[publisherIndex]) : 'Azure',
        SubAccountId: subIndex !== -1 && row[subIndex] ? String(row[subIndex]) : 'Unknown',
        ServiceName: serviceIndex !== -1 && row[serviceIndex] ? String(row[serviceIndex]) : 'Unallocated',
        UsageDate: usageDate,
        ChargePeriodStart: usageDate,
        ChargePeriodEnd: usageDate,
        PublisherName: publisherIndex !== -1 && row[publisherIndex] ? String(row[publisherIndex]) : 'Microsoft',
        CommitmentDiscountId: 'None', // Default for Usage unless specified
        Tags: '{}' // Default empty JSON for tags
    };
}

export function mapCsvToFocus(row: Record<string, any>): FocusCostEntry {
    // Normalize keys to lowercase for flexible matching
    const normalizedRow: Record<string, any> = {};
    for (const key in row) {
        normalizedRow[key.toLowerCase()] = row[key];
    }

    const costString = normalizedRow['costinbillingcurrency'] || normalizedRow['cost'] || normalizedRow['pretaxcost'] || normalizedRow['amortizedcost'] || normalizedRow['actualcost'] || 0;
    const cost = toMoneyNumber(costString);

    return {
        BilledCost: cost,
        EffectiveCost: cost,
        ChargeCategory: String(normalizedRow['metercategory'] || normalizedRow['servicefamily'] || normalizedRow['chargetype'] || 'Usage'),
        ProviderName: String(normalizedRow['providername'] || normalizedRow['publisher'] || normalizedRow['publishertype'] || 'Azure'),
        SubAccountId: String(normalizedRow['subscriptionid'] || normalizedRow['subscriptionname'] || 'Unknown'),
        ServiceName: String(normalizedRow['resourcegroup'] || normalizedRow['servicename'] || 'Unallocated'),
        UsageDate: normalizedRow['date'] || normalizedRow['usagedate'] ? String(normalizedRow['date'] || normalizedRow['usagedate']) : undefined,
        ChargePeriodStart: normalizedRow['date'] || normalizedRow['usagedate'] ? String(normalizedRow['date'] || normalizedRow['usagedate']) : undefined,
        ChargePeriodEnd: normalizedRow['date'] || normalizedRow['usagedate'] ? String(normalizedRow['date'] || normalizedRow['usagedate']) : undefined,
        PublisherName: String(normalizedRow['publishername'] || normalizedRow['publisher'] || 'Microsoft'),
        CommitmentDiscountId: String(normalizedRow['commitmentdiscountid'] || normalizedRow['reservationid'] || 'None'),
        Tags: normalizedRow['tags'] ? (typeof normalizedRow['tags'] === 'string' ? normalizedRow['tags'] : JSON.stringify(normalizedRow['tags'])) : '{}'
    };
}
