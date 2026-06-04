import os
import subprocess

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print("--- Fase 5: Inyección de Tolerancia a Fallos y Selector de Suscripciones ---")

    # 1. Crear SOP
    sop_path = os.path.join(base_dir, "directivas", "subscriptions_fallback_SOP.md")
    sop_content = """# Directiva: Manejo de Entornos Híbridos y Selector de Suscripciones

## Objetivo
Garantizar tolerancia a fallos en la capa de identidad (`keyvault.ts`) para entornos locales o despliegues ligeros, e implementar un componente dinámico de filtrado de suscripciones para el Dashboard FinOps.

## Lógica de Tolerancia a Fallos (Fallback)
- En `keyvault.ts`, si `KEYVAULT_NAME` no está configurado, o si `DefaultAzureCredential` lanza una excepción (típico en localhost), el código DEBE ser capaz de interceptar el error y retroceder a leer el secreto quemado en la variable `process.env.AZURE_CLIENT_SECRET`.

## Arquitectura de API de Suscripciones
- Se expone `/api/subscriptions` utilizando `SubscriptionClient` de `@azure/arm-subscriptions`.
- Esta ruta está protegida por la misma lógica Zero-Trust (Bearer Token) que la API de recomendaciones.
"""
    with open(sop_path, "w") as f:
        f.write(sop_content)

    # 2. Patch keyvault.ts
    kv_path = os.path.join(base_dir, "src", "lib", "keyvault.ts")
    kv_code = """import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

export async function getTenantSecret(tenantId: string): Promise<string> {
  const vaultName = process.env.KEYVAULT_NAME;
  const fallbackSecret = process.env.AZURE_CLIENT_SECRET;

  if (!vaultName) {
    if (fallbackSecret) {
        console.warn(`[KeyVault] KEYVAULT_NAME no definido. Usando AZURE_CLIENT_SECRET de respaldo para el tenant ${tenantId}.`);
        return fallbackSecret;
    }
    throw new Error("Se requiere la variable KEYVAULT_NAME o AZURE_CLIENT_SECRET para autenticar el Tenant.");
  }
  
  const url = `https://${vaultName}.vault.azure.net`;
  
  try {
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(url, credential);
    const secretName = `client-secret-${tenantId}`;
    
    const secret = await client.getSecret(secretName);
    if (!secret.value) throw new Error(`El secreto ${secretName} no tiene valor.`);
    return secret.value;
  } catch (error: any) {
    // Fallback híbrido: Si el Key Vault falla (ej. localhost sin permisos), intenta usar el .env
    if (fallbackSecret) {
        console.warn(`[KeyVault] Falló conexión a ${vaultName} (${error.message}). Usando AZURE_CLIENT_SECRET de respaldo.`);
        return fallbackSecret;
    }
    throw new Error(`Fallo al recuperar el secreto para el tenant ${tenantId} y no hay secreto de respaldo: ${error.message}`);
  }
}
"""
    with open(kv_path, "w") as f:
        f.write(kv_code)

    # 3. Instalar dependencia
    print("Instalando @azure/arm-subscriptions...")
    subprocess.run(["npm", "install", "@azure/arm-subscriptions"], cwd=base_dir, check=True)

    # 4. Crear API Route de Subscriptions
    subs_route_dir = os.path.join(base_dir, "src", "app", "api", "subscriptions")
    os.makedirs(subs_route_dir, exist_ok=True)
    subs_route_path = os.path.join(subs_route_dir, "route.ts")
    subs_route_code = """import { NextRequest, NextResponse } from "next/server";
import { SubscriptionClient } from "@azure/arm-subscriptions";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as { tid?: string } | null;
    if (!decoded || decoded.tid !== tenantId) {
      return NextResponse.json({ error: "Acceso denegado. Tenant ID inválido." }, { status: 403 });
    }

    const credential = await getAzureCredential(tenantId);
    const client = new SubscriptionClient(credential);
    
    const subscriptions = [];
    for await (const sub of client.subscriptions.list()) {
        subscriptions.push({
            id: sub.subscriptionId,
            displayName: sub.displayName,
            state: sub.state
        });
    }

    return NextResponse.json({ success: true, subscriptions });
  } catch (error: any) {
    console.error("API Subscriptions Error:", error);
    return NextResponse.json({ error: "Error obteniendo suscripciones", details: error.message }, { status: 500 });
  }
}
"""
    with open(subs_route_path, "w") as f:
        f.write(subs_route_code)

    # 5. Modificar ZombieResourcesTable.tsx para incluir el selector dentro de su estado
    # (Lo haremos directamente en la tabla para mantener la estructura cohesionada en un solo archivo cliente)
    table_path = os.path.join(base_dir, "src", "components", "ZombieResourcesTable.tsx")
    table_code = """"use client";
import React, { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';

export default function ZombieResourcesTable() {
  const { instance, accounts } = useMsal();
  const [data, setData] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [selectedSub, setSelectedSub] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accounts.length === 0) {
      setLoading(false);
      return;
    }

    const fetchResourcesAndSubs = async () => {
      try {
        setLoading(true);
        const account = accounts[0];
        const tenantId = account.tenantId;
        
        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: account
        });
        const headers = { 'Authorization': `Bearer ${tokenResponse.idToken}` };

        // 1. Fetch Subscriptions if not loaded yet
        if (subscriptions.length === 0) {
            const subRes = await fetch(`/api/subscriptions?tenantId=${tenantId}`, { headers });
            if (subRes.ok) {
                const subJson = await subRes.json();
                setSubscriptions(subJson.subscriptions || []);
            }
        }

        // 2. Fetch Zombie Resources (Filtered or Global)
        let apiUrl = `/api/recommendations?tenantId=${tenantId}`;
        if (selectedSub !== "all") {
            apiUrl += `&subscriptionId=${selectedSub}`;
        }

        const res = await fetch(apiUrl, { headers });
        const json = await res.json();
        
        if (!res.ok || json.error) {
            setError(json.error || "Error de servidor al consultar recursos.");
            setLoading(false);
            return;
        }

        const formattedDisks = (json.unattachedDisks || []).map((d: any) => ({
            id: d.id, 
            resourceName: d.name, 
            type: "Disk", 
            issue: "Disco sin asociar", 
            subscriptionId: d.subscriptionId || selectedSub,
            potentialSavings: d.diskSizeGB ? d.diskSizeGB * 0.15 : 10.0
        }));

        const formattedIps = (json.unusedIps || []).map((ip: any) => ({
            id: ip.id, 
            resourceName: ip.name, 
            type: "Public IP", 
            issue: "IP Pública sin asignar", 
            subscriptionId: ip.subscriptionId || selectedSub,
            potentialSavings: 3.5
        }));

        setData([...formattedDisks, ...formattedIps]);
        setError(null);
        setLoading(false);
      } catch (err: any) {
        console.error("Error obteniendo datos:", err);
        setError("Fallo de red o credenciales denegadas.");
        setLoading(false);
      }
    };

    fetchResourcesAndSubs();
  }, [accounts, instance, selectedSub]);

  if (accounts.length === 0) {
    return (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-8 text-center flex flex-col items-center justify-center">
            <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Acceso Restringido</h2>
            <p className="text-sm text-gray-500">Inicia sesión con Microsoft Entra ID para visualizar tus recursos zombi.</p>
        </div>
    );
  }

  return (
    <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
      <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50 gap-4">
        <div>
            <h2 className="text-lg font-semibold text-[var(--color-primary)]">
                {selectedSub === "all" ? "Recursos Zombi (Global)" : "Recursos Zombi (Filtrados)"}
            </h2>
            {error && <span className="mt-2 inline-block text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">{error}</span>}
        </div>
        
        {/* Selector de Suscripciones */}
        <div className="flex items-center space-x-2 w-full sm:w-auto">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Suscripción:</label>
            <select 
                value={selectedSub}
                onChange={(e) => setSelectedSub(e.target.value)}
                className="bg-white border border-gray-300 text-gray-700 text-sm rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] block p-2 shadow-sm w-full sm:w-64"
            >
                <option value="all">Todas las Suscripciones</option>
                {subscriptions.map((sub: any) => (
                    <option key={sub.id} value={sub.id}>{sub.displayName}</option>
                ))}
            </select>
        </div>
      </div>
      
      {loading ? (
          <div className="p-8 text-center text-gray-500 font-medium animate-pulse">Escaneando Azure Resource Graph...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200 bg-white">
                <th className="p-4 font-medium">Recurso</th>
                <th className="p-4 font-medium">Suscripción</th>
                <th className="p-4 font-medium">Tipo</th>
                <th className="p-4 font-medium">Problema</th>
                <th className="p-4 font-medium text-right">Ahorro Mensual (USD)</th>
              </tr>
            </thead>
            <tbody>
              {data.length > 0 ? data.map((item, i) => (
                <tr key={item.id || i} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="p-4 text-sm font-semibold text-gray-800">{item.resourceName}</td>
                  <td className="p-4 text-xs font-mono text-gray-500">{item.subscriptionId === 'all' ? 'N/A' : item.subscriptionId.substring(0,8) + '...'}</td>
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
                  <td colSpan={5} className="p-8 text-center text-sm text-gray-500">
                    No se detectaron recursos zombie en esta vista. ¡Excelente trabajo!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
"""
    with open(table_path, "w") as f:
        f.write(table_code)

    print("\nScript completado exitosamente. La tolerancia a fallos del KeyVault y el componente Selector están inyectados.")

if __name__ == "__main__":
    main()
