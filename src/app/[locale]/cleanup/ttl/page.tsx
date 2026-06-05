"use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { toast } from 'sonner';
import { useActionLogStore } from '@/store/actionLogStore';
import { Clock, CheckCircle, Trash2, AlertCircle } from "lucide-react";

export default function TtlCleanupPage() {
  const { selectedTenant } = useTenant();
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { addAction } = useActionLogStore();

  useEffect(() => {
    if (!selectedTenant || selectedTenant.id === 'default') return;

    const fetchExpired = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch('/api/cleanup/ttl', {
            headers: {
                'x-tenant-id': selectedTenant.id
            }
        });
        const json = await res.json();
        if (json.success) {
            setResources(json.data);
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
          const res = await fetch('/api/remediation', {
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

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6 flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center">
             <Clock className="w-8 h-8 mr-3 text-red-600" />
             Time-To-Live (TTL) Enforcement
          </h1>
          <p className="text-gray-500 mt-2">Detección y eliminación automática de entornos de desarrollo expirados.</p>
        </div>
      </div>

      {error && (
        <div className="bg-white border-l-4 border-amber-500 shadow-sm p-6 rounded-lg mb-6 flex items-start">
            <div className="flex-shrink-0">
                <AlertCircle className="h-6 w-6 text-amber-500" />
            </div>
            <div className="ml-4">
                <h3 className="text-lg font-bold text-gray-900">Permisos de Resource Graph Restringidos</h3>
                <div className="mt-2 text-sm text-gray-600">
                    <p>Azure Resource Graph ha bloqueado la lectura de entornos expirados. Esto sucede comúnmente por dos razones:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-700">
                        <li>El Service Principal (Enterprise App) no tiene el rol de <strong>Reader</strong> (Lector) en las suscripciones conectadas.</li>
                        <li>Las suscripciones configuradas para este Tenant no existen o han sido canceladas.</li>
                    </ul>
                    <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200 font-mono text-xs text-red-600 break-all">
                        <strong>Log técnico:</strong> {error}
                    </div>
                </div>
            </div>
        </div>
      )}

      {loading && (
        <div className="bg-white p-10 rounded-xl shadow-sm border border-gray-200 text-center animate-pulse">
            <Clock className="w-10 h-10 mx-auto text-red-300 mb-4 animate-bounce" />
            <p className="text-gray-500 font-medium">Buscando etiquetas ExpireOn o TTL en toda la organización...</p>
        </div>
      )}

      {!loading && !error && resources.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center flex flex-col items-center justify-center">
            <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
            <h3 className="text-xl font-bold text-green-800">Excelente.</h3>
            <p className="text-green-600 mt-2 max-w-lg">Todos los entornos de desarrollo están dentro de su ciclo de vida útil. No hay recursos expirados.</p>
        </div>
      )}

      {!loading && resources.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-red-50/50 flex items-center">
                <AlertCircle className="w-5 h-5 text-red-600 mr-2" />
                <h3 className="text-lg font-bold text-red-800">Entornos de Desarrollo Expirados</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Nombre del Recurso</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Tipo</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Grupo de Recursos</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Fecha de Expiración</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {resources.map((r, idx) => {
                            const typeName = r.type?.split('/').pop() || r.type;
                            return (
                                <tr key={`${r.id}-${idx}`} className="hover:bg-red-50/30 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                                        {r.name}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                        <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded border border-gray-200 font-mono text-xs">
                                            {typeName}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                        {r.resourceGroup}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 font-bold flex items-center">
                                        <Clock className="w-4 h-4 mr-1.5" />
                                        {r.expirationDate}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <button
                                            onClick={() => handleDelete(r.id, r.subscriptionId, r.type)}
                                            disabled={deletingId === r.id}
                                            className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-xs font-bold shadow-sm transition-colors flex items-center justify-end ml-auto"
                                        >
                                            {deletingId === r.id ? (
                                                'Eliminando...'
                                            ) : (
                                                <>
                                                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                                    Eliminar Entorno
                                                </>
                                            )}
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
      )}
    </div>
  );
}
