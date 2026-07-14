import { NextRequest, NextResponse } from 'next/server';
import { requireRequestIdentity, AuthError } from '@/lib/requestAuth';
import pool from '@/modules/storage/db';
import { verifyToken } from '@/lib/mfa';
import { decryptSecret, verifyRecoveryCode } from '@/lib/mfaCrypto';
import rateLimiter from '@/lib/rateLimiter';

/** Maximum TOTP/recovery attempts per challenge before it is locked out. */
const MAX_ATTEMPTS = 5;

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

    // Rate limit: max MAX_ATTEMPTS per challenge_id per 60s window.
    // Secondary limit: max 10 attempts per email per minute across all challenges.
    const rlChallenge = rateLimiter.checkByKey(`mfa:cid:${challenge_id}`, MAX_ATTEMPTS, 300_000); // 5 min window
    const rlEmail = rateLimiter.checkByKey(`mfa:email:${tenantId}:${email}`, 10, 60_000);

    if (!rlChallenge.allowed || !rlEmail.allowed) {
      return NextResponse.json(
        { error: { code: 'rate_limited', message: 'Too many attempts. Please wait and try again.' } },
        { status: 429 }
      );
    }

    // Get challenge — bind by challenge_id + caller email + tenant to prevent IDOR.
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

    // Check if consumed (success) or locked out (too many failures).
    if (challenge.consumed_at) {
      return NextResponse.json(
        { error: { code: 'challenge_already_used', message: 'Challenge already used' } },
        { status: 400 }
      );
    }

    // attempt_count may not exist yet on older rows — default to 0.
    const attempts = challenge.attempt_count ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: { code: 'challenge_locked', message: 'Challenge locked after too many failed attempts' } },
        { status: 429 }
      );
    }

    // Check if expired.
    if (new Date(challenge.expires_at) < new Date()) {
      return NextResponse.json(
        { error: { code: 'challenge_expired', message: 'Challenge expired' } },
        { status: 400 }
      );
    }

    // Get user MFA data. SELECT ... FOR UPDATE + transacción: sin esto, dos
    // requests concurrentes con el mismo recovery code (doble-click, o un
    // atacante reenviando la misma solicitud) podían leer el mismo array de
    // hashes antes de que ninguno escribiera el "consumido", validando ambos
    // — el código de un solo uso quedaba usable dos veces (TOCTOU).
    const connection = await pool.getConnection();
    let user: any;
    let verified = false;
    let userNotFound = false;
    try {
      await connection.beginTransaction();
      const [userRows] = await connection.query(
        `SELECT mfa_secret_encrypted, mfa_recovery_codes_hash FROM Users
         WHERE email = ? AND tenant_id = ? FOR UPDATE`,
        [email, tenantId]
      );

      if (!Array.isArray(userRows) || userRows.length === 0) {
        userNotFound = true;
        await connection.rollback();
      } else {
        user = userRows[0] as any;

        // Try TOTP token.
        if (token) {
          if (user.mfa_secret_encrypted) {
            try {
              const encrypted = JSON.parse(user.mfa_secret_encrypted);
              const secret = decryptSecret(encrypted.ciphertext, encrypted.iv, encrypted.authTag);
              verified = await verifyToken(secret, token);
            } catch (e) {
              console.error('Error verifying TOTP token:', e);
            }
          }
        }

        // Try recovery code.
        if (!verified && recovery_code) {
          if (user.mfa_recovery_codes_hash) {
            try {
              const hashes = JSON.parse(user.mfa_recovery_codes_hash);
              const result = await verifyRecoveryCode(recovery_code, hashes);
              if (result.valid) {
                verified = true;
                // Consume the used recovery code immediately (misma fila bloqueada
                // por FOR UPDATE hasta el commit).
                await connection.query(
                  `UPDATE Users SET mfa_recovery_codes_hash = ? WHERE email = ? AND tenant_id = ?`,
                  [JSON.stringify(result.remaining), email, tenantId]
                );
              }
            } catch (e) {
              console.error('Error verifying recovery code:', e);
            }
          }
        }
        await connection.commit();
      }
    } catch (txnErr) {
      await connection.rollback();
      throw txnErr;
    } finally {
      connection.release();
    }

    if (userNotFound) {
      return NextResponse.json(
        { error: { code: 'user_not_found', message: 'User not found' } },
        { status: 404 }
      );
    }

    if (!verified) {
      // Always increment attempt_count on failure (consume-on-fail).
      // This prevents brute-forcing by reusing the same challenge_id.
      await pool.query(
        `UPDATE MfaChallenges SET attempt_count = COALESCE(attempt_count, 0) + 1 WHERE id = ?`,
        [challenge_id]
      );
      return NextResponse.json(
        { error: { code: 'invalid_credentials', message: 'Invalid token or recovery code' } },
        { status: 400 }
      );
    }

    // Mark challenge as consumed (success).
    await pool.query(
      `UPDATE MfaChallenges SET consumed_at = NOW() WHERE id = ?`,
      [challenge_id]
    );

    // Update mfa_last_used_at.
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
