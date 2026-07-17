"use client";
import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import { toast } from 'sonner';
import { useActionLogStore } from '@/store/actionLogStore';
import { Clock, CheckCircle, Trash2, AlertCircle, Plus, X, Tag, History, ShieldCheck, Bell, Loader2 } from "lucide-react";
import MockBanner from '@/components/MockBanner';
import Pagination, { usePagination } from '@/components/Pagination';
import { canDeleteResources } from '@/lib/tierLogic';
import EnterpriseDeleteDisclaimer from '@/components/EnterpriseDeleteDisclaimer';

const TTL_RESOURCE_TYPES = [
  'microsoft.compute/virtualmachines',
  'microsoft.containerservice/managedclusters',
  'microsoft.dbforpostgresql/flexibleservers',
  'microsoft.dbformysql/flexibleservers',
  'microsoft.cache/redis',
  'microsoft.storage/storageaccounts',
  'microsoft.network/virtualnetworks',
  'microsoft.resources/subscriptions/resourcegroups',
  'microsoft.web/serverfarms',
];

function typeLabel(type: string) {
  return type?.split('/').pop() || type;
}

type Policy = { id: number; name: string; resourceType: string; daysToLive: number; description?: string | null; enabled: boolean; createdBy?: string | null; createdAt: string };
type UnlabeledResource = { id: string; name: string; type: string; resourceGroup: string; subscriptionId: string; tags: Record<string, string>; suggestedExpiration: string };
type Deletion = { id: number; resourceId: string; resourceName: string; resourceType: string; resourceGroup: string; expirationDate: string; deletedBy: string; deletedAt: string };

