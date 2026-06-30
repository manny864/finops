/**
 * GET  /api/aws/accounts?tenantId=...   → list accounts (no secrets returned)
 * POST /api/aws/accounts                → create account (encrypts external_id)
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import pool from '@/modules/storage/db';
import { AuthError, requireTenantRole } from '@/lib/requestAuth';
import { encryptExternalId, generateExternalId } from '@/lib/aws/sts';

interface AccountRow {
  id: string;
  tenant_id: string;
  account_id: string;
  role_arn: string;
  alias: string;
  cur_bucket: string | null;
  cur_prefix: string | null;
  cur_report_name: string | null;
  last_sync_at: string | null;
  sync_status: 'OK' | 'ERROR' | 'SYNCING' | 'NEVER';
  last_error_message: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
    await requireTenantRole(request, tenantId, ['ADMIN', 'OWNER']);

    const [rows] = await pool.query(
      `SELECT id, tenant_id, account_id, role_arn, alias, cur_bucket, cur_prefix, cur_report_name,
              last_sync_at, sync_status, last_error_message, created_at
         FROM AwsAccounts WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );
    return NextResponse.json({ accounts: (rows as AccountRow[]) || [] });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, accountId, roleArn, alias, curBucket, curPrefix, curReportName } = body || {};
    if (!tenantId || !accountId || !roleArn || !alias) {
      return NextResponse.json({ error: 'tenantId, accountId, roleArn, alias requeridos' }, { status: 400 });
    }
    if (!/^\d{12}$/.test(accountId)) {
      return NextResponse.json({ error: 'accountId debe ser un AWS account ID de 12 dígitos' }, { status: 400 });
    }
    if (!/^arn:aws[a-z\-]*:iam::\d{12}:role\/.+/.test(roleArn)) {
      return NextResponse.json({ error: 'roleArn no parece un ARN de IAM Role válido' }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ['ADMIN', 'OWNER']);

    const externalId = generateExternalId();
    const encrypted = encryptExternalId(externalId);
    const id = uuidv4();

    await pool.query(
      `INSERT INTO AwsAccounts
         (id, tenant_id, account_id, role_arn, external_id_encrypted, alias, cur_bucket, cur_prefix, cur_report_name, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEVER')`,
      [id, tenantId, accountId, roleArn, encrypted, alias, curBucket || null, curPrefix || null, curReportName || null]
    );

    // Returns externalId ONE TIME so the user can configure the trust policy.
    return NextResponse.json({ id, accountId, alias, externalId }, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : 'Error';
    if (msg.includes('ER_DUP_ENTRY')) {
      return NextResponse.json({ error: 'Ya existe una cuenta AWS con ese accountId' }, { status: 409 });
    }
    console.error('POST /api/aws/accounts:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
