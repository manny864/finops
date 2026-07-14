"use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import { toast } from 'sonner';
import { useActionLogStore } from '@/store/actionLogStore';
import { Clock, CheckCircle, Trash2, AlertCircle } from "lucide-react";
import MockBanner from '@/components/MockBanner';
import Pagination, { usePagination } from '@/components/Pagination';
import { canDeleteResources } from '@/lib/tierLogic';
import EnterpriseDeleteDisclaimer from '@/components/EnterpriseDeleteDisclaimer';

export default function TtlCleanupPage() {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { addAction } = useActionLogStore();

  const { page, setPage, pageSize, setPageSize, total, totalPages, paged: pagedResources } = usePagination(resources);

  useEffect(() => {
    if (!selectedTenant || selectedTenant.id === 'default') return;

    const fetchExpired = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetchWithAuthRetry(instance, accounts[0], '/api/cleanup/ttl', {
            headers: {
                'x-tenant-id': selectedTenant.id
            }
        });
        const json = await res.json();
        if (json.success) {
            setResources(Array.isArray(json.data) ? json.data : []);
        } else {
            setError(json.error || "Error al obtener recursos expirados");
        }
      } catch(e) {
          setError("Error de red");
      }
      setLoading(false);
    };

    fetchExpired();
  }, [selectedTenant]);

  const handleDelete = async (resourceId: string, subscriptionId: string, type: string) => {
      if (!confirm("¿Está seguro de que desea eliminar permanentemente este recurso de Azure?")) return;
      
      setDeletingId(resourceId);
      try {
          const res = await fetchWithAuthRetry(instance, accounts[0], '/api/remediation', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'x-tenant-id': selectedTenant.id
              },
              body: JSON.stringify({
                  action: 'delete',
                  resourceId,
                  subscriptionId,
                  resourceType: type
              })
          });
          
          const json = await res.json();
          if (json.success) {
              setResources(prev => prev.filter(r => r.id !== resourceId));
              toast.success('Entorno Destruido');
              addAction({ message: `Entorno TTL expirado destruido exitosamente.`, status: 'success' });
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

  if (selectedTenant.id === 'default') return null;

  const canDelete = canDeleteResources(selectedTenant.tier, 'ttl');

  return (
    <div className="content animate-in fade-in duration-500">
      <div className="vhead">
        <div>
          <div className="vt">
             <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">⏳</span>
             Time-To-Live (TTL) Enforcement
          </div>
          <div className="vs">Detección y eliminación automática de entornos de desarrollo expirados.</div>
        </div>
        <div className="right">
          <span className="scopechip">📍 {selectedTenant?.name || "Tenant"}</span>
        </div>
      </div>
      <MockBanner />
      {!canDelete && <div className="mb-4"><EnterpriseDeleteDisclaimer domain="ttl" /></div>}

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
                            <th style={{textAlign:'center'}}>Estado</th>
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
                                    <td style={{textAlign:'center'}}>
                                        <span className={`tag ${
                                            r.ttlStatus === 'Active' ? 'green' : 
                                            r.ttlStatus === 'Warning' ? 'amber' : 
                                            'red'
                                        }`}>
                                            {r.ttlStatus || 'Desconocido'}
                                        </span>
                                    </td>
                                    <td className="num">
                                        {canDelete ? (
                                            <button
                                                onClick={() => handleDelete(r.id, r.subscriptionId, r.type)}
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
    </div>
  );
}
