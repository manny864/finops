'use client';

import React, { useState, useCallback } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';

interface MfaPromptModalProps {
  open: boolean;
  operation: string;
  payload?: any;
  onVerified: (challengeId: string) => void;
  onCancel: () => void;
}

export function MfaPromptModal({
  open,
  operation,
  payload,
  onVerified,
  onCancel,
}: MfaPromptModalProps) {
  const t = useTranslations('Mfa');
  const { instance, accounts } = useMsal();
  const [step, setStep] = useState<'input' | 'verify'>('input');
  const [loading, setLoading] = useState(false);
  const [challengeId, setChallenge] = useState<string>('');
  const [credential, setCredential] = useState<string>('');

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!accounts || accounts.length === 0) return {};
    const token = await getFreshIdToken(instance, accounts[0]);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [instance, accounts]);

  const handleStartChallenge = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/mfa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ operation, payload }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.error?.code === 'mfa_required' && err.mfa_enrollment_required) {
          toast.error(t('enrollmentRequired'));
        } else {
          toast.error(err.error?.message || t('startFailed'));
        }
        onCancel();
        return;
      }

      const data = await res.json();
      setChallenge(data.challenge_id);
      setStep('verify');
    } catch (error) {
      console.error('Error starting MFA challenge:', error);
      toast.error(t('startFailed'));
      onCancel();
    } finally {
      setLoading(false);
    }
  }, [operation, payload, onCancel, authHeaders, t]);

  const handleVerify = useCallback(async () => {
    if (!credential) {
      toast.error(t('enterCode'));
      return;
    }

    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/mfa/verify-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          challenge_id: challengeId,
          ...(credential.length === 6 ? { token: credential } : { recovery_code: credential }),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error?.message || t('invalidCode'));
        return;
      }

      toast.success(t('verified'));
      onVerified(challengeId);
    } catch (error) {
      console.error('Error verifying MFA:', error);
      toast.error(t('verifyFailed'));
    } finally {
      setLoading(false);
    }
  }, [credential, challengeId, onVerified, authHeaders, t]);

  React.useEffect(() => {
    if (open && step === 'input') {
      handleStartChallenge();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const handleClose = () => {
    setStep('input');
    setChallenge('');
    setCredential('');
    onCancel();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 sm:max-w-[400px] w-full mx-4">
        <div className="mb-4 flex items-start gap-3">
          <ShieldCheck className="h-6 w-6 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-semibold">{t('title')}</h2>
            <p className="text-sm text-gray-600 mt-1">{t('description')}</p>
          </div>
        </div>

        {step === 'verify' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('codeLabel')}
              </label>
              <input
                type="text"
                placeholder="000000"
                maxLength={20}
                value={credential}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCredential(e.target.value.toUpperCase())}
                disabled={loading}
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleClose}
                disabled={loading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleVerify}
                disabled={loading || !credential}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('verify')}
              </button>
            </div>
          </div>
        )}

        {step === 'input' && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        )}
      </div>
    </div>
  );
}
