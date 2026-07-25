/**
 * POST /api/aws/accounts/[id]/test?tenantId=...
 *
 * Validates the assume-role trust policy is correct by:
 *  1. Reading role_arn + external_id_encrypted from DB.
 *  2. STS AssumeRole.
 *  3. Cost Explorer GetCostAndUsage(last 7 days).
 *
 * Returns total cost found + whether CUR S3 path is reachable (if configured).
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { AuthError, requireTenantRole, requireTenantTier } from '@/lib/requestAuth';
import { assumeRole, decryptExternalId } from '@/lib/aws/sts';
import { getCostAndUsage } from '@/lib/aws/costExplorer';
import { findLatestBillingPeriod } from '@/lib/aws/cur';

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
    await requireTenantRole(request, tenantId, ['ADMIN', 'OWNER']);
    // Este endpoint gasta requests reales de Cost Explorer ($0.01 c/u): gate
    // de tier ademas del de rol.
    await requireTenantTier(request, tenantId, 'Enterprise');

    const [rows] = await pool.query(
      `SELECT id, tenant_id, account_id, role_arn, external_id_encrypted, cur_bucket, cur_prefix, cur_report_name
         FROM AwsAccounts WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, tenantId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 });
    }
    const row = rows[0] as AccountRow;

    const externalId = decryptExternalId(row.external_id_encrypted);
    const startedAt = Date.now();
    const creds = await assumeRole(row.role_arn, externalId, `FinOps-Test-${tenantId.slice(0, 8)}`);
    const assumeMs = Date.now() - startedAt;

    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const isoStart = start.toISOString().slice(0, 10);
    const isoEnd = end.toISOString().slice(0, 10);

    const ceStart = Date.now();
    const ceRows = await getCostAndUsage(creds, isoStart, isoEnd);
    const ceMs = Date.now() - ceStart;
    const totalCost = ceRows.reduce((acc, r) => acc + r.unblendedCost, 0);

    let curStatus: { configured: boolean; reachable: boolean; latestPartition: string | null; error?: string } = {
      configured: !!(row.cur_bucket && row.cur_prefix && row.cur_report_name),
      reachable: false,
      latestPartition: null,
    };
    if (row.cur_bucket && row.cur_prefix && row.cur_report_name) {
      try {
        const partition = await findLatestBillingPeriod(
          creds,
          row.cur_bucket,
          row.cur_prefix,
          row.cur_report_name
        );
        curStatus = { configured: true, reachable: true, latestPartition: partition };
      } catch (e: unknown) {
        curStatus = {
          configured: true,
          reachable: false,
          latestPartition: null,
          error: e instanceof Error ? e.message : 'CUR check failed',
        };
      }
    }

    await pool.query(
      `UPDATE AwsAccounts SET sync_status = 'OK', last_error_message = NULL WHERE id = ?`,
      [id]
    );

    return NextResponse.json({
      success: true,
      assumeRoleMs: assumeMs,
      costExplorerMs: ceMs,
      window: { start: isoStart, end: isoEnd },
      totalCost,
      rowCount: ceRows.length,
      currency: 'USD',
      cur: curStatus,
    });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : 'Error';
    console.error('POST /api/aws/accounts/[id]/test:', e);
    const { id } = await params;
    try {
      await pool.query(
        `UPDATE AwsAccounts SET sync_status = 'ERROR', last_error_message = ? WHERE id = ?`,
        [msg.slice(0, 1000), id]
      );
    } catch { /* ignore secondary failure */ }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
