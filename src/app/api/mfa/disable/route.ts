import { NextRequest, NextResponse } from 'next/server';
import { requireRequestIdentity, AuthError } from '@/lib/requestAuth';
import pool from '@/modules/storage/db';
import { verifyToken } from '@/lib/mfa';
import { decryptSecret, verifyRecoveryCode } from '@/lib/mfaCrypto';

interface DisableBody {
  token?: string;
  recoveryCode?: string;
}

export async function POST(request: NextRequest) {
  try {
    const identity = await requireRequestIdentity(request);
    const { email, tenantId } = identity;
    const body: DisableBody = await request.json();
    const { token, recoveryCode } = body;

    // Get user MFA data
    const [rows] = await pool.query(
      `SELECT mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes_hash FROM Users 
       WHERE email = ? AND tenant_id = ?`,
      [email, tenantId]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: { code: 'user_not_found', message: 'User not found' } },
        { status: 404 }
      );
    }

    const user = rows[0] as any;
    if (!user.mfa_enabled) {
      return NextResponse.json(
        { error: { code: 'mfa_not_enabled', message: 'MFA is not enabled' } },
        { status: 400 }
      );
    }

    let verified = false;

    // Try TOTP token
    if (token) {
      if (user.mfa_secret_encrypted) {
        try {
          const encrypted = JSON.parse(user.mfa_secret_encrypted);
          const secret = decryptSecret(encrypted.ciphertext, encrypted.iv, encrypted.authTag);
          verified = verifyToken(secret, token);
        } catch (e) {
          console.error('Error verifying TOTP token:', e);
        }
      }
    }

    // Try recovery code
    if (!verified && recoveryCode) {
      if (user.mfa_recovery_codes_hash) {
        try {
          const hashes = JSON.parse(user.mfa_recovery_codes_hash);
          const result = await verifyRecoveryCode(recoveryCode, hashes);
          if (result.valid) {
            verified = true;
            // Update remaining recovery codes
            await pool.query(
              `UPDATE Users SET mfa_recovery_codes_hash = ? WHERE email = ? AND tenant_id = ?`,
              [JSON.stringify(result.remaining), email, tenantId]
            );
          }
        } catch (e) {
          console.error('Error verifying recovery code:', e);
        }
      }
    }

    if (!verified) {
      return NextResponse.json(
        { error: { code: 'invalid_credentials', message: 'Invalid token or recovery code' } },
        { status: 400 }
      );
    }

    // Disable MFA
    await pool.query(
      `UPDATE Users SET mfa_enabled = FALSE, mfa_secret_encrypted = NULL, 
       mfa_recovery_codes_hash = NULL WHERE email = ? AND tenant_id = ?`,
      [email, tenantId]
    );

    // TODO: Audit log

    return NextResponse.json({ disabled: true }, { status: 200 });
  } catch (error: any) {
    console.error('Error in POST /api/mfa/disable:', error);

    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: { code: 'unauthorized', message: error.message } },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
