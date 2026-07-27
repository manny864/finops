'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { ENABLE_AWS_UI } from '@/context/ProviderContext';
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
  Pencil,
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

type TemplateFormat = 'cloudFormation' | 'terraform' | 'cli';

interface AwsOnboardingTemplates {
  platformAccountId: string;
  cloudFormation: string;
  terraform: string;
  cli: string;
}

export default function CloudAccountsPage() {
  const t = useTranslations('AdminCloudAccounts');
  const { selectedTenant, setSelectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [awsAccounts, setAwsAccounts] = useState<AwsAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newExternalId, setNewExternalId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [templates, setTemplates] = useState<AwsOnboardingTemplates | null>(null);
  const [templateFormat, setTemplateFormat] = useState<TemplateFormat>('cloudFormation');
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [form, setForm] = useState({
    accountId: '',
    roleArn: '',
    alias: '',
    curBucket: '',
    curPrefix: '',
    curReportName: '',
  });
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
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
      if (
        Array.isArray(data.accounts) &&
        data.accounts.length > 0 &&
        selectedTenant?.tier === 'Enterprise' &&
        selectedTenant?.provider !== 'both'
      ) {
        setSelectedTenant({ ...selectedTenant, provider: 'both' });
      }
    } catch {
      toast.error(t('errorLoadingAccounts'));
    } finally {
      setLoading(false);
    }
  }, [selectedTenant, setSelectedTenant, authHeaders, t]);

  useEffect(() => { load(); }, [load]);

  /**
   * Plantillas de minimo privilegio para el rol que el cliente debe crear.
   * Se piden al servidor en vez de armarlas aca porque incluyen el account id
   * de la plataforma y el externalId descifrado, que no viven en el cliente.
   */
  const loadTemplates = useCallback(async (awsAccountId: string) => {
    if (!selectedTenant?.id) return;
    setTemplates(null);
    setTemplatesError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/admin/onboarding/aws', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: selectedTenant.id, awsAccountId }),
      });
      const data = await res.json();
      if (!res.ok) {
        // La cuenta ya quedo creada: no poder mostrar la plantilla no invalida
        // el alta, solo obliga a configurar el rol a mano.
        setTemplatesError(data.error || t('templatesError'));
        return;
      }
      setTemplates({
        platformAccountId: data.platformAccountId,
        cloudFormation: data.cloudFormation,
        terraform: data.terraform,
        cli: data.cli
      });
    } catch {
      setTemplatesError(t('templatesError'));
    }
  }, [selectedTenant, authHeaders, t]);

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
      void loadTemplates(data.id);
      toast.success(t('successAccountCreated'));
      setForm({ accountId: '', roleArn: '', alias: '', curBucket: '', curPrefix: '', curReportName: '' });
      if (selectedTenant?.tier === 'Enterprise' && selectedTenant?.provider !== 'both') {
        setSelectedTenant({ ...selectedTenant, provider: 'both' });
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedTenant, setSelectedTenant, form, authHeaders, load, loadTemplates, t]);

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

  const openEditModal = useCallback((acc: AwsAccount) => {
    setEditingAccountId(acc.id);
    setEditForm({
      accountId: acc.account_id,
      roleArn: acc.role_arn,
      alias: acc.alias,
      curBucket: acc.cur_bucket || '',
      curPrefix: acc.cur_prefix || '',
      curReportName: acc.cur_report_name || '',
    });
    setShowEditModal(true);
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!selectedTenant?.id || !editingAccountId) return;
    if (!editForm.accountId || !editForm.roleArn || !editForm.alias) {
      toast.error(t('errorRequiredFields'));
      return;
    }
    setBusy(`edit-${editingAccountId}`);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/aws/accounts/${editingAccountId}?tenantId=${selectedTenant.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: editForm.accountId,
          roleArn: editForm.roleArn,
          alias: editForm.alias,
          curBucket: editForm.curBucket || undefined,
          curPrefix: editForm.curPrefix || undefined,
          curReportName: editForm.curReportName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('errorUpdating'));
        return;
      }
      toast.success(t('successUpdated'));
      setShowEditModal(false);
      setEditingAccountId(null);
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedTenant, editingAccountId, editForm, authHeaders, load, t]);

  const copyExternalId = useCallback(() => {
    if (!newExternalId) return;
    navigator.clipboard.writeText(newExternalId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [newExternalId]);

  const trustPolicy = newExternalId && templates?.platformAccountId
    ? JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: `arn:aws:iam::${templates.platformAccountId}:root` },
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

      {!ENABLE_AWS_UI ? (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8 shadow-sm">
          <div className="flex items-start justify-between mb-6 pb-6 border-b border-gray-100 dark:border-slate-800">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-sky-50 dark:bg-sky-950/50 border border-sky-100 dark:border-sky-900/50 flex items-center justify-center text-sky-600 dark:text-sky-400">
                <Cloud className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  Microsoft Azure Tenant
                  <span className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    Active & Connected
                  </span>
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Conexión directa mediante Azure Resource Graph y Cost Management API
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-100 dark:border-slate-800">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Tenant Organiazación</p>
              <p className="text-base font-bold text-gray-900 dark:text-white truncate">{selectedTenant?.name || 'Default Tenant'}</p>
              <p className="text-xs text-gray-400 font-mono mt-1">{selectedTenant?.id}</p>
            </div>
            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-100 dark:border-slate-800">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Plan / Tier Activo</p>
              <p className="text-base font-bold text-brand-deep dark:text-brand-bright">{selectedTenant?.tier || 'Essential'}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">✓ FinOps Engine Ready</p>
            </div>
            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-100 dark:border-slate-800">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Estado de Ingesta</p>
              <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Sincronización OK
              </p>
              <p className="text-xs text-gray-400 mt-1">Línea de tiempo de costos en tiempo real</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 flex justify-end">
            <button
              onClick={() => { setShowAddModal(true); setNewExternalId(null); setTemplates(null); setTemplatesError(null); }}
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
                      : <span className="text-amber-700" title={t('curSectionWarning')}>{t('curNotConfigured')}</span>}
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
                        onClick={() => openEditModal(acc)}
                        disabled={!!busy}
                        title={t('actionEditTitle')}
                        className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-50"
                      >
                        {busy === `edit-${acc.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4 text-slate-700" />}
                      </button>
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
      </>
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
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">
                    {t('curSectionWarning')}
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
                  {trustPolicy ? (
                    <pre className="px-3 py-2 bg-gray-900 text-green-200 rounded text-xs overflow-x-auto">{trustPolicy}</pre>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
                      {t('platformAwsAccountMissingHint')}
                    </div>
                  )}
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium mb-1">{t('permissionPoliciesLabel')}</label>
                  <p className="text-sm text-gray-600 mb-3">{t('leastPrivilegeIntro')}</p>

                  {templatesError && (
                    <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
                      {templatesError}
                    </div>
                  )}

                  {!templates && !templatesError && (
                    <p className="text-sm text-gray-500">{t('templatesLoading')}</p>
                  )}

                  {templates && (
                    <>
                      <div className="flex gap-2 mb-2" role="tablist">
                        {(['cloudFormation', 'terraform', 'cli'] as TemplateFormat[]).map((fmt) => (
                          <button
                            key={fmt}
                            role="tab"
                            aria-selected={templateFormat === fmt}
                            onClick={() => setTemplateFormat(fmt)}
                            className={`px-3 py-1 text-sm rounded-md border ${templateFormat === fmt
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                          >{t(`templateTab_${fmt}`)}</button>
                        ))}
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(templates[templateFormat]);
                            toast.success(t('templateCopied'));
                          }}
                          className="ml-auto px-3 py-1 text-sm rounded-md border border-gray-300 hover:bg-gray-50 inline-flex items-center gap-1"
                        ><Copy className="h-4 w-4" /> {t('templateCopy')}</button>
                      </div>
                      <pre className="px-3 py-2 bg-gray-900 text-green-200 rounded text-xs overflow-x-auto max-h-72">{templates[templateFormat]}</pre>
                    </>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => { setShowAddModal(false); setNewExternalId(null); setTemplates(null); setTemplatesError(null); }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
                  >{t('closeButton')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 sm:max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold mb-2">{t('editModalTitle')}</h2>
            <p className="text-sm text-gray-600 mb-6">{t('editModalIntro')}</p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-1">{t('fieldAccountId')}</label>
                <input
                  value={editForm.accountId}
                  onChange={e => setEditForm({ ...editForm, accountId: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                  placeholder={t('placeholderAccountId')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fieldAlias')}</label>
                <input
                  value={editForm.alias}
                  onChange={e => setEditForm({ ...editForm, alias: e.target.value })}
                  placeholder={t('placeholderAlias')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">{t('fieldRoleArn')}</label>
                <input
                  value={editForm.roleArn}
                  onChange={e => setEditForm({ ...editForm, roleArn: e.target.value })}
                  placeholder={t('placeholderRoleArn')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                />
              </div>
            </div>

            <div className="border-t pt-4 mb-6">
              <h3 className="text-sm font-semibold mb-2">{t('curSectionTitle')}</h3>
              <div className="grid grid-cols-3 gap-3">
                <input
                  value={editForm.curBucket}
                  onChange={e => setEditForm({ ...editForm, curBucket: e.target.value })}
                  placeholder={t('placeholderCurBucket')}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <input
                  value={editForm.curPrefix}
                  onChange={e => setEditForm({ ...editForm, curPrefix: e.target.value })}
                  placeholder={t('placeholderCurPrefix')}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <input
                  value={editForm.curReportName}
                  onChange={e => setEditForm({ ...editForm, curReportName: e.target.value })}
                  placeholder={t('placeholderCurReportName')}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowEditModal(false); setEditingAccountId(null); }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50"
              >
                {t('cancelButton')}
              </button>
              <button
                onClick={handleUpdate}
                disabled={busy === `edit-${editingAccountId}`}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center"
              >
                {busy === `edit-${editingAccountId}` && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {t('updateButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
