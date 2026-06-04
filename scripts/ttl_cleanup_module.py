import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("Creando ttlService.ts...")
    service_path = os.path.join(base_dir, "src/services/ttlService.ts")
    with open(service_path, "w") as f:
        f.write("""import { getAzureCredential } from "../lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../lib/kqlCatalog";

export async function findExpiredResources(tenantId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);

    const query = kqlCatalog.expiredTtlResources;
    if (!query) throw new Error("Query no encontrada en KQL Catalog");

    const res = await client.resources({ query });
    const resources = res.data as any[];

    if (!resources || resources.length === 0) return [];

    const now = new Date();
    const expired: any[] = [];

    for (const r of resources) {
        if (!r.expirationDate) continue;
        
        const expDate = new Date(r.expirationDate);
        
        if (!isNaN(expDate.getTime()) && expDate < now) {
            expired.push(r);
        }
    }

    return expired;
}
""")

    print("Creando /api/cleanup/ttl/route.ts...")
    api_dir = os.path.join(base_dir, "src/app/api/cleanup/ttl")
    os.makedirs(api_dir, exist_ok=True)
    with open(os.path.join(api_dir, "route.ts"), "w") as f:
        f.write("""import { NextRequest, NextResponse } from 'next/server';
import { findExpiredResources } from '@/services/ttlService';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenant-id en headers' }, { status: 400 });
        }

        const expiredResources = await findExpiredResources(tenantId);
        return NextResponse.json({ success: true, data: expiredResources });
    } catch (error: any) {
        console.error('TTL API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
""")

    print("Creando UI en page.tsx...")
    page_path = os.path.join(base_dir, "src/app/cleanup/ttl/page.tsx")
    with open(page_path, "w") as f:
        f.write(""""use client";
import React, { useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { Clock, CheckCircle, Trash2, AlertCircle } from "lucide-react";

export default function TtlCleanupPage() {
  const { selectedTenant } = useTenant();
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
          } else {
              alert("Error al eliminar: " + (json.error || "Fallo desconocido"));
          }
      } catch (e) {
          alert("Error de red al intentar eliminar");
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
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg mb-6 flex items-start">
            <AlertCircle className="w-6 h-6 text-red-500 mr-3 shrink-0" />
            <div>
                <p className="text-red-700 font-bold">Error de lectura:</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
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
""")

    print("Generando SOP de TTL Enforcement...")
    sop_path = os.path.join(base_dir, "directivas/ttl_enforcement_SOP.md")
    os.makedirs(os.path.dirname(sop_path), exist_ok=True)
    with open(sop_path, "w") as f:
        f.write("# TTL Enforcement SOP\\n\\n")
        f.write("- **Fechas de Expiración**: La etiqueta `ExpireOn` o `TTL` se parsea a JS Date y se compara estrictamente (`< new Date()`). Entornos sin etiqueta válida son omitidos.\\n")
        f.write("- **UI de Expiraciones**: Emplea estados de vacío atractivos usando Tailwind y lucide-react para maximizar la legibilidad en tableros limpios.\\n")
        f.write("- **Remediación**: Llama al endpoint de remediación de zombis (`/api/remediation`) pasándole los parámetros para destruir la infraestructura subyacente.\\n")


if __name__ == "__main__":
    deploy()
    print("TTL Cleanup Module Deploy completed.")
