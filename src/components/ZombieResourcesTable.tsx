"use client";
import React, { useEffect, useState } from 'react';

export default function ZombieResourcesTable() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Simulando fetch de la API real
    fetch('/api/recommendations?subscriptionId=mock-sub')
      .then(res => res.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        setData(json.zombieResources || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        // Fallback robusto en caso de faltar DefaultAzureCredential en local
        setData([
          { id: '1', resourceName: 'vm-prod-analytics-disk', type: 'Disk', issue: 'Disco sin asociar', potentialSavings: 15.5 },
          { id: '2', resourceName: 'ip-test-environment', type: 'Public IP', issue: 'IP Pública sin asignar', potentialSavings: 3.5 }
        ]);
        setError("Error de autenticación de Azure SDK. Mostrando datos de prueba locales.");
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="p-4 animate-pulse bg-gray-100 rounded-lg h-32 text-gray-500 font-medium">Escaneando recursos en Azure...</div>;

  return (
    <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
        <h2 className="text-lg font-semibold text-[var(--color-primary)]">Recursos Zombi Detectados</h2>
        {error && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">{error}</span>}
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200 bg-white">
              <th className="p-4 font-medium">Recurso</th>
              <th className="p-4 font-medium">Tipo</th>
              <th className="p-4 font-medium">Problema</th>
              <th className="p-4 font-medium text-right">Ahorro Mensual (USD)</th>
            </tr>
          </thead>
          <tbody>
            {data.length > 0 ? data.map((item, i) => (
              <tr key={item.id || i} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="p-4 text-sm font-semibold text-gray-800">{item.resourceName}</td>
                <td className="p-4 text-sm text-gray-600">
                  <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">{item.type}</span>
                </td>
                <td className="p-4 text-sm text-gray-600">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">
                    {item.issue}
                  </span>
                </td>
                <td className="p-4 text-sm font-bold text-green-600 text-right">${item.potentialSavings.toFixed(2)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="p-8 text-center text-sm text-gray-500">
                  No se detectaron recursos zombie. ¡Buen trabajo!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
