import { NextRequest, NextResponse } from 'next/server';
import { requireRequestIdentity, AuthError } from '@/lib/requestAuth';
import pool from '@/modules/storage/db';
import { verifyToken } from '@/lib/mfa';
import { decryptSecret, verifyRecoveryCode } from '@/lib/mfaCrypto';

interface VerifyChallengeBody {
  challenge_id: string;
  token?: string;
  recovery_code?: string;
}

export async function POST(request: NextRequest) {
  try {
    const identity = await requireRequestIdentity(request);
    const { email, tenantId } = identity;
    const body: VerifyChallengeBody = await request.json();
    const { challenge_id, token, recovery_code } = body;

    if (!challenge_id || typeof challenge_id !== 'string') {
      return NextResponse.json(
        { error: { code: 'invalid_challenge_id', message: 'Challenge ID is required' } },
        { status: 400 }
      );
    }

    if (!token && !recovery_code) {
      return NextResponse.json(
        { error: { code: 'invalid_credentials', message: 'Token or recovery code is required' } },
        { status: 400 }
      );
    }

    // Get challenge
    const [challengeRows] = await pool.query(
      `SELECT * FROM MfaChallenges WHERE id = ? AND user_email = ? AND tenant_id = ?`,
      [challenge_id, email, tenantId]
    );

    if (!Array.isArray(challengeRows) || challengeRows.length === 0) {
      return NextResponse.json(
        { error: { code: 'challenge_not_found', message: 'Challenge not found' } },
        { status: 404 }
      );
    }

    const challenge = challengeRows[0] as any;

    // Check if consumed
    if (challenge.consumed_at) {
      return NextResponse.json(
        { error: { code: 'challenge_already_used', message: 'Challenge already used' } },
        { status: 400 }
      );
    }

    // Check if expired
    if (new Date(challenge.expires_at) < new Date()) {
      return NextResponse.json(
        { error: { code: 'challenge_expired', message: 'Challenge expired' } },
        { status: 400 }
      );
    }

    // Get user MFA data
    const [userRows] = await pool.query(
      `SELECT mfa_secret_encrypted, mfa_recovery_codes_hash FROM Users 
       WHERE email = ? AND tenant_id = ?`,
      [email, tenantId]
    );

    if (!Array.isArray(userRows) || userRows.length === 0) {
      return NextResponse.json(
        { error: { code: 'user_not_found', message: 'User not found' } },
        { status: 404 }
      );
    }

    const user = userRows[0] as any;
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
    if (!verified && recovery_code) {
      if (user.mfa_recovery_codes_hash) {
        try {
          const hashes = JSON.parse(user.mfa_recovery_codes_hash);
          const result = await verifyRecoveryCode(recovery_code, hashes);
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

    // Mark challenge as consumed
    await pool.query(
      `UPDATE MfaChallenges SET consumed_at = NOW() WHERE id = ?`,
      [challenge_id]
    );

    // Update mfa_last_used_at
    await pool.query(
      `UPDATE Users SET mfa_last_used_at = NOW() WHERE email = ? AND tenant_id = ?`,
      [email, tenantId]
    );

    return NextResponse.json({ verified: true }, { status: 200 });
  } catch (error: any) {
    console.error('Error in POST /api/mfa/verify-challenge:', error);

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
