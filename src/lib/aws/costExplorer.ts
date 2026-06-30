/**
 * AWS Cost Explorer thin wrapper.
 *
 * Returns daily cost rows grouped by service + region, ready to be mapped to
 * FOCUS via mapCeDailyToFocus(). Used as the "lightweight" sync path. For
 * higher-fidelity per-resource billing, use the CUR S3 ingestion path
 * (lib/aws/cur.ts).
 *
 * Cost Explorer pricing: $0.01 per request. We minimize calls by:
 *   - Asking for DAILY granularity in a single GetCostAndUsage call
 *     (covers up to 1 year at a time).
 *   - Grouping in a single dimension pass; UI can re-aggregate locally.
 */

import { CostExplorerClient, GetCostAndUsageCommand, type GroupDefinition } from '@aws-sdk/client-cost-explorer';
import type { AwsTempCredentials } from './sts';

export interface CeDailyRow {
  date: string;                  // YYYY-MM-DD
  serviceCode: string;           // e.g. "AmazonEC2"
  region: string;                // e.g. "us-east-1" or "NoRegion"
  unblendedCost: number;         // USD
  amortizedCost: number;         // USD (RIs / Savings Plans amortized)
  usageQuantity: number;
}

/**
 * Pulls daily costs grouped by SERVICE + REGION between [start, end).
 * Dates are ISO YYYY-MM-DD. end is exclusive per AWS convention.
 */
export async function getCostAndUsage(
  creds: AwsTempCredentials,
  start: string,
  end: string
): Promise<CeDailyRow[]> {
  // Cost Explorer is global (us-east-1).
  const client = new CostExplorerClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
  });

  const groupBy: GroupDefinition[] = [
    { Type: 'DIMENSION', Key: 'SERVICE' },
    { Type: 'DIMENSION', Key: 'REGION' },
  ];

  const rows: CeDailyRow[] = [];
  let nextToken: string | undefined;
  do {
    const out = await client.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: start, End: end },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost', 'AmortizedCost', 'UsageQuantity'],
        GroupBy: groupBy,
        NextPageToken: nextToken,
      })
    );

    for (const period of out.ResultsByTime || []) {
      const date = period.TimePeriod?.Start || '';
      for (const g of period.Groups || []) {
        const [serviceCode = 'Unknown', region = 'NoRegion'] = g.Keys || [];
        rows.push({
          date,
          serviceCode,
          region,
          unblendedCost: parseFloat(g.Metrics?.UnblendedCost?.Amount || '0'),
          amortizedCost: parseFloat(g.Metrics?.AmortizedCost?.Amount || '0'),
          usageQuantity: parseFloat(g.Metrics?.UsageQuantity?.Amount || '0'),
        });
      }
    }

    nextToken = out.NextPageToken;
  } while (nextToken);

  return rows;
}
