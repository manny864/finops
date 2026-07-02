'use client';

import React, { useCallback, useEffect, useState } from 'react';
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
        toast.error(e.error || 'Error cargando cuentas AWS');
        setAwsAccounts([]);
        return;
      }
      const data = await res.json();
      setAwsAccounts(data.accounts || []);
    } catch {
      toast.error('Error cargando cuentas AWS');
    } finally {
      setLoading(false);
    }
  }, [selectedTenant, authHeaders]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = useCallback(async () => {
    if (!selectedTenant?.id) return;
    if (!form.accountId || !form.roleArn || !form.alias) {
      toast.error('Account ID, Role ARN y Alias son obligatorios');
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
        toast.error(data.error || 'Error creando cuenta');
        return;
      }
      setNewExternalId(data.externalId);
      toast.success('Cuenta AWS creada. Copia el External ID y configura tu Role en AWS.');
      setForm({ accountId: '', roleArn: '', alias: '', curBucket: '', curPrefix: '', curReportName: '' });
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedTenant, form, authHeaders, load]);

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
        toast.error(data.error || 'Test falló');
      } else {
        toast.success(`Test OK: $${(data.totalCost ?? 0).toFixed(2)} en últimos 7 días (${data.rowCount ?? 0} filas)`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedTenant, authHeaders, load]);

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
        toast.error(data.error || `Sync ${source.toUpperCase()} falló`);
      } else {
        toast.success(`Sync ${source.toUpperCase()} OK: ${data.rowsUpserted ?? 0} filas upserted`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedTenant, authHeaders, load]);

  const handleDelete = useCallback(async (acc: AwsAccount) => {
    if (!selectedTenant?.id) return;
    if (!confirm(`¿Eliminar cuenta AWS ${acc.account_id} (${acc.alias})? Los datos en CostSnapshots no se borran.`)) return;
    setBusy(`del-${acc.id}`);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/aws/accounts/${acc.id}?tenantId=${selectedTenant.id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const e = await res.json();
        toast.error(e.error || 'Error eliminando');
      } else {
        toast.success('Cuenta eliminada');
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedTenant, authHeaders, load]);

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
      OK: { color: 'bg-green-100 text-green-800', label: 'OK', icon: <CheckCircle2 className="h-3 w-3" /> },
      ERROR: { color: 'bg-red-100 text-red-800', label: 'Error', icon: <XCircle className="h-3 w-3" /> },
      SYNCING: { color: 'bg-blue-100 text-blue-800', label: 'Syncing', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      NEVER: { color: 'bg-gray-100 text-gray-800', label: 'Nunca', icon: <AlertCircle className="h-3 w-3" /> },
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
          Cloud Accounts — AWS
        </h1>
        <p className="text-gray-600 mt-2">
          Conectá cuentas AWS via IAM Role assume-role + External ID. Opcionalmente activá ingesta de CUR
          (Cost &amp; Usage Report) desde S3 para máxima fidelidad.
        </p>
      </div>

      <div className="mb-6 flex justify-end">
        <button
          onClick={() => { setShowAddModal(true); setNewExternalId(null); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 flex items-center"
        >
          <Plus className="h-4 w-4 mr-2" />
          Conectar cuenta AWS
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
      ) : awsAccounts.length === 0 ? (
        <div className="bg-white rounded-lg border border-dashed border-gray-300 p-12 text-center">
          <Cloud className="h-12 w-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Aún no hay cuentas AWS conectadas.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role ARN</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CUR</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Último sync</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
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
                      : <span className="text-gray-400">no configurado</span>}
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
                        title="Test connection"
                        className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-50"
                      >
                        {busy === `test-${acc.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4 text-blue-600" />}
                      </button>
                      <button
                        onClick={() => handleSync(acc, 'ce')}
                        disabled={!!busy}
                        title="Sync via Cost Explorer (30d)"
                        className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-50"
                      >
                        {busy === `sync-ce-${acc.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 text-green-600" />}
                      </button>
                      {acc.cur_bucket && (
                        <button
                          onClick={() => handleSync(acc, 'cur')}
                          disabled={!!busy}
                          title="Sync via CUR S3 (último periodo)"
                          className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-50 text-xs"
                        >
                          {busy === `sync-cur-${acc.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-purple-600 font-bold">CUR</span>}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(acc)}
                        disabled={!!busy}
                        title="Eliminar"
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
            <h2 className="text-xl font-semibold mb-2">Conectar cuenta AWS</h2>

            {!newExternalId ? (
              <>
                <p className="text-sm text-gray-600 mb-6">
                  Completá los datos. Al crear, te daremos el External ID para configurar la confianza del Role en AWS.
                </p>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium mb-1">AWS Account ID (12 dígitos) *</label>
                    <input
                      value={form.accountId}
                      onChange={e => setForm({...form, accountId: e.target.value.replace(/\D/g, '').slice(0, 12)})}
                      placeholder="123456789012"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Alias *</label>
                    <input
                      value={form.alias}
                      onChange={e => setForm({...form, alias: e.target.value})}
                      placeholder="prod-us-east"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">Role ARN *</label>
                    <input
                      value={form.roleArn}
                      onChange={e => setForm({...form, roleArn: e.target.value})}
                      placeholder="arn:aws:iam::123456789012:role/FinOpsReader"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Necesita la policy AWS managed <code className="bg-gray-100 px-1 rounded">arn:aws:iam::aws:policy/job-function/Billing</code> (Cost Explorer)
                      + opcionalmente S3 ReadOnly al bucket de CUR.
                    </p>
                  </div>
                </div>
                <div className="border-t pt-4 mb-6">
                  <h3 className="text-sm font-semibold mb-2">CUR S3 (opcional)</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Si activaste un Cost &amp; Usage Report en formato Parquet, completá estos campos para ingesta de alta fidelidad.
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <input
                      value={form.curBucket}
                      onChange={e => setForm({...form, curBucket: e.target.value})}
                      placeholder="bucket (e.g. acme-cur)"
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                    <input
                      value={form.curPrefix}
                      onChange={e => setForm({...form, curPrefix: e.target.value})}
                      placeholder="prefix (e.g. cur/)"
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                    <input
                      value={form.curReportName}
                      onChange={e => setForm({...form, curReportName: e.target.value})}
                      placeholder="report name"
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50"
                  >Cancelar</button>
                  <button
                    onClick={handleCreate}
                    disabled={busy === 'create'}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center"
                  >
                    {busy === 'create' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Crear cuenta
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4">
                  <p className="text-sm font-semibold text-amber-900">¡Cuenta creada! Configurá ahora el IAM Role en AWS:</p>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">External ID (necesario para el Trust Policy)</label>
                  <div className="flex gap-2">
                    <code className="flex-1 px-3 py-2 bg-gray-100 rounded font-mono text-sm break-all">{newExternalId}</code>
                    <button onClick={copyExternalId} className="p-2 hover:bg-gray-200 rounded">
                      {copied ? <Check className="h-5 w-5 text-green-600" /> : <Copy className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">Trust Policy para el Role</label>
                  <pre className="px-3 py-2 bg-gray-900 text-green-200 rounded text-xs overflow-x-auto">{trustPolicy}</pre>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium mb-1">Permission Policies a adjuntar</label>
                  <ul className="text-sm text-gray-700 list-disc ml-5 space-y-1">
                    <li><code className="bg-gray-100 px-1 rounded">arn:aws:iam::aws:policy/job-function/Billing</code> (Cost Explorer + Budgets)</li>
                    <li><code className="bg-gray-100 px-1 rounded">arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess</code> (resource discovery)</li>
                    <li>Opcional: <code className="bg-gray-100 px-1 rounded">AmazonS3ReadOnlyAccess</code> al bucket de CUR (preferí policy custom limitada al bucket).</li>
                  </ul>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => { setShowAddModal(false); setNewExternalId(null); }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
                  >Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
