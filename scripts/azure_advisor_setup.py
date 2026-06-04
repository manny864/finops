import os
import subprocess

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def run_cmd(cmd):
    print(f"Running: {cmd}")
    subprocess.run(cmd, shell=True, cwd=base_dir, check=True)

def create_sop():
    sop_path = os.path.join(base_dir, "directivas/azure_advisor_SOP.md")
    content = """# Directiva: Integración de Azure Advisor

## Objetivo
Implementar el tablero de Azure Advisor replicando las 5 categorías oficiales de Microsoft y permitiendo exportar las métricas de recomendaciones y auditoría general a un CSV consolidado.

## Lógica y Pasos
1. **Backend**: El endpoint `/api/advisor/route.ts` iterará sobre todas las suscripciones permitidas (validando explícitamente el token y el `tenantId`).
2. **Frontend**: `<AdvisorPanel />` consumirá los datos para mostrarlos en 5 tarjetas (Costo, Seguridad, Confiabilidad, Excelencia Operativa y Rendimiento).
3. **Exportación**: El cliente interceptará `/api/audit/full` junto con los resultados actuales para empaquetarlos en un `Blob` de tipo `text/csv`.

## Trampas Conocidas / Restricciones
- **Multitenancy Bug**: Siempre utilizar `selectedTenant.id` provisto por `useTenant()`.
- **Suscripciones Vacías**: Si `GET /subscriptions` devuelve cero elementos, retornar `403 MISSING_RBAC_ROLE` en lugar de fallar silenciosamente.
"""
    with open(sop_path, "w") as f:
        f.write(content)
    print("SOP created.")

def create_api():
    api_dir = os.path.join(base_dir, "src/app/api/advisor")
    os.makedirs(api_dir, exist_ok=True)
    content = """import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { AdvisorManagementClient } from "@azure/arm-advisor";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;
    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
    const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

    if (decoded.tid !== tenantId && !isAdmin) {
      return NextResponse.json({ error: `Acceso denegado. El token no coincide con el tenant.` }, { status: 403 });
    }

    const credential = await getAzureCredential(tenantId);
    
    // Obtener suscripciones
    const tokenResponse = await credential.getToken("https://management.azure.com/.default");
    const fetchRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
        headers: { "Authorization": `Bearer ${tokenResponse.token}` }
    });
    
    let subs: string[] = [];
    if (fetchRes.ok) {
        const data = await fetchRes.json();
        for (const sub of data.value) {
            if (sub.subscriptionId) subs.push(sub.subscriptionId);
        }
    } else {
        throw new Error("Failed to fetch subscriptions");
    }

    if (subs.length === 0) {
        return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
    }

    // Inicializar agrupador
    const grouped: Record<string, any[]> = {
        Cost: [],
        Security: [],
        HighAvailability: [],
        Performance: [],
        OperationalExcellence: []
    };

    // Iterar por suscripciones
    for (const subId of subs) {
        try {
            const advisorClient = new AdvisorManagementClient(credential, subId);
            const recs = advisorClient.recommendations.list();
            for await (const r of recs) {
                const cat = r.category;
                if (cat && grouped[cat as keyof typeof grouped]) {
                    grouped[cat as keyof typeof grouped].push(r);
                } else if (cat) {
                    grouped.OperationalExcellence.push(r as never);
                }
            }
        } catch (err) {
            console.warn(`Error reading advisor for sub ${subId}:`, err);
        }
    }

    return NextResponse.json({ success: true, recommendations: grouped });
  } catch (error: any) {
    console.error("Advisor Error:", error);
    return NextResponse.json({ error: "Error en el Motor de Advisor", details: error.message }, { status: 500 });
  }
}
"""
    with open(os.path.join(api_dir, "route.ts"), "w") as f:
        f.write(content)
    print("API route created.")

