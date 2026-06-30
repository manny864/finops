import { NextRequest, NextResponse } from 'next/server';
import { requireRequestIdentity, AuthError } from '@/lib/requestAuth';
import pool from '@/modules/storage/db';

/**
 * GET /api/mfa/status
 * Returns whether the authenticated user has MFA enabled and last-used timestamp.
 */
export async function GET(request: NextRequest) {
  try {
    const { email, tenantId } = await requireRequestIdentity(request);

    const [rows] = await pool.query(
      `SELECT mfa_enabled, mfa_last_used_at, mfa_recovery_codes_hash
         FROM Users
        WHERE email = ? AND tenant_id = ?`,
      [email, tenantId]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ enabled: false, lastUsedAt: null, recoveryCodesRemaining: 0 });
    }

    const u = rows[0] as { mfa_enabled?: number | boolean; mfa_last_used_at?: string | null; mfa_recovery_codes_hash?: string | null };
    const enabled = !!u.mfa_enabled;
    let remaining = 0;
    if (u.mfa_recovery_codes_hash) {
      try {
        const parsed = JSON.parse(u.mfa_recovery_codes_hash);
        if (Array.isArray(parsed)) remaining = parsed.length;
      } catch {
        remaining = 0;
      }
    }

    return NextResponse.json({
      enabled,
      lastUsedAt: u.mfa_last_used_at || null,
      recoveryCodesRemaining: remaining,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: error.status });
    }
    console.error('Error in GET /api/mfa/status:', error);
    return NextResponse.json({ error: { code: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
