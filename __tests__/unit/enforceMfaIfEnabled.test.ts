import { describe, it, expect, vi, beforeEach } from 'vitest';

// @vitest-environment node

// Mock the DB pool used by enforceMfaIfEnabled / requireMfaChallenge.
const queryMock = vi.fn();
vi.mock('@/modules/storage/db', () => ({
  default: { query: (...args: any[]) => queryMock(...args) },
}));

import { enforceMfaIfEnabled } from '@/lib/requireMfaChallenge';
import { AuthError } from '@/lib/requestAuth';

function makeRequest(challengeId?: string): any {
  return {
    headers: {
      get: (name: string) =>
        name === 'X-MFA-Challenge-Id' ? challengeId ?? null : null,
    },
  };
}

describe('enforceMfaIfEnabled (opt-in per user)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('proceeds silently when the user does NOT have MFA enabled', async () => {
    // Users.mfa_enabled lookup returns 0 → MFA optional, no challenge required.
    queryMock.mockResolvedValueOnce([[{ mfa_enabled: 0 }], []]);

    await expect(
      enforceMfaIfEnabled(makeRequest(), 'user@corp.com', 'tid-1', 'delete_tenant', { tenantId: 'tid-1' })
    ).resolves.toBeUndefined();

    // Only the mfa_enabled lookup should have run — no MfaChallenges query.
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('proceeds silently when the user row does not exist', async () => {
    queryMock.mockResolvedValueOnce([[], []]);

    await expect(
      enforceMfaIfEnabled(makeRequest(), 'ghost@corp.com', 'tid-1', 'change_plan', { tenantId: 'tid-1' })
    ).resolves.toBeUndefined();

    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('throws when MFA is enabled but no challenge header is present', async () => {
    queryMock.mockResolvedValueOnce([[{ mfa_enabled: 1 }], []]);

    await expect(
      enforceMfaIfEnabled(makeRequest(), 'user@corp.com', 'tid-1', 'cancel_subscription', { tenantId: 'tid-1' })
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('throws when MFA is enabled and challenge is not found', async () => {
    queryMock
      .mockResolvedValueOnce([[{ mfa_enabled: 1 }], []]) // mfa_enabled lookup
      .mockResolvedValueOnce([[], []]); // MfaChallenges lookup → not found

    await expect(
      enforceMfaIfEnabled(makeRequest('challenge-123'), 'user@corp.com', 'tid-1', 'delete_tenant', { tenantId: 'tid-1' })
    ).rejects.toBeInstanceOf(AuthError);
  });
});