def create_component():
    comp_path = os.path.join(base_dir, "src/components/AdvisorPanel.tsx")
    content = """"use client";
import React, { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from './TenantProvider';
import RoleAssignmentBanner from './RoleAssignmentBanner';

export default function AdvisorPanel() {
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accounts.length === 0 || selectedTenant.id === 'default') {
      setLoading(false);
      return;
    }

    const fetchAdvisor = async () => {
      try {
        setLoading(true);
        const account = accounts[0];
        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: account
        });
        
        const res = await fetch(`/api/advisor?tenantId=${selectedTenant.id}`, {
            headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
        });
        
        const json = await res.json();
        if (!res.ok || json.error) {
            setError(json.error === 'MISSING_RBAC_ROLE' ? 'MISSING_RBAC_ROLE' : (json.error || "Error de servidor."));
            setLoading(false);
            return;
        }

        setData(json.recommendations);
        setError(null);
      } catch (err) {
        console.error(err);
        setError("Fallo de red o credenciales.");
      } finally {
        setLoading(false);
      }
    };
    fetchAdvisor();
  }, [accounts, instance, selectedTenant]);

  const handleCsvExport = async () => {
      try {
          const account = accounts[0];
          const tokenResponse = await instance.acquireTokenSilent({
              scopes: ["User.Read"],
              account: account
          });
          const headers = { 'Authorization': `Bearer ${tokenResponse.idToken}` };
          
          // Fetch Audit
          const auditRes = await fetch(`/api/audit/full?tenantId=${selectedTenant.id}`, { headers });
          const auditJson = await auditRes.json();
          const auditData = auditJson.auditResults || {};
          
          let rows: any[] = [];
          
          // Map audit data
          const auditKeys = Object.keys(auditData);
          auditKeys.forEach(k => {
              auditData[k].forEach((item: any) => {
                  rows.push({
                      Origen: "Auditoría FinOps",
                      Categoria: "Zombie Resource",
                      Recurso: item.name || item.id,
                      Suscripcion: item.subscriptionId || "N/A",
                      Detalle: item.type || k,
                      AhorroPotencial: item.diskSizeGB ? item.diskSizeGB * 0.15 : (item.sizeGB ? item.sizeGB * 0.05 : 0)
                  });
              });
          });

          // Map advisor data
          if (data) {
              Object.keys(data).forEach(cat => {
                  data[cat].forEach((rec: any) => {
                      rows.push({
                          Origen: "Azure Advisor",
                          Categoria: cat,
                          Recurso: rec.impactedField || rec.id,
                          Suscripcion: "N/A",
                          Detalle: rec.shortDescription?.problem || "Recomendación de Azure",
                          AhorroPotencial: rec.extendedProperties?.savingsAmount || 0
                      });
                  });
              });
          }

          if (rows.length === 0) {
              alert("No hay datos para exportar.");
              return;
          }

          // Generate CSV
          const headersCsv = ["Origen", "Categoria", "Recurso", "Suscripcion", "Detalle", "AhorroPotencial"];
          const csvContent = [
              headersCsv.join(","),
              ...rows.map(r => headersCsv.map(h => `"${(r[h] || "").toString().replace(/"/g, '""')}"`).join(","))
          ].join("\\n");

          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.setAttribute("href", url);
          link.setAttribute("download", "Reporte_Mejoras_FinOps.csv");
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

      } catch (err) {
          console.error("Error exporting CSV:", err);
          alert("Error al exportar CSV.");
      }
  };

  const categories = [
      { id: "Cost", name: "Costo", color: "text-green-600", bg: "bg-green-50" },
      { id: "Security", name: "Seguridad", color: "text-red-600", bg: "bg-red-50" },
      { id: "HighAvailability", name: "Confiabilidad", color: "text-blue-600", bg: "bg-blue-50" },
      { id: "OperationalExcellence", name: "Excelencia operativa", color: "text-purple-600", bg: "bg-purple-50" },
      { id: "Performance", name: "Rendimiento", color: "text-orange-600", bg: "bg-orange-50" }
  ];

  if (accounts.length === 0 || selectedTenant.id === 'default') {
      return <div className="p-8 text-center text-gray-500">Inicia sesión con Microsoft Entra ID.</div>;
  }

  return (
    <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200 p-6 animate-in fade-in">
        <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
            <div>
                <h2 className="text-xl font-bold text-gray-800">Azure Advisor</h2>
                <p className="text-sm text-gray-500">Recomendaciones nativas consolidadas de Microsoft.</p>
            </div>
            <button onClick={handleCsvExport} className="px-4 py-2 bg-[#0054A6] hover:bg-blue-800 text-white text-sm font-semibold rounded shadow-sm transition-colors flex items-center">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                Descargar como CSV
            </button>
        </div>

        {error === 'MISSING_RBAC_ROLE' ? <RoleAssignmentBanner /> : error ? <div className="text-red-500">{error}</div> : loading ? <div className="animate-pulse p-8 text-center">Consultando Azure Advisor...</div> : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categories.map(cat => {
                    const items = data?.[cat.id] || [];
                    const count = items.length;
                    return (
                        <div key={cat.id} className="border border-gray-200 rounded-lg p-5 shadow-sm hover:shadow transition-shadow">
                            <h3 className="font-bold text-gray-700 mb-3">{cat.name}</h3>
                            {count === 0 ? (
                                <div className="flex items-center text-sm text-green-700 bg-green-50 p-3 rounded-md border border-green-100">
                                    <svg className="w-5 h-5 mr-2 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                                    Sigue todas nuestras recomendaciones de {cat.name}
                                </div>
                            ) : (
                                <div className="flex flex-col">
                                    <div className={`text-3xl font-extrabold mb-2 ${cat.color}`}>{count}</div>
                                    <a href="#" className="text-[#0054A6] hover:underline text-sm font-medium">Ver la lista de {cat.name} recomendaciones</a>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        )}
    </div>
  );
}
"""
    with open(comp_path, "w") as f:
        f.write(content)
    print("UI component created.")

def modify_shell():
    shell_path = os.path.join(base_dir, "src/components/ClientShell.tsx")
    with open(shell_path, "r") as f:
        content = f.read()

    new_nav = "{ id: 'advisor', label: 'Azure Advisor', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },"
    if "id: 'advisor'" not in content:
        content = content.replace(
            "{ id: 'powerbi', label: 'Reportes Power BI'",
            new_nav + "\\n      { id: 'powerbi', label: 'Reportes Power BI'"
        )
        with open(shell_path, "w") as f:
            f.write(content)
        print("Shell modified.")

def modify_page():
    page_path = os.path.join(base_dir, "src/app/page.tsx")
    with open(page_path, "r") as f:
        content = f.read()

    if "AdvisorPanel" not in content:
        content = content.replace(
            'import CostPieChart from "@/components/CostPieChart";',
            'import CostPieChart from "@/components/CostPieChart";\\nimport AdvisorPanel from "@/components/AdvisorPanel";'
        )
        
        tab_logic = """
  if (activeTab === 'advisor') {
      return (
          <div className="animate-in fade-in duration-300">
              <AdvisorPanel />
          </div>
      );
  }
"""
        content = content.replace(
            "if (activeTab === 'tags') {",
            tab_logic + "\\n  if (activeTab === 'tags') {"
        )
        
        with open(page_path, "w") as f:
            f.write(content)
        print("Page modified.")

if __name__ == "__main__":
    run_cmd("npm install @azure/arm-advisor")
    create_sop()
    create_api()
    create_component()
    modify_shell()
    modify_page()
    print("Done.")