export default function TtlCleanupPage() {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const { addAction } = useActionLogStore();

  // Sección "Entornos por Expiración" (ya existente)
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Sección "Políticas TTL"
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [deletingPolicyId, setDeletingPolicyId] = useState<number | null>(null);
  const [policyForm, setPolicyForm] = useState({ name: "", resourceType: TTL_RESOURCE_TYPES[0], daysToLive: "14", description: "" });

  // Sección "Recursos sin etiquetar"
  const [unlabeled, setUnlabeled] = useState<UnlabeledResource[]>([]);
  const [unlabeledLoading, setUnlabeledLoading] = useState(false);
  const [taggingId, setTaggingId] = useState<string | null>(null);

  // Sección "Histórico de Eliminaciones"
  const [history, setHistory] = useState<Deletion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const { page, setPage, pageSize, setPageSize, total, totalPages, paged: pagedResources } = usePagination(resources);
  const { paged: pagedUnlabeled, ...unlabeledPagination } = usePagination(unlabeled, 10);
  const { paged: pagedHistory, ...historyPagination } = usePagination(history, 10);

  const fetchExpired = useCallback(async () => {
    if (!selectedTenant || selectedTenant.id === 'default') return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchWithAuthRetry(instance, accounts[0], '/api/cleanup/ttl', {
        headers: { 'x-tenant-id': selectedTenant.id }
      });
      const json = await res.json();
      if (json.success) {
        setResources(Array.isArray(json.data) ? json.data : []);
      } else {
        setError(json.error || "Error al obtener recursos expirados");
      }
    } catch (e) {
      setError("Error de red");
    }
    setLoading(false);
  }, [selectedTenant, instance, accounts]);

  const fetchPolicies = useCallback(async () => {
    if (!selectedTenant || selectedTenant.id === 'default') return;
    setPoliciesLoading(true);
    try {
      const res = await fetchWithAuthRetry(instance, accounts[0], `/api/cleanup/ttl/policies?tenantId=${selectedTenant.id}`);
      const json = await res.json();
      if (json.success) setPolicies(Array.isArray(json.policies) ? json.policies : []);
    } catch (e) {
      // silencioso: la sección de expiración es la crítica, esta es complementaria
    }
    setPoliciesLoading(false);
  }, [selectedTenant, instance, accounts]);

  const fetchUnlabeled = useCallback(async () => {
    if (!selectedTenant || selectedTenant.id === 'default') return;
    setUnlabeledLoading(true);
    try {
      const res = await fetchWithAuthRetry(instance, accounts[0], `/api/cleanup/ttl/unlabeled?tenantId=${selectedTenant.id}`);
      const json = await res.json();
      if (json.success) setUnlabeled(Array.isArray(json.resources) ? json.resources : []);
    } catch (e) {
      // silencioso
    }
    setUnlabeledLoading(false);
  }, [selectedTenant, instance, accounts]);

  const fetchHistory = useCallback(async () => {
    if (!selectedTenant || selectedTenant.id === 'default') return;
    setHistoryLoading(true);
    try {
      const res = await fetchWithAuthRetry(instance, accounts[0], `/api/cleanup/ttl/history?tenantId=${selectedTenant.id}`);
      const json = await res.json();
      if (json.success) setHistory(Array.isArray(json.deletions) ? json.deletions : []);
    } catch (e) {
      // silencioso
    }
    setHistoryLoading(false);
  }, [selectedTenant, instance, accounts]);

  useEffect(() => {
    fetchExpired();
    fetchPolicies();
    fetchUnlabeled();
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenant?.id]);

  const handleDelete = async (resourceId: string, subscriptionId: string, type: string, resourceName?: string, resourceGroup?: string, expirationDate?: string) => {
    if (!confirm("¿Está seguro de que desea eliminar permanentemente este recurso de Azure?")) return;

    setDeletingId(resourceId);
    try {
      const res = await fetchWithAuthRetry(instance, accounts[0], '/api/remediation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': selectedTenant.id },
        body: JSON.stringify({
          action: 'delete', resourceId, subscriptionId, resourceType: type, domain: 'ttl',
          resourceName, resourceGroup, expirationDate,
        })
      });

      const json = await res.json();
      if (json.success) {
        setResources(prev => prev.filter(r => r.id !== resourceId));
        toast.success('Entorno Destruido');
        addAction({ message: `Entorno TTL expirado destruido exitosamente.`, status: 'success' });
        fetchHistory();
      } else if (json.error === 'MISSING_CONTRIBUTOR_ROLE') {
        toast.error('¡Operación Denegada!', { description: 'La eliminación de recursos requiere el plan Enterprise (tu Service Principal no tiene el rol de Azure necesario).' });
        addAction({ message: `Fallo de permisos al borrar entorno TTL. Requiere plan Enterprise.`, status: 'error' });
      } else {
        toast.error('Error al eliminar', { description: json.error });
        addAction({ message: `Fallo al eliminar entorno TTL: ${resourceId}`, status: 'error' });
      }
    } catch (e) {
      toast.error('Error de red al intentar eliminar');
      addAction({ message: `Error de red eliminando entorno TTL.`, status: 'error' });
    }
    setDeletingId(null);
  };

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setSavingPolicy(true);
    try {
      const res = await fetchWithAuthRetry(instance, accounts[0], `/api/cleanup/ttl/policies?tenantId=${selectedTenant.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          name: policyForm.name,
          resourceType: policyForm.resourceType,
          daysToLive: parseInt(policyForm.daysToLive, 10),
          description: policyForm.description,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Política TTL creada.');
        setShowPolicyModal(false);
        setPolicyForm({ name: "", resourceType: TTL_RESOURCE_TYPES[0], daysToLive: "14", description: "" });
        fetchPolicies();
        fetchUnlabeled();
      } else {
        toast.error('No se pudo crear la política', { description: json.error });
      }
    } catch (e) {
      toast.error('Error de red al crear la política');
    }
    setSavingPolicy(false);
  };

  const handleDeletePolicy = async (id: number) => {
    if (!selectedTenant) return;
    if (!confirm("¿Eliminar esta política TTL? No afecta las etiquetas ya aplicadas.")) return;
    setDeletingPolicyId(id);
    try {
      await fetchWithAuthRetry(instance, accounts[0], `/api/cleanup/ttl/policies?tenantId=${selectedTenant.id}&id=${id}`, { method: 'DELETE' });
      setPolicies(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      toast.error('Error de red al eliminar la política');
    }
    setDeletingPolicyId(null);
  };

  const handleTagResource = async (resource: UnlabeledResource) => {
    if (!selectedTenant) return;
    setTaggingId(resource.id);
    try {
      const res = await fetchWithAuthRetry(instance, accounts[0], '/api/tags/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          resourceId: resource.id,
          tags: { ExpireOn: resource.suggestedExpiration },
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`${resource.name} etiquetado — expira el ${resource.suggestedExpiration}.`);
        setUnlabeled(prev => prev.filter(r => r.id !== resource.id));
        fetchExpired();
      } else {
        toast.error('No se pudo etiquetar el recurso', { description: json.error || json.details });
      }
    } catch (e) {
      toast.error('Error de red al etiquetar el recurso');
    }
    setTaggingId(null);
  };

  if (!selectedTenant || selectedTenant.id === 'default') return null;

  const canDelete = canDeleteResources(selectedTenant.tier, 'ttl');

  return (
    <div className="content animate-in fade-in duration-500 space-y-6">
      <div className="vhead">
        <div>
          <div className="vt">
            <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">⏳</span>
            Time-To-Live (TTL) Enforcement
          </div>
          <div className="vs">Control de entornos efímeros (sandboxes, ambientes de prueba) con fecha de expiración.</div>
        </div>
        <div className="right">
          <span className="scopechip">📍 {selectedTenant?.name || "Tenant"}</span>
        </div>
      </div>
      <MockBanner />
      {!canDelete && <EnterpriseDeleteDisclaimer domain="ttl" />}

      {/* 1. Políticas TTL */}
      <div className="card">
        <div className="card-h flex items-center justify-between">
          <h3 className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Políticas TTL</h3>
          <button
            onClick={() => setShowPolicyModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-deep hover:brightness-110 text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Crear Política
          </button>
        </div>
        <div className="p-[18px]">
          <p className="text-xs text-ink-soft mb-3">Definí qué tipos de recurso son entornos efímeros y cuántos días viven — se usa para sugerir la fecha de expiración al etiquetar recursos existentes.</p>
          {policiesLoading ? (
            <div className="text-sm text-ink-soft py-4 text-center">Cargando políticas…</div>
          ) : policies.length === 0 ? (
            <div className="text-sm text-ink-soft py-4 text-center">No hay políticas TTL configuradas todavía.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Tipo de recurso</th>
                    <th>Días de vida</th>
                    <th>Descripción</th>
                    <th className="num">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map(p => (
                    <tr key={p.id}>
                      <td className="font-bold text-ink">{p.name}</td>
                      <td><span className="tag grey font-mono">{typeLabel(p.resourceType)}</span></td>
                      <td>{p.daysToLive} días</td>
                      <td className="text-ink-soft max-w-[280px] truncate" title={p.description || ''}>{p.description || '—'}</td>
                      <td className="num">
                        <button
                          onClick={() => handleDeletePolicy(p.id)}
                          disabled={deletingPolicyId === p.id}
                          className="p-1.5 rounded text-danger hover:bg-danger-soft disabled:opacity-50 transition-colors"
                        >
                          {deletingPolicyId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 2. Recursos sin etiquetar */}
      {unlabeled.length > 0 && (
        <div className="card">
          <div className="card-h">
            <h3 className="flex items-center gap-2"><Tag className="w-4 h-4" /> Recursos sin etiquetar ({unlabeled.length})</h3>
          </div>
          <div className="p-[18px]">
            <p className="text-xs text-ink-soft mb-3">Recursos que coinciden con una política TTL activa pero todavía no tienen la etiqueta <code className="font-mono">ExpireOn</code>. Etiquetalos para que empiecen a monitorearse.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nombre del Recurso</th>
                  <th>Tipo</th>
                  <th>Grupo de Recursos</th>
                  <th>Expiración sugerida</th>
                  <th className="num">Acción</th>
                </tr>
              </thead>
              <tbody>
                {pagedUnlabeled.map((r) => (
                  <tr key={r.id}>
                    <td className="font-bold text-ink">{r.name}</td>
                    <td><span className="tag grey font-mono">{typeLabel(r.type)}</span></td>
                    <td className="text-ink-soft">{r.resourceGroup}</td>
                    <td className="text-ink-soft">{r.suggestedExpiration}</td>
                    <td className="num">
                      <button
                        onClick={() => handleTagResource(r)}
                        disabled={taggingId === r.id}
                        className="bg-brand-deep text-white hover:brightness-110 px-[11px] py-[7px] rounded-[10px] text-[12px] font-heading font-semibold shadow-sm transition-all disabled:opacity-50 inline-flex items-center gap-[6px]"
                      >
                        {taggingId === r.id ? 'Etiquetando…' : <><Tag className="w-3.5 h-3.5" /> Etiquetar</>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...unlabeledPagination} />
        </div>
      )}

      {/* 3. Alertas — reusa el motor de Alertas Self-Service */}
      <div className="card">
        <div className="p-[18px] flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-brand-deep shrink-0" />
            <div>
              <div className="font-bold text-ink text-sm">Alertas antes de la eliminación automática</div>
              <div className="text-xs text-ink-soft">Configurá una regla tipo &quot;Expiración TTL&quot; para que te avisen X días antes de que un entorno expire.</div>
            </div>
          </div>
          <Link href="/intelligence/alerts" className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-line hover:bg-surface-2 text-ink transition-colors whitespace-nowrap">
            Configurar alertas →
          </Link>
        </div>
      </div>

      {error && (
        <div className="card">
          <div className="card-h">
            <h3 className="text-danger">⚠️ Permisos Restringidos</h3>
          </div>
          <div className="p-[18px]">
            <div className="text-sm text-ink-soft">
              <p>Azure Resource Graph ha bloqueado la lectura. Razones comunes:</p>
              <ul className="list-disc pl-5 mt-2 space-y-1 text-ink">
                <li>Falta el rol de <strong>Reader</strong>.</li>
                <li>La suscripción no existe.</li>
              </ul>
              <div className="mt-4 p-3 bg-danger-soft rounded border border-line font-mono text-xs text-danger break-all">
                <strong>Log técnico:</strong> {error}
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="empty">
          <Clock className="w-10 h-10 mx-auto text-brand-deep mb-4 animate-bounce" />
          <p className="text-ink-soft font-bold">Buscando etiquetas ExpireOn o TTL...</p>
        </div>
      )}

      {!loading && !error && resources.length === 0 && (
        <div className="empty">
          <CheckCircle className="w-16 h-16 mx-auto text-green mb-4" />
          <h3 className="text-xl font-bold text-green">Excelente.</h3>
          <p className="text-green mt-2 max-w-lg mx-auto">Todos los entornos de desarrollo están dentro de su ciclo de vida útil. No hay recursos expirados.</p>
        </div>
      )}

      {!loading && resources.length > 0 && (
        <div className="card">
          <div className="card-h">
            <h3>⏳ Entornos de Desarrollo por Expiración</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nombre del Recurso</th>
                  <th>Tipo</th>
                  <th>Grupo de Recursos</th>
                  <th>Fecha de Expiración</th>
                  <th style={{ textAlign: 'center' }}>Estado</th>
                  <th className="num">Acción</th>
                </tr>
              </thead>
              <tbody>
                {pagedResources.map((r, idx) => {
                  const typeName = r.type?.split('/').pop() || r.type;
                  return (
                    <tr key={`${r.id}-${idx}`}>
                      <td>
                        <div className="font-bold text-ink">{r.name}</div>
                      </td>
                      <td>
                        <span className="tag grey font-mono">{typeName}</span>
                      </td>
                      <td className="text-ink-soft">{r.resourceGroup}</td>
                      <td>
                        <div className="text-danger font-bold flex items-center gap-[6px]">
                          <Clock className="w-4 h-4" />
                          {r.expirationDate}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`tag ${r.ttlStatus === 'Active' ? 'green' :
                            r.ttlStatus === 'Warning' ? 'amber' :
                              'red'
                          }`}>
                          {r.ttlStatus || 'Desconocido'}
                        </span>
                      </td>
                      <td className="num">
                        {canDelete ? (
                          <button
                            onClick={() => handleDelete(r.id, r.subscriptionId, r.type, r.name, r.resourceGroup, r.expirationDate)}
                            disabled={deletingId === r.id || r.ttlStatus === 'Active'}
                            className={`${r.ttlStatus === 'Active' ? 'bg-surface-2 text-grey' : 'bg-danger text-white hover:brightness-110'} px-[11px] py-[7px] rounded-[10px] text-[12px] font-heading font-semibold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-[6px]`}
                          >
                            {deletingId === r.id ? (
                              'Eliminando...'
                            ) : (
                              <>
                                <Trash2 className="w-3.5 h-3.5" />
                                Eliminar
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="tag grey" title="La eliminación de recursos requiere el plan Enterprise">Enterprise</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
        </div>
      )}

      {/* 4. Histórico de Eliminaciones */}
      <div className="card">
        <div className="card-h">
          <h3 className="flex items-center gap-2"><History className="w-4 h-4" /> Histórico de Eliminaciones</h3>
        </div>
        <div className="p-[18px]">
          {historyLoading ? (
            <div className="text-sm text-ink-soft py-4 text-center">Cargando histórico…</div>
          ) : history.length === 0 ? (
            <div className="text-sm text-ink-soft py-4 text-center">Todavía no se eliminó ningún entorno por TTL.</div>
          ) : null}
        </div>
        {history.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nombre del Recurso</th>
                    <th>Tipo</th>
                    <th>Grupo de Recursos</th>
                    <th>Expiraba el</th>
                    <th>Eliminado por</th>
                    <th>Eliminado el</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedHistory.map(d => (
                    <tr key={d.id}>
                      <td className="font-bold text-ink">{d.resourceName || d.resourceId}</td>
                      <td><span className="tag grey font-mono">{typeLabel(d.resourceType)}</span></td>
                      <td className="text-ink-soft">{d.resourceGroup}</td>
                      <td className="text-ink-soft">{d.expirationDate}</td>
                      <td className="text-ink-soft">{d.deletedBy}</td>
                      <td className="text-ink-soft">{new Date(d.deletedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...historyPagination} />
          </>
        )}
      </div>

      {/* Modal crear política */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-brand-deep" /> Crear Política TTL
              </h2>
              <button onClick={() => setShowPolicyModal(false)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreatePolicy} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Nombre</label>
                <input
                  type="text" required value={policyForm.name}
                  onChange={(e) => setPolicyForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  placeholder="Ej: VMs de desarrollo"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Tipo de recurso</label>
                  <select
                    value={policyForm.resourceType}
                    onChange={(e) => setPolicyForm(f => ({ ...f, resourceType: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {TTL_RESOURCE_TYPES.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Días de vida</label>
                  <input
                    type="number" required min={1} max={3650} value={policyForm.daysToLive}
                    onChange={(e) => setPolicyForm(f => ({ ...f, daysToLive: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Descripción (opcional)</label>
                <textarea
                  value={policyForm.description}
                  onChange={(e) => setPolicyForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowPolicyModal(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800">
                  Cancelar
                </button>
                <button type="submit" disabled={savingPolicy} className="px-5 py-2 text-sm font-semibold rounded-lg bg-brand-deep hover:brightness-110 text-white disabled:opacity-50 flex items-center gap-2">
                  {savingPolicy && <Loader2 className="w-4 h-4 animate-spin" />} Crear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
