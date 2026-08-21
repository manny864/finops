import { NextRequest, NextResponse } from 'next/server';
import { requireRequestIdentity, AuthError } from '@/lib/requestAuth';
import pool from '@/modules/storage/db';
import { verifyToken } from '@/lib/mfa';
import { decryptSecret, verifyRecoveryCode } from '@/lib/mfaCrypto';
import { errorMessage, errorStatus } from '@/lib/apiErrors';

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

    // Get user MFA data. SELECT ... FOR UPDATE + transacción evita el mismo
    // TOCTOU que en verify-challenge: dos requests concurrentes con el mismo
    // recovery code podían consumirlo dos veces antes de este fix.
    const connection = await pool.getConnection();
    let user: any;
    let verified = false;
    let userNotFound = false;
    let mfaNotEnabled = false;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes_hash FROM Users
         WHERE email = ? AND tenant_id = ? FOR UPDATE`,
        [email, tenantId]
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        userNotFound = true;
        await connection.rollback();
      } else {
        user = rows[0] as any;
        if (!user.mfa_enabled) {
          mfaNotEnabled = true;
          await connection.rollback();
        } else {
          // Try TOTP token
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

          // Try recovery code
          if (!verified && recoveryCode) {
            if (user.mfa_recovery_codes_hash) {
              try {
                const hashes = JSON.parse(user.mfa_recovery_codes_hash);
                const result = await verifyRecoveryCode(recoveryCode, hashes);
                if (result.valid) {
                  verified = true;
                  // Update remaining recovery codes (fila bloqueada por FOR UPDATE)
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

          if (verified) {
            // Disable MFA en la misma transacción.
            await connection.query(
              `UPDATE Users SET mfa_enabled = FALSE, mfa_secret_encrypted = NULL,
               mfa_recovery_codes_hash = NULL WHERE email = ? AND tenant_id = ?`,
              [email, tenantId]
            );
          }
          await connection.commit();
        }
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

    if (mfaNotEnabled) {
      return NextResponse.json(
        { error: { code: 'mfa_not_enabled', message: 'MFA is not enabled' } },
        { status: 400 }
      );
    }

    if (!verified) {
      return NextResponse.json(
        { error: { code: 'invalid_credentials', message: 'Invalid token or recovery code' } },
        { status: 400 }
      );
    }

    // TODO: Audit log

    return NextResponse.json({ disabled: true }, { status: 200 });
  } catch (error) {
    console.error('Error in POST /api/mfa/disable:', error);

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
