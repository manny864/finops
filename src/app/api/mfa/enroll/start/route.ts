import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireRequestIdentity, AuthError } from '@/lib/requestAuth';
import pool from '@/modules/storage/db';
import { generateSecret } from '@/lib/mfa';
import { encryptSecret, generateRecoveryCodes } from '@/lib/mfaCrypto';

export async function POST(request: NextRequest) {
  try {
    const identity = await requireRequestIdentity(request);
    const { email, tenantId } = identity;

    // Generate new secret
    const { secret, qrCodeDataUrl } = await generateSecret(email);

    // Generate recovery codes
    const { plaintext: recoveryCodes, hashes: recoveryHashes } = await generateRecoveryCodes();

    // Encrypt secret
    const encrypted = encryptSecret(secret);

    // Store encrypted secret and recovery codes (but don't enable yet)
    const secretJson = JSON.stringify(encrypted);
    const codesJson = JSON.stringify(recoveryHashes);

    await pool.query(
      `UPDATE Users SET mfa_secret_encrypted = ?, mfa_recovery_codes_hash = ? 
       WHERE email = ? AND tenant_id = ?`,
      [secretJson, codesJson, email, tenantId]
    );

    return NextResponse.json(
      {
        qrCodeDataUrl,
        manualSecret: secret,
        recoveryCodes,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Error in POST /api/mfa/enroll/start:', error);

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
