import { NextRequest } from 'next/server';
import pool from '@/modules/storage/db';
import { hashPayload } from './mfaCrypto';
import { AuthError } from './requestAuth';

/**
 * Verifies that a valid MFA challenge was just verified for this operation.
 * Reads X-MFA-Challenge-Id header and checks that:
 * 1. Challenge exists and belongs to the user
 * 2. Challenge was consumed (verified)
 * 3. Challenge was consumed within the last 60 seconds
 * 4. Challenge operation and payload hash match
 */
export async function requireMfaChallenge(
  request: NextRequest,
  userEmail: string,
  tenantId: string,
  expectedOperation: string,
  payload: any
): Promise<void> {
  const challengeId = request.headers.get('X-MFA-Challenge-Id');

  if (!challengeId) {
    throw new AuthError('MFA challenge required', 403);
  }

  // Get challenge
  const [rows] = await pool.query(
    `SELECT * FROM MfaChallenges WHERE id = ? AND user_email = ? AND tenant_id = ? AND operation = ?`,
    [challengeId, userEmail, tenantId, expectedOperation]
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AuthError('MFA challenge not found or invalid', 403);
  }

  const challenge = rows[0] as any;

  // Check if consumed
  if (!challenge.consumed_at) {
    throw new AuthError('MFA challenge not yet verified', 403);
  }

  // Check payload hash if provided
  if (payload !== undefined && challenge.payload_hash) {
    const expectedHash = hashPayload(payload);
    if (challenge.payload_hash !== expectedHash) {
      throw new AuthError('Payload mismatch', 403);
    }
  }

  // Check if consumed recently (within 60 seconds)
  const consumedAt = new Date(challenge.consumed_at);
  const now = new Date();
  const secondsElapsed = (now.getTime() - consumedAt.getTime()) / 1000;

  if (secondsElapsed > 60) {
    throw new AuthError('MFA challenge expired', 403);
  }
}
