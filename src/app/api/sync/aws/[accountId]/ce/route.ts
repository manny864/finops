/**
 * POST /api/sync/aws/[accountId]/ce?tenantId=...&days=30
 *
 * Pulls Cost Explorer daily data and upserts into CostSnapshots with
 * ProviderName='AWS', BillingAccountId=<aws account>, BilledCost/EffectiveCost.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { AuthError, requireTenantRole, requireTenantTier } from '@/lib/requestAuth';
import { assumeRole, decryptExternalId } from '@/lib/aws/sts';
import { getCostAndUsage } from '@/lib/aws/costExplorer';
import { mapCeDailyToFocus } from '@/modules/collectors/aws/awsFocusMapper';

interface AccountRow {
  id: string;
  tenant_id: string;
  account_id: string;
  role_arn: string;
  external_id_encrypted: string;
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId: pkId } = await params;
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
    const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') || 30), 1), 365);
    await requireTenantRole(request, tenantId, ['ADMIN', 'OWNER']);
    // Multi-cloud es Enterprise (ver docs/aws-multicloud-handoff.md).
    await requireTenantTier(request, tenantId, 'Enterprise');

    const [rows] = await pool.query(
      `SELECT id, tenant_id, account_id, role_arn, external_id_encrypted
         FROM AwsAccounts WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [pkId, tenantId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 });
    }
    const row = rows[0] as AccountRow;

    await pool.query(`UPDATE AwsAccounts SET sync_status = 'SYNCING' WHERE id = ?`, [pkId]);

    const externalId = decryptExternalId(row.external_id_encrypted);
    const creds = await assumeRole(row.role_arn, externalId, `FinOps-Sync-${tenantId.slice(0, 8)}`);

    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const ceRows = await getCostAndUsage(creds, isoDate(start), isoDate(end));

    let upserts = 0;
    for (const r of ceRows) {
      if (r.unblendedCost === 0) continue;
      const focus = mapCeDailyToFocus(r, row.account_id);
      // CostSnapshots UNIQUE KEY: (tenant_id, subscription_id, date, resource_group, service_name)
      await pool.query(
        `INSERT INTO CostSnapshots
           (tenant_id, subscription_id, date, resource_group, service_name,
            cost_usd, currency,
            ChargePeriodStart, ChargePeriodEnd, ProviderName, PublisherName,
            BillingAccountId, SubAccountId, BilledCost, EffectiveCost, AmortizedCost, Quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cost_usd = VALUES(cost_usd),
           BilledCost = VALUES(BilledCost),
           EffectiveCost = VALUES(EffectiveCost),
           AmortizedCost = VALUES(AmortizedCost),
           Quantity = VALUES(Quantity),
           ProviderName = VALUES(ProviderName),
           PublisherName = VALUES(PublisherName),
           BillingAccountId = VALUES(BillingAccountId),
           SubAccountId = VALUES(SubAccountId),
           ChargePeriodStart = VALUES(ChargePeriodStart),
           ChargePeriodEnd = VALUES(ChargePeriodEnd)`,
        [
          tenantId,
          row.account_id,
          r.date,
          focus.Region || '*',
          focus.ServiceName,
          focus.BilledCost,
          focus.BillingCurrency || 'USD',
          focus.ChargePeriodStart,
          focus.ChargePeriodEnd,
          'AWS',
          'Amazon Web Services',
          focus.BillingAccountId,
          focus.SubAccountId,
          focus.BilledCost,
          focus.EffectiveCost,
          focus.AmortizedCost,
          focus.UsageQuantity ?? null,
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
      source: 'cost-explorer',
      window: { start: isoDate(start), end: isoDate(end), days },
      rowsFetched: ceRows.length,
      rowsUpserted: upserts,
    });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : 'Error';
    console.error('POST /api/sync/aws/[accountId]/ce:', e);
    try {
      await pool.query(
        `UPDATE AwsAccounts SET sync_status = 'ERROR', last_error_message = ? WHERE id = ?`,
        [msg.slice(0, 1000), pkId]
      );
    } catch { /* ignore */ }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
