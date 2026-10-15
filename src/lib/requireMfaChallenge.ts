import { NextRequest } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import pool from '@/modules/storage/db';
import { hashPayload } from './mfaCrypto';
import { AuthError } from './requestAuth';

/**
 * Enforce MFA for a sensitive operation ONLY when the acting user has 2FA
 * enabled. MFA is opt-in per user (ver MANUAL_DE_USUARIO.md → Seguridad):
 * un usuario sin 2FA activado ejecuta la operación normalmente; un usuario
 * con 2FA activado DEBE presentar un challenge MFA verificado (header
 * X-MFA-Challenge-Id) recién consumido para ese `operation`/`payload`.
 *
 * `email`/`tenantId` deben ser la identidad del propio llamador (la que crea
 * el challenge vía /api/mfa/challenge con requireRequestIdentity), NO el
 * tenant objetivo de la operación — así el binding usuario+tenant coincide.
 */
export async function enforceMfaIfEnabled(
  request: NextRequest,
  email: string,
  tenantId: string,
  operation: string,
  payload?: any
): Promise<void> {
  const [rows] = await pool.query(
    `SELECT mfa_enabled FROM Users WHERE email = ? AND tenant_id = ? LIMIT 1`,
    [email, tenantId]
  );
  const enabled = Array.isArray(rows) && rows.length > 0 && !!(rows[0] as any).mfa_enabled;
  if (!enabled) {
    return; // 2FA es opcional por usuario — no está activado, se permite.
  }
  await requireMfaChallenge(request, email, tenantId, operation, payload);
}

/**
 * Verifies that a valid MFA challenge was just verified for this operation.
 * Reads X-MFA-Challenge-Id header and checks that:
 * 1. Challenge exists and belongs to the user
 * 2. Challenge was consumed (verified)
 * 3. Challenge was consumed within the last 60 seconds
 * 4. Challenge operation and payload hash match
 * 5. Challenge is single-use (se elimina al consumirlo)
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

  // APPSEC-ID-05: el payload es obligatorio y el challenge debe haberse emitido con él.
  if (payload === undefined) {
    throw new AuthError('MFA payload required', 403);
  }

  // APPSEC-ID-04: consumo atómico y de un solo uso. El DELETE condicional valida
  // dueño, operación, payload, verificación (<=60s) y vigencia a la vez; si dos
  // requests compiten, sólo una afecta la fila.
  const [res] = await pool.query<ResultSetHeader>(
    `DELETE FROM MfaChallenges
      WHERE id = ? AND user_email = ? AND tenant_id = ? AND operation = ?
        AND payload_hash = ?
        AND consumed_at IS NOT NULL
        AND consumed_at >= NOW() - INTERVAL 60 SECOND
        AND expires_at > NOW()`,
    [challengeId, userEmail, tenantId, expectedOperation, hashPayload(payload)]
  );

  if (res.affectedRows !== 1) {
    throw new AuthError('MFA challenge invalid, expired or already used', 403);
  }
}
