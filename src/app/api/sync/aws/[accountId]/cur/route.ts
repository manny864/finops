/**
 * POST /api/sync/aws/[accountId]/cur?tenantId=...
 *
 * Reads the latest CUR billing period from S3 (Parquet manifest), streams rows,
 * aggregates per (date, region, service) and upserts into CostSnapshots.
 *
 * Note: CUR is HIGH volume (millions of rows possible). MVP aggregates in-memory
 * then bulk upserts. For multi-GB CURs use the streaming batch path
 * (lib/aws/cur.ts ingestLatestCurPeriod onBatch callback).
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { AuthError, requireTenantRole } from '@/lib/requestAuth';
import { assumeRole, decryptExternalId } from '@/lib/aws/sts';
import { ingestLatestCurPeriod } from '@/lib/aws/cur';
import type { FocusLineItem } from '@/modules/collectors/aws/awsFocusMapper';

interface AccountRow {
  id: string;
  tenant_id: string;
  account_id: string;
  role_arn: string;
  external_id_encrypted: string;
  cur_bucket: string | null;
  cur_prefix: string | null;
  cur_report_name: string | null;
}

interface AggKey {
  date: string;
  region: string;
  service: string;
}

function aggKey(k: AggKey): string {
  return `${k.date}|${k.region}|${k.service}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId: pkId } = await params;
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
    await requireTenantRole(request, tenantId, ['ADMIN', 'OWNER']);

    const [rows] = await pool.query(
      `SELECT id, tenant_id, account_id, role_arn, external_id_encrypted,
              cur_bucket, cur_prefix, cur_report_name
         FROM AwsAccounts WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [pkId, tenantId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 });
    }
    const row = rows[0] as AccountRow;
    if (!row.cur_bucket || !row.cur_prefix || !row.cur_report_name) {
      return NextResponse.json(
        { error: 'CUR no configurado en esta cuenta (faltan cur_bucket / cur_prefix / cur_report_name)' },
        { status: 400 }
      );
    }

    await pool.query(`UPDATE AwsAccounts SET sync_status = 'SYNCING' WHERE id = ?`, [pkId]);

    const externalId = decryptExternalId(row.external_id_encrypted);
    const creds = await assumeRole(row.role_arn, externalId, `FinOps-CUR-${tenantId.slice(0, 8)}`);

    // Aggregate by (date, region, service) to fit CostSnapshots' unique key.
    const agg = new Map<string, { date: string; region: string; service: string; billed: number; effective: number; qty: number; serviceCategory?: string }>();

    const result = await ingestLatestCurPeriod(
      creds,
      row.cur_bucket,
      row.cur_prefix,
      row.cur_report_name,
      row.account_id,
      async (batch: FocusLineItem[]) => {
        for (const r of batch) {
          const date = r.ChargePeriodStart.toISOString().slice(0, 10);
          const region = r.Region || '*';
          const service = r.ServiceName || 'Unknown';
          const k = aggKey({ date, region, service });
          const prev = agg.get(k);
          if (prev) {
            prev.billed += r.BilledCost;
            prev.effective += r.EffectiveCost;
            prev.qty += r.UsageQuantity || 0;
          } else {
            agg.set(k, {
              date,
              region,
              service,
              billed: r.BilledCost,
              effective: r.EffectiveCost,
              qty: r.UsageQuantity || 0,
              serviceCategory: r.ServiceCategory,
            });
          }
        }
      }
    );

    // Bulk upsert aggregated rows
    let upserts = 0;
    for (const v of agg.values()) {
      if (v.billed === 0 && v.effective === 0) continue;
      const start = new Date(`${v.date}T00:00:00Z`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO CostSnapshots
           (tenant_id, subscription_id, date, resource_group, service_name,
            cost_usd, currency,
            ChargePeriodStart, ChargePeriodEnd, ProviderName, PublisherName,
            SubAccountId, BilledCost, EffectiveCost, Quantity, ServiceFamily)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cost_usd = VALUES(cost_usd),
           BilledCost = VALUES(BilledCost),
           EffectiveCost = VALUES(EffectiveCost),
           Quantity = VALUES(Quantity),
           ServiceFamily = VALUES(ServiceFamily),
           ProviderName = VALUES(ProviderName),
           PublisherName = VALUES(PublisherName),
           SubAccountId = VALUES(SubAccountId),
           ChargePeriodStart = VALUES(ChargePeriodStart),
           ChargePeriodEnd = VALUES(ChargePeriodEnd)`,
        [
          tenantId, row.account_id, v.date, v.region, v.service,
          v.billed, 'USD',
          start, end, 'AWS', 'Amazon Web Services',
          row.account_id, v.billed, v.effective, v.qty || null,
          v.serviceCategory || null,
        ]
      );
      upserts++;
    }

    await pool.query(
      `UPDATE AwsAccounts SET sync_status = 'OK', last_sync_at = NOW(), last_error_message = NULL WHERE id = ?`,
      [pkId]
    );

    return NextResponse.json({
      success: true,
      source: 'cur-s3',
      bucket: row.cur_bucket,
      reportName: row.cur_report_name,
      billingPeriodStart: result.billingPeriodStart,
      billingPeriodEnd: result.billingPeriodEnd,
      filesProcessed: result.filesProcessed,
      rowsRead: result.rowCount,
      aggregatedRows: agg.size,
      rowsUpserted: upserts,
    });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : 'Error';
    console.error('POST /api/sync/aws/[accountId]/cur:', e);
    try {
      await pool.query(
        `UPDATE AwsAccounts SET sync_status = 'ERROR', last_error_message = ? WHERE id = ?`,
        [msg.slice(0, 1000), pkId]
      );
    } catch { /* ignore */ }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
