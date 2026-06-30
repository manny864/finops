import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireRequestIdentity, AuthError } from '@/lib/requestAuth';
import pool from '@/modules/storage/db';
import { hashPayload } from '@/lib/mfaCrypto';

interface ChallengeBody {
  operation: string;
  payload?: any;
}

export async function POST(request: NextRequest) {
  try {
    const identity = await requireRequestIdentity(request);
    const { email, tenantId } = identity;
    const body: ChallengeBody = await request.json();
    const { operation, payload } = body;

    if (!operation || typeof operation !== 'string') {
      return NextResponse.json(
        { error: { code: 'invalid_operation', message: 'Operation is required' } },
        { status: 400 }
      );
    }

    // Check if user has MFA enabled
    const [rows] = await pool.query(
      `SELECT mfa_enabled FROM Users WHERE email = ? AND tenant_id = ?`,
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
        {
          error: {
            code: 'mfa_required',
            message: 'MFA is required for this operation',
          },
          mfa_enrollment_required: true,
        },
        { status: 412 }
      );
    }

    // Create challenge
    const challengeId = uuidv4();
    const payloadHash = payload ? hashPayload(payload) : null;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await pool.query(
      `INSERT INTO MfaChallenges (id, user_email, tenant_id, operation, payload_hash, expires_at) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [challengeId, email, tenantId, operation, payloadHash, expiresAt]
    );

    return NextResponse.json({ challenge_id: challengeId }, { status: 200 });
  } catch (error: any) {
    console.error('Error in POST /api/mfa/challenge:', error);

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
