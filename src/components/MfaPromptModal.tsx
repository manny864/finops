'use client';

import React, { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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
  const [step, setStep] = useState<'input' | 'verify'>('input');
  const [loading, setLoading] = useState(false);
  const [challengeId, setChallenge] = useState<string>('');
  const [credential, setCredential] = useState<string>('');

  const handleStartChallenge = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mfa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, payload }),
      });

      if (!res.ok) {
        const err = await res.json();
        if (err.error?.code === 'mfa_required' && err.mfa_enrollment_required) {
          toast.error('MFA is required but not enrolled. Please enable 2FA first.');
        } else {
          toast.error(err.error?.message || 'Failed to start MFA challenge');
        }
        onCancel();
        return;
      }

      const data = await res.json();
      setChallenge(data.challenge_id);
      setStep('verify');
    } catch (error: any) {
      console.error('Error starting MFA challenge:', error);
      toast.error('Failed to start MFA challenge');
      onCancel();
    } finally {
      setLoading(false);
    }
  }, [operation, payload, onCancel]);

  const handleVerify = useCallback(async () => {
    if (!credential) {
      toast.error('Please enter your 6-digit code or recovery code');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/mfa/verify-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: challengeId,
          ...(credential.length === 6 ? { token: credential } : { recovery_code: credential }),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error?.message || 'Invalid code');
        return;
      }

      toast.success('MFA verified');
      onVerified(challengeId);
    } catch (error: any) {
      console.error('Error verifying MFA:', error);
      toast.error('Failed to verify MFA');
    } finally {
      setLoading(false);
    }
  }, [credential, challengeId, onVerified]);

  React.useEffect(() => {
    if (open && step === 'input') {
      handleStartChallenge();
    }
  }, [open, step, handleStartChallenge]);

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
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Two-Factor Authentication</h2>
          <p className="text-sm text-gray-600 mt-1">
            Enter your 6-digit authenticator code or a recovery code to verify this action.
          </p>
        </div>

        {step === 'verify' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Authenticator Code or Recovery Code
              </label>
              <input
                type="text"
                placeholder="000000"
                maxLength={20}
                value={credential}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCredential(e.target.value.toUpperCase())}
                disabled={loading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleClose}
                disabled={loading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleVerify}
                disabled={loading || !credential}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify
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
