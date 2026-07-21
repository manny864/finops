'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import {
  Cloud,
  Plus,
  Loader2,
  Trash2,
  PlayCircle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

interface AwsAccount {
  id: string;
  account_id: string;
  role_arn: string;
  alias: string;
  cur_bucket: string | null;
  cur_prefix: string | null;
  cur_report_name: string | null;
  last_sync_at: string | null;
  sync_status: 'OK' | 'ERROR' | 'SYNCING' | 'NEVER';
  last_error_message: string | null;
  created_at: string;
}

const PLATFORM_AWS_ACCOUNT = process.env.NEXT_PUBLIC_AWS_PLATFORM_ACCOUNT_ID || '<YOUR_PLATFORM_AWS_ACCOUNT_ID>';

export default function CloudAccountsPage() {
  const t = useTranslations('AdminCloudAccounts');
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [awsAccounts, setAwsAccounts] = useState<AwsAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newExternalId, setNewExternalId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    accountId: '',
    roleArn: '',
    alias: '',
    curBucket: '',
    curPrefix: '',
    curReportName: '',
  });

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!accounts || accounts.length === 0) return {};
    const token = await getFreshIdToken(instance, accounts[0]);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [instance, accounts]);

  const load = useCallback(async () => {
    if (!selectedTenant?.id) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/aws/accounts?tenantId=${selectedTenant.id}`, { headers });
      if (!res.ok) {
        const e = await res.json();
        toast.error(e.error || t('errorLoadingAccounts'));
        setAwsAccounts([]);
        return;
      }
      const data = await res.json();
      setAwsAccounts(data.accounts || []);
    } catch {
      toast.error(t('errorLoadingAccounts'));
    } finally {
      setLoading(false);
    }
  }, [selectedTenant, authHeaders, t]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = useCallback(async () => {
    if (!selectedTenant?.id) return;
    if (!form.accountId || !form.roleArn || !form.alias) {
      toast.error(t('errorRequiredFields'));
      return;
    }
    setBusy('create');
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/aws/accounts', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          accountId: form.accountId,
          roleArn: form.roleArn,
          alias: form.alias,
          curBucket: form.curBucket || undefined,
          curPrefix: form.curPrefix || undefined,
          curReportName: form.curReportName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('errorCreatingAccount'));
        return;
      }
      setNewExternalId(data.externalId);
      toast.success(t('successAccountCreated'));
      setForm({ accountId: '', roleArn: '', alias: '', curBucket: '', curPrefix: '', curReportName: '' });
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedTenant, form, authHeaders, load, t]);

  const handleTest = useCallback(async (acc: AwsAccount) => {
    if (!selectedTenant?.id) return;
    setBusy(`test-${acc.id}`);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/aws/accounts/${acc.id}/test?tenantId=${selectedTenant.id}`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('testFailed'));
      } else {
        toast.success(t('testSuccess', { amount: (data.totalCost ?? 0).toFixed(2), rows: data.rowCount ?? 0 }));
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedTenant, authHeaders, load, t]);

  const handleSync = useCallback(async (acc: AwsAccount, source: 'ce' | 'cur') => {
    if (!selectedTenant?.id) return;
    setBusy(`sync-${source}-${acc.id}`);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/sync/aws/${acc.id}/${source}?tenantId=${selectedTenant.id}&days=30`,
        { method: 'POST', headers }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('syncFailed', { source: source.toUpperCase() }));
      } else {
        toast.success(t('syncSuccess', { source: source.toUpperCase(), rows: data.rowsUpserted ?? 0 }));
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedTenant, authHeaders, load, t]);

  const handleDelete = useCallback(async (acc: AwsAccount) => {
    if (!selectedTenant?.id) return;
    if (!confirm(t('confirmDelete', { accountId: acc.account_id, alias: acc.alias }))) return;
    setBusy(`del-${acc.id}`);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/aws/accounts/${acc.id}?tenantId=${selectedTenant.id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const e = await res.json();
        toast.error(e.error || t('errorDeleting'));
      } else {
        toast.success(t('successDeleted'));
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedTenant, authHeaders, load, t]);

  const copyExternalId = useCallback(() => {
    if (!newExternalId) return;
    navigator.clipboard.writeText(newExternalId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [newExternalId]);

  const trustPolicy = newExternalId
    ? JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: `arn:aws:iam::${PLATFORM_AWS_ACCOUNT}:root` },
            Action: 'sts:AssumeRole',
            Condition: { StringEquals: { 'sts:ExternalId': newExternalId } },
          },
        ],
      }, null, 2)
    : '';

  const renderStatus = (s: AwsAccount['sync_status']) => {
    const map: Record<AwsAccount['sync_status'], { color: string; label: string; icon: React.ReactNode }> = {
      OK: { color: 'bg-green-100 text-green-800', label: t('statusOk'), icon: <CheckCircle2 className="h-3 w-3" /> },
      ERROR: { color: 'bg-red-100 text-red-800', label: t('statusError'), icon: <XCircle className="h-3 w-3" /> },
      SYNCING: { color: 'bg-blue-100 text-blue-800', label: t('statusSyncing'), icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      NEVER: { color: 'bg-gray-100 text-gray-800', label: t('statusNever'), icon: <AlertCircle className="h-3 w-3" /> },
    };
    const m = map[s];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m.color}`}>
        {m.icon}{m.label}
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Cloud className="h-8 w-8" />
          {t('pageTitle')}
        </h1>
        <p className="text-gray-600 mt-2">
          {t('pageSubtitle')}
        </p>
      </div>

      <div className="mb-6 flex justify-end">
        <button
          onClick={() => { setShowAddModal(true); setNewExternalId(null); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 flex items-center"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('connectButton')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
      ) : awsAccounts.length === 0 ? (
        <div className="bg-white rounded-lg border border-dashed border-gray-300 p-12 text-center">
          <Cloud className="h-12 w-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{t('emptyState')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('tableAccount')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('tableRoleArn')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('tableCur')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('tableStatus')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('tableLastSync')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('tableActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {awsAccounts.map(acc => (
                <tr key={acc.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{acc.alias}</div>
                    <div className="text-xs text-gray-500 font-mono">{acc.account_id}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 font-mono break-all max-w-xs">{acc.role_arn}</td>
                  <td className="px-4 py-3 text-xs">
                    {acc.cur_bucket
                      ? <span className="text-green-700">s3://{acc.cur_bucket}/{acc.cur_prefix}/{acc.cur_report_name}</span>
                      : <span className="text-gray-400">{t('curNotConfigured')}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {renderStatus(acc.sync_status)}
                    {acc.last_error_message && (
                      <div className="text-xs text-red-600 mt-1 max-w-xs truncate" title={acc.last_error_message}>
                        {acc.last_error_message}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {acc.last_sync_at ? new Date(acc.last_sync_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => handleTest(acc)}
                        disabled={!!busy}
                        title={t('actionTestTitle')}
                        className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-50"
                      >
                        {busy === `test-${acc.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4 text-blue-600" />}
                      </button>
                      <button
                        onClick={() => handleSync(acc, 'ce')}
                        disabled={!!busy}
                        title={t('actionSyncCeTitle')}
                        className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-50"
                      >
                        {busy === `sync-ce-${acc.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 text-green-600" />}
                      </button>
                      {acc.cur_bucket && (
                        <button
                          onClick={() => handleSync(acc, 'cur')}
                          disabled={!!busy}
                          title={t('actionSyncCurTitle')}
                          className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-50 text-xs"
                        >
                          {busy === `sync-cur-${acc.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-purple-600 font-bold">CUR</span>}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(acc)}
                        disabled={!!busy}
                        title={t('actionDeleteTitle')}
                        className="p-1.5 hover:bg-red-50 rounded disabled:opacity-50"
                      >
                        {busy === `del-${acc.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 sm:max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold mb-2">{t('modalTitle')}</h2>

            {!newExternalId ? (
              <>
                <p className="text-sm text-gray-600 mb-6">
                  {t('modalIntro')}
                </p>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('fieldAccountId')}</label>
                    <input
                      value={form.accountId}
                      onChange={e => setForm({...form, accountId: e.target.value.replace(/\D/g, '').slice(0, 12)})}
                      placeholder={t('placeholderAccountId')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('fieldAlias')}</label>
                    <input
                      value={form.alias}
                      onChange={e => setForm({...form, alias: e.target.value})}
                      placeholder={t('placeholderAlias')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">{t('fieldRoleArn')}</label>
                    <input
                      value={form.roleArn}
                      onChange={e => setForm({...form, roleArn: e.target.value})}
                      placeholder={t('placeholderRoleArn')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t('roleArnHelpPrefix')} <code className="bg-gray-100 px-1 rounded">arn:aws:iam::aws:policy/job-function/Billing</code> {t('roleArnHelpSuffix')}
                    </p>
                  </div>
                </div>
                <div className="border-t pt-4 mb-6">
                  <h3 className="text-sm font-semibold mb-2">{t('curSectionTitle')}</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    {t('curSectionSubtitle')}
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <input
                      value={form.curBucket}
                      onChange={e => setForm({...form, curBucket: e.target.value})}
                      placeholder={t('placeholderCurBucket')}
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                    <input
                      value={form.curPrefix}
                      onChange={e => setForm({...form, curPrefix: e.target.value})}
                      placeholder={t('placeholderCurPrefix')}
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                    <input
                      value={form.curReportName}
                      onChange={e => setForm({...form, curReportName: e.target.value})}
                      placeholder={t('placeholderCurReportName')}
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50"
                  >{t('cancelButton')}</button>
                  <button
                    onClick={handleCreate}
                    disabled={busy === 'create'}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center"
                  >
                    {busy === 'create' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    {t('createButton')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4">
                  <p className="text-sm font-semibold text-amber-900">{t('successStepTitle')}</p>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">{t('externalIdLabel')}</label>
                  <div className="flex gap-2">
                    <code className="flex-1 px-3 py-2 bg-gray-100 rounded font-mono text-sm break-all">{newExternalId}</code>
                    <button onClick={copyExternalId} className="p-2 hover:bg-gray-200 rounded">
                      {copied ? <Check className="h-5 w-5 text-green-600" /> : <Copy className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">{t('trustPolicyLabel')}</label>
                  <pre className="px-3 py-2 bg-gray-900 text-green-200 rounded text-xs overflow-x-auto">{trustPolicy}</pre>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium mb-1">{t('permissionPoliciesLabel')}</label>
                  <ul className="text-sm text-gray-700 list-disc ml-5 space-y-1">
                    <li><code className="bg-gray-100 px-1 rounded">arn:aws:iam::aws:policy/job-function/Billing</code> {t('policyBillingNote')}</li>
                    <li><code className="bg-gray-100 px-1 rounded">arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess</code> {t('policyEc2Note')}</li>
                    <li>{t('policyS3OptionalPrefix')} <code className="bg-gray-100 px-1 rounded">AmazonS3ReadOnlyAccess</code> {t('policyS3OptionalSuffix')}</li>
                  </ul>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => { setShowAddModal(false); setNewExternalId(null); }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
                  >{t('closeButton')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
