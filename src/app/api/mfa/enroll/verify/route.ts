import { NextRequest, NextResponse } from 'next/server';
import { requireRequestIdentity, AuthError } from '@/lib/requestAuth';
import pool from '@/modules/storage/db';
import { verifyToken } from '@/lib/mfa';
import { decryptSecret } from '@/lib/mfaCrypto';
import { errorMessage, errorStatus } from '@/lib/apiErrors';

interface VerifyBody {
  token: string;
}

export async function POST(request: NextRequest) {
  try {
    const identity = await requireRequestIdentity(request);
    const { email, tenantId } = identity;
    const body: VerifyBody = await request.json();
    const { token } = body;

    if (!token || typeof token !== 'string' || token.length !== 6) {
      return NextResponse.json(
        { error: { code: 'invalid_token', message: 'Token must be 6 digits' } },
        { status: 400 }
      );
    }

    // Get encrypted secret from DB
    const [rows] = await pool.query(
      `SELECT mfa_secret_encrypted FROM Users WHERE email = ? AND tenant_id = ?`,
      [email, tenantId]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: { code: 'user_not_found', message: 'User not found' } },
        { status: 404 }
      );
    }

    const user = rows[0] as any;
    if (!user.mfa_secret_encrypted) {
      return NextResponse.json(
        { error: { code: 'no_secret', message: 'No MFA secret found' } },
        { status: 400 }
      );
    }

    // Decrypt secret
    const encrypted = JSON.parse(user.mfa_secret_encrypted);
    const secret = decryptSecret(encrypted.ciphertext, encrypted.iv, encrypted.authTag);

    // Verify token
    const valid = await verifyToken(secret, token);
    if (!valid) {
      return NextResponse.json(
        { error: { code: 'invalid_token', message: 'Invalid token' } },
        { status: 400 }
      );
    }

    // Enable MFA
    await pool.query(
      `UPDATE Users SET mfa_enabled = TRUE, mfa_last_used_at = NOW() WHERE email = ? AND tenant_id = ?`,
      [email, tenantId]
    );

    return NextResponse.json({ enabled: true }, { status: 200 });
  } catch (error) {
    console.error('Error in POST /api/mfa/enroll/verify:', error);

    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: { code: 'unauthorized', message: errorMessage(error) } },
        { status: errorStatus(error) }
      );
    }

    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
