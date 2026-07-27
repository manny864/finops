'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import {
  ShieldCheck,
  AlertCircle,
  Download,
  Loader2,
  Eye,
  EyeOff,
  Copy,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';

interface MFAStatus {
  enabled: boolean;
  lastUsedAt: string | null;
  recoveryCodesRemaining: number;
}

export default function SecurityPage() {
  const t = useTranslations('AdminSecurity');
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [mfaStatus, setMfaStatus] = useState<MFAStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [showEnrollmentModal, setShowEnrollmentModal] = useState(false);
  const [qrCode, setQrCode] = useState<string>('');
  const [manualSecret, setManualSecret] = useState<string>('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [totp, setTotp] = useState<string>('');
  const [showRecoveryCodesModal, setShowRecoveryCodesModal] = useState(false);
  const [showCodes, setShowCodes] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const [showDisableModal, setShowDisableModal] = useState(false);
  const [disableToken, setDisableToken] = useState('');

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!accounts || accounts.length === 0) return {};
    const token = await getFreshIdToken(instance, accounts[0]);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [instance, accounts]);

  const loadMFAStatus = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/mfa/status', { headers });
      if (!res.ok) {
        setMfaStatus({ enabled: false, lastUsedAt: null, recoveryCodesRemaining: 0 });
        return;
      }
      const data = await res.json();
      setMfaStatus({
        enabled: !!data.enabled,
        lastUsedAt: data.lastUsedAt ?? null,
        recoveryCodesRemaining: Number(data.recoveryCodesRemaining || 0),
      });
    } catch (e) {
      console.error('Error loading MFA status:', e);
      setMfaStatus({ enabled: false, lastUsedAt: null, recoveryCodesRemaining: 0 });
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadMFAStatus();
  }, [loadMFAStatus]);

  const handleEnrollStart = useCallback(async () => {
    setEnrolling(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/mfa/enroll/start', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error?.message || t('errors.enrollStartFailed'));
        return;
      }

      const data = await res.json();
      setQrCode(data.qrCodeDataUrl);
      setManualSecret(data.manualSecret);
      setRecoveryCodes(data.recoveryCodes);
      setShowEnrollmentModal(true);
    } catch (error: any) {
      console.error('Error starting MFA enrollment:', error);
      toast.error(t('errors.enrollStartFailed'));
    } finally {
      setEnrolling(false);
    }
  }, [authHeaders, t]);

  const handleEnrollVerify = useCallback(async () => {
    if (!totp) {
      toast.error(t('errors.enterCode'));
      return;
    }

    setVerifying(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/mfa/enroll/verify', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: totp }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error?.message || t('errors.invalidCode'));
        return;
      }

      toast.success(t('toasts.enabled'));
      setShowEnrollmentModal(false);
      setTotp('');
      setMfaStatus({ enabled: true, lastUsedAt: null, recoveryCodesRemaining: recoveryCodes.length });
    } catch (error: any) {
      console.error('Error verifying MFA:', error);
      toast.error(t('errors.verifyFailed'));
    } finally {
      setVerifying(false);
    }
  }, [totp, authHeaders, t]);

  const handleDisableMFA = useCallback(async () => {
    if (!disableToken || disableToken.length !== 6) {
      toast.error(t('errors.enterCodeToDisable'));
      return;
    }

    setDisabling(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/mfa/disable', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: disableToken }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error?.message || t('errors.disableFailed'));
        return;
      }

      toast.success(t('toasts.disabled'));
      setMfaStatus({ enabled: false, lastUsedAt: null, recoveryCodesRemaining: 0 });
      setShowDisableModal(false);
      setDisableToken('');
    } catch (error) {
      console.error('Error disabling MFA:', error);
      toast.error(t('errors.disableFailed'));
    } finally {
      setDisabling(false);
    }
  }, [authHeaders, disableToken, t]);

  const handleDownloadRecoveryCodes = useCallback(() => {
    const text = recoveryCodes.join('\n');
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', 'finops-mfa-recovery-codes.txt');
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    element.remove();
    toast.success(t('toasts.codesDownloaded'));
  }, [recoveryCodes, t]);

  const handleCopyCode = useCallback((code: string, index: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-8 w-8" />
          {t('title')}
        </h1>
        <p className="text-gray-600 mt-2">{t('subtitle')}</p>
      </div>

      {/* 2FA Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold mb-2">{t('twoFactor.heading')}</h2>
            <p className="text-gray-600 text-sm">
              {mfaStatus?.enabled
                ? t('twoFactor.enabledDescription')
                : t('twoFactor.disabledDescription')}
            </p>
            {mfaStatus?.enabled && mfaStatus?.lastUsedAt && (
              <p className="text-gray-500 text-xs mt-2">
                {t('twoFactor.lastUsed', { date: new Date(mfaStatus.lastUsedAt).toLocaleString() })}
              </p>
            )}
          </div>
          <div
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              mfaStatus?.enabled
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-800'
            }`}
          >
            {mfaStatus?.enabled ? t('status.active') : t('status.inactive')}
          </div>
        </div>

        <div className="space-y-3">
          {!mfaStatus?.enabled ? (
            <>
              <button
                onClick={handleEnrollStart}
                disabled={enrolling}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center"
              >
                {enrolling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('actions.enable')}
              </button>
              <p className="text-xs text-gray-500">
                {t('twoFactor.enrollHint')}
              </p>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowDisableModal(true)}
                disabled={disabling}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center"
              >
                {disabling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('actions.disable')}
              </button>
              {mfaStatus?.recoveryCodesRemaining !== undefined && (
                <p className="text-xs text-gray-500">
                  {t('twoFactor.recoveryCodesRemaining', { count: mfaStatus.recoveryCodesRemaining })}
                </p>
              )}
              {recoveryCodes.length > 0 && (
                <button
                  onClick={() => setShowRecoveryCodesModal(true)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t('actions.viewRecoveryCodes')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Enrollment Modal */}
      {showEnrollmentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 sm:max-w-[600px] w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold mb-2">{t('enrollModal.title')}</h2>
            <p className="text-gray-600 text-sm mb-6">
              {t('enrollModal.instructions')}
            </p>

            <div className="space-y-6">
              {/* QR Code */}
              <div className="flex flex-col items-center">
                {qrCode && <img src={qrCode} alt={t('enrollModal.qrCodeAlt')} className="w-64 h-64" />}
              </div>

              {/* Manual Entry */}
              <div className="bg-gray-100 p-4 rounded-lg">
                <p className="text-sm text-gray-600 mb-2">{t('enrollModal.manualEntryPrompt')}</p>
                <code className="text-sm font-mono break-all">{manualSecret}</code>
              </div>

              {/* Recovery Codes */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-amber-900 mb-3">{t('enrollModal.saveRecoveryCodes')}</p>
                <div className="space-y-2">
                  {recoveryCodes.map((code, i) => (
                    <div key={i} className="flex items-center justify-between bg-white p-2 rounded">
                      <code className="text-sm font-mono">{code}</code>
                      <button
                        onClick={() => handleCopyCode(code, i)}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        {copiedIndex === i ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleDownloadRecoveryCodes}
                  className="mt-3 w-full px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-center"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {t('actions.downloadAsText')}
                </button>
              </div>

              {/* TOTP Verification */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('enrollModal.enterCodeLabel')}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowEnrollmentModal(false)}
                  disabled={verifying}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t('actions.cancel')}
                </button>
                <button
                  onClick={handleEnrollVerify}
                  disabled={verifying || totp.length !== 6}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center"
                >
                  {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('actions.verifyAndEnable')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recovery Codes Modal */}
      {showRecoveryCodesModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 sm:max-w-[500px] w-full">
            <h2 className="text-lg font-semibold mb-2">{t('recoveryModal.title')}</h2>
            <p className="text-gray-600 text-sm mb-6">
              {t('recoveryModal.description')}
            </p>

            <div className="space-y-3">
              <button
                onClick={() => setShowCodes(!showCodes)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-center"
              >
                {showCodes ? (
                  <>
                    <EyeOff className="mr-2 h-4 w-4" />
                    {t('actions.hideCodes')}
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    {t('actions.showCodes')}
                  </>
                )}
              </button>

              {showCodes && (
                <div className="bg-gray-100 p-4 rounded-lg space-y-2 max-h-64 overflow-y-auto">
                  {recoveryCodes.map((code, i) => (
                    <div key={i} className="flex items-center justify-between bg-white p-2 rounded">
                      <code className="text-sm font-mono">{code}</code>
                      <button
                        onClick={() => handleCopyCode(code, i)}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        {copiedIndex === i ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleDownloadRecoveryCodes}
                className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-center"
              >
                <Download className="mr-2 h-4 w-4" />
                {t('actions.download')}
              </button>

              <button
                onClick={() => setShowRecoveryCodesModal(false)}
                className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded-md text-sm font-medium hover:bg-gray-300"
              >
                {t('actions.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disable 2FA Modal */}
      {showDisableModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 sm:max-w-[450px] w-full">
            <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              {t('disableModal.title')}
            </h2>
            <p className="text-gray-600 text-sm mb-4">
              {t('disableModal.description')}
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={disableToken}
              onChange={(e) => setDisableToken(e.target.value.replace(/\D/g, ''))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowDisableModal(false); setDisableToken(''); }}
                disabled={disabling}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('actions.cancel')}
              </button>
              <button
                onClick={handleDisableMFA}
                disabled={disabling || disableToken.length !== 6}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center justify-center"
              >
                {disabling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('actions.disable')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
