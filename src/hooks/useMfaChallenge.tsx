'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { MfaPromptModal } from '@/components/MfaPromptModal';

export interface MfaChallengeResult {
  /** challenge id to attach as X-MFA-Challenge-Id, or null if MFA is not enabled for the user. */
  challengeId: string | null;
  /** true if the user closed the modal without verifying — the caller must abort. */
  cancelled: boolean;
}

interface PromptState {
  open: boolean;
  operation: string;
  payload?: any;
}

/**
 * useMfaChallenge — client-side orchestration for MFA-gated sensitive operations.
 *
 * MFA is opt-in per user, so this hook first checks /api/mfa/status:
 *  - if the user does NOT have MFA enabled, it resolves immediately with
 *    { challengeId: null, cancelled: false } and the caller proceeds normally.
 *  - if enabled, it opens the MfaPromptModal, and resolves with the verified
 *    challengeId (attach it as the `X-MFA-Challenge-Id` header on the operation
 *    request) or { cancelled: true } if the user cancels.
 *
 * Usage:
 *   const { requestChallenge, mfaModal } = useMfaChallenge();
 *   const { challengeId, cancelled } = await requestChallenge('delete_tenant', { tenantId });
 *   if (cancelled) return;
 *   await fetch(url, { headers: { ...(challengeId ? { 'X-MFA-Challenge-Id': challengeId } : {}) } });
 *   // render {mfaModal} somewhere in the component tree
 */
export function useMfaChallenge() {
  const { instance, accounts } = useMsal();
  const [prompt, setPrompt] = useState<PromptState>({ open: false, operation: '' });
  const resolverRef = useRef<((r: MfaChallengeResult) => void) | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!accounts || accounts.length === 0) return {};
    const token = await getFreshIdToken(instance, accounts[0]);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [instance, accounts]);

  const requestChallenge = useCallback(
    async (operation: string, payload?: any): Promise<MfaChallengeResult> => {
      // 1) Is MFA enabled for this user? (opt-in per user)
      let enabled = false;
      try {
        const headers = await authHeaders();
        const res = await fetch('/api/mfa/status', { headers });
        if (res.ok) {
          const data = await res.json();
          enabled = !!data.enabled;
        }
      } catch {
        enabled = false;
      }

      if (!enabled) {
        return { challengeId: null, cancelled: false };
      }

      // 2) Enabled → open modal and await verification.
      return new Promise<MfaChallengeResult>((resolve) => {
        resolverRef.current = resolve;
        setPrompt({ open: true, operation, payload });
      });
    },
    [authHeaders]
  );

  const handleVerified = useCallback((challengeId: string) => {
    setPrompt((p) => ({ ...p, open: false }));
    resolverRef.current?.({ challengeId, cancelled: false });
    resolverRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setPrompt((p) => ({ ...p, open: false }));
    resolverRef.current?.({ challengeId: null, cancelled: true });
    resolverRef.current = null;
  }, []);

  const mfaModal = (
    <MfaPromptModal
      open={prompt.open}
      operation={prompt.operation}
      payload={prompt.payload}
      onVerified={handleVerified}
      onCancel={handleCancel}
    />
  );

  return { requestChallenge, mfaModal };
}
