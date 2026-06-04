import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    table_path = os.path.join(base_dir, "src", "components", "ZombieResourcesTable.tsx")
    
    table_code = """"use client";
import React, { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';

export default function ZombieResourcesTable() {
  const { instance, accounts } = useMsal();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accounts.length === 0) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const account = accounts[0];
        const tenantId = account.tenantId;
        const subscriptionId = process.env.NEXT_PUBLIC_AZURE_SUBSCRIPTION_ID || "demo-subscription-id";
        
        // Adquisición silenciosa del JWT Bearer
        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: account
        });

        const res = await fetch(`/api/recommendations?subscriptionId=${subscriptionId}&tenantId=${tenantId}`, {
            headers: {
                'Authorization': `Bearer ${tokenResponse.idToken}`
            }
        });
        
        const json = await res.json();
        
        if (!res.ok || json.error) {
            setError(json.error || "Error de servidor al consultar recursos.");
            setLoading(false);
            return;
        }

        // Mapear los datos de Resource Graph al formato de la tabla
        const formattedDisks = (json.unattachedDisks || []).map((d: any) => ({
            id: d.id, 
            resourceName: d.name, 
            type: "Disk", 
            issue: "Disco sin asociar", 
            potentialSavings: d.diskSizeGB ? d.diskSizeGB * 0.15 : 10.0
        }));

        const formattedIps = (json.unusedIps || []).map((ip: any) => ({
            id: ip.id, 
            resourceName: ip.name, 
            type: "Public IP", 
            issue: "IP Pública sin asignar", 
            potentialSavings: 3.5
        }));

        setData([...formattedDisks, ...formattedIps]);
        setError(null);
        setLoading(false);
      } catch (err: any) {
        console.error("Error obteniendo datos:", err);
        setError("Fallo de red o credenciales de Azure denegadas. Mostrando datos de prueba locales...");
        // Fallback robusto visual para demo local si el KeyVault falla
        setData([
            { id: '1', resourceName: 'vm-prod-analytics-disk', type: 'Disk', issue: 'Disco sin asociar', potentialSavings: 15.5 },
            { id: '2', resourceName: 'ip-test-environment', type: 'Public IP', issue: 'IP Pública sin asignar', potentialSavings: 3.5 }
        ]);
        setLoading(false);
      }
    };

    fetchData();
  }, [accounts, instance]);

  if (accounts.length === 0) {
    return (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-8 text-center flex flex-col items-center justify-center">
            <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Acceso Restringido</h2>
            <p className="text-sm text-gray-500">Inicia sesión con Microsoft Entra ID para visualizar tus recursos zombi reales a través de Azure Resource Graph.</p>
        </div>
    );
  }

  if (loading) return <div className="p-4 animate-pulse bg-gray-100 rounded-lg h-32 text-gray-500 font-medium">Ejecutando KQL en Azure Resource Graph...</div>;

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
                <td className="p-4 text-sm font-bold text-green-600 text-right">${Number(item.potentialSavings).toFixed(2)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="p-8 text-center text-sm text-gray-500">
                  No se detectaron recursos zombie en Resource Graph. ¡Buen trabajo!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
"""

    with open(table_path, "w") as f:
        f.write(table_code)
        
    print("Componente ZombieResourcesTable cableado correctamente con MSAL y la API de Resource Graph.")

if __name__ == "__main__":
    main()
