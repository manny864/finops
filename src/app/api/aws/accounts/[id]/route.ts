/**
 * DELETE /api/aws/accounts/[id]?tenantId=...
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { AuthError, requireTenantRole } from '@/lib/requestAuth';
import { invalidateCostExplorerCache } from '@/lib/aws/costExplorer';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
    await requireTenantRole(request, tenantId, ['ADMIN', 'OWNER']);

    // Se lee el account_id antes de borrar: despues de el DELETE ya no hay forma
    // de saber que claves de cache invalidar, y quedarian datos de una cuenta
    // eliminada sirviendose hasta 24h.
    const [rows] = await pool.query(
      `SELECT account_id FROM AwsAccounts WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );
    const accountId = (rows as { account_id: string }[])[0]?.account_id;

    const [result] = await pool.query(
      `DELETE FROM AwsAccounts WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );
    const affected = (result as { affectedRows?: number }).affectedRows || 0;
    if (affected === 0) return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 });
    if (accountId) await invalidateCostExplorerCache(accountId);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
