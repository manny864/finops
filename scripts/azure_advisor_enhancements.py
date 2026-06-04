import os
import subprocess

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def run_cmd(cmd):
    print(f"Running: {cmd}")
    subprocess.run(cmd, shell=True, cwd=base_dir, check=True)

def modify_sop():
    sop_path = os.path.join(base_dir, "directivas/azure_advisor_SOP.md")
    with open(sop_path, "a") as f:
        f.write("\\n- **Filtrado y Scores**: Las recomendaciones ahora se etiquetan con `subscriptionId`. Se hace fetch a la REST API de Microsoft.Advisor/advisorScores para promediar la puntuación general en el frontend.\\n")
    print("SOP updated.")

def modify_api():
    api_path = os.path.join(base_dir, "src/app/api/advisor/route.ts")
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
    
    let subs: any[] = [];
    if (fetchRes.ok) {
        const data = await fetchRes.json();
        for (const sub of data.value) {
            if (sub.subscriptionId) subs.push({ id: sub.subscriptionId, name: sub.displayName });
        }
    } else {
        throw new Error("Failed to fetch subscriptions");
    }

    if (subs.length === 0) {
        return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
    }

    const grouped: Record<string, any[]> = {
        Cost: [],
        Security: [],
        HighAvailability: [],
        Performance: [],
        OperationalExcellence: []
    };
    
    const scoresMap: Record<string, number> = {};

    for (const sub of subs) {
        const subId = sub.id;
        
        // Extraer Scores REST API
        try {
            const scoreRes = await fetch(`https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Advisor/advisorScores?api-version=2020-01-01`, {
                headers: { "Authorization": `Bearer ${tokenResponse.token}` }
            });
            if (scoreRes.ok) {
                const scoreData = await scoreRes.json();
                if (scoreData && scoreData.value && scoreData.value.length > 0) {
                    const score = scoreData.value[0].properties?.score;
                    if (score !== undefined) {
                        scoresMap[subId] = score;
                    }
                }
            }
        } catch (err) {
            console.warn(`Error reading scores for sub ${subId}:`, err);
        }

        // Extraer Recomendaciones
        try {
            const advisorClient = new AdvisorManagementClient(credential, subId);
            const recs = advisorClient.recommendations.list();
            for await (const r of recs) {
                const cat = r.category;
                const recWithSub = { ...r, subscriptionId: subId };
                if (cat && grouped[cat as keyof typeof grouped]) {
                    grouped[cat as keyof typeof grouped].push(recWithSub);
                } else if (cat) {
                    grouped.OperationalExcellence.push(recWithSub as never);
                }
            }
        } catch (err) {
            console.warn(`Error reading advisor for sub ${subId}:`, err);
        }
    }

    return NextResponse.json({ 
        success: true, 
        recommendations: grouped,
        subscriptions: subs,
        scores: scoresMap
    });
  } catch (error: any) {
    console.error("Advisor Error:", error);
    return NextResponse.json({ error: "Error en el Motor de Advisor", details: error.message }, { status: 500 });
  }
}
"""
    with open(api_path, "w") as f:
        f.write(content)
    print("API route modified.")

def modify_component():
    comp_path = os.path.join(base_dir, "src/components/AdvisorPanel.tsx")
    content = """"use client";
import React, { useEffect, useState, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from './TenantProvider';
import RoleAssignmentBanner from './RoleAssignmentBanner';

export default function AdvisorPanel() {
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const [data, setData] = useState<any>(null);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSub, setSelectedSub] = useState<string>("all");

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
        setSubscriptions(json.subscriptions || []);
        setScores(json.scores || {});
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

  const filteredData = useMemo(() => {
      if (!data) return {};
      if (selectedSub === "all") return data;
      
      const filtered: Record<string, any[]> = {};
      Object.keys(data).forEach(cat => {
          filtered[cat] = data[cat].filter((r: any) => r.subscriptionId === selectedSub);
      });
      return filtered;
  }, [data, selectedSub]);

  const globalMetrics = useMemo(() => {
      let totalRecs = 0;
      if (filteredData) {
          Object.keys(filteredData).forEach(cat => {
              totalRecs += filteredData[cat].length;
          });
      }
      
      let avgScoreStr = "N/A";
      if (Object.keys(scores).length > 0) {
          if (selectedSub === "all") {
              const vals = Object.values(scores);
              const avg = vals.reduce((a,b) => a+b, 0) / vals.length;
              avgScoreStr = `${avg.toFixed(1)}%`;
          } else if (scores[selectedSub] !== undefined) {
              avgScoreStr = `${scores[selectedSub].toFixed(1)}%`;
          }
      }

      return { totalRecs, avgScoreStr };
  }, [filteredData, scores, selectedSub]);

  const handleCsvExport = async () => {
      try {
          const account = accounts[0];
          const tokenResponse = await instance.acquireTokenSilent({
              scopes: ["User.Read"],
              account: account
          });
          const headers = { 'Authorization': `Bearer ${tokenResponse.idToken}` };
          
          let auditUrl = `/api/audit/full?tenantId=${selectedTenant.id}`;
          if (selectedSub !== "all") auditUrl += `&subscriptionId=${selectedSub}`;

          const auditRes = await fetch(auditUrl, { headers });
          const auditJson = await auditRes.json();
          const auditData = auditJson.auditResults || {};
          
          let rows: any[] = [];
          
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

          if (filteredData) {
              Object.keys(filteredData).forEach(cat => {
                  filteredData[cat].forEach((rec: any) => {
                      rows.push({
                          Origen: "Azure Advisor",
                          Categoria: cat,
                          Recurso: rec.impactedField || rec.id,
                          Suscripcion: rec.subscriptionId || "N/A",
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
      { id: "Cost", name: "Costo", color: "text-green-600", bg: "bg-green-50", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
      { id: "Security", name: "Seguridad", color: "text-red-600", bg: "bg-red-50", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg> },
      { id: "HighAvailability", name: "Confiabilidad", color: "text-blue-600", bg: "bg-blue-50", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> },
      { id: "OperationalExcellence", name: "Excelencia operativa", color: "text-purple-600", bg: "bg-purple-50", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg> },
      { id: "Performance", name: "Rendimiento", color: "text-orange-600", bg: "bg-orange-50", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg> }
  ];

  if (accounts.length === 0 || selectedTenant.id === 'default') {
      return <div className="p-8 text-center text-gray-500">Inicia sesión con Microsoft Entra ID.</div>;
  }

  return (
    <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200 p-6 animate-in fade-in">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-gray-100 pb-4">
            <div className="mb-4 md:mb-0">
                <h2 className="text-xl font-bold text-gray-800">Azure Advisor</h2>
                <div className="flex items-center space-x-4 mt-2">
                    <div className="flex flex-col">
                        <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Score Global</span>
                        <span className="text-lg font-extrabold text-[#0054A6]">{globalMetrics.avgScoreStr}</span>
                    </div>
                    <div className="h-8 w-px bg-gray-200"></div>
                    <div className="flex flex-col">
                        <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Total Recomendaciones</span>
                        <span className="text-lg font-extrabold text-[#0054A6]">{globalMetrics.totalRecs}</span>
                    </div>
                </div>
            </div>
            
            <div className="flex items-center space-x-4">
                <select
                    value={selectedSub}
                    onChange={(e) => { setSelectedSub(e.target.value); setSelectedCategory(null); }}
                    className="border border-gray-300 text-sm rounded-md shadow-sm p-2 focus:border-[#0054A6] focus:ring-[#0054A6]"
                >
                    <option value="all">Todas las Suscripciones</option>
                    {subscriptions.map(s => (
                        <option key={s.id} value={s.id}>{s.name || s.id}</option>
                    ))}
                </select>

                <button onClick={handleCsvExport} className="px-4 py-2 bg-[#0054A6] hover:bg-blue-800 text-white text-sm font-semibold rounded shadow-sm transition-colors flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    Descargar como CSV
                </button>
            </div>
        </div>

        {error === 'MISSING_RBAC_ROLE' ? <RoleAssignmentBanner /> : error ? <div className="text-red-500">{error}</div> : loading ? <div className="animate-pulse p-8 text-center">Consultando Azure Advisor...</div> : (
            <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categories.map(cat => {
                    const items = filteredData?.[cat.id] || [];
                    const count = items.length;
                    return (
                        <div key={cat.id} className="border border-gray-200 rounded-lg p-5 shadow-sm hover:shadow transition-shadow">
                            <div className="flex items-center mb-3">
                                <div className={`p-2 rounded-lg ${cat.bg} ${cat.color} mr-3`}>
                                    {cat.icon}
                                </div>
                                <h3 className="font-bold text-gray-700">{cat.name}</h3>
                            </div>
                            
                            {count === 0 ? (
                                <div className="flex items-center text-sm text-green-700 bg-green-50 p-3 rounded-md border border-green-100">
                                    <svg className="w-5 h-5 mr-2 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                                    Sigue todas nuestras recomendaciones
                                </div>
                            ) : (
                                <div className="flex flex-col">
                                    <div className={`text-3xl font-extrabold mb-2 ${cat.color}`}>{count}</div>
                                    <a href="#" onClick={(e) => { e.preventDefault(); setSelectedCategory(cat.id); }} className="text-[#0054A6] hover:underline text-sm font-medium">Ver la lista de {cat.name} recomendaciones</a>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            
            {selectedCategory && (
                <div className="mt-8 border-t border-gray-200 pt-6 animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center">
                            <div className={`p-2 rounded-lg ${categories.find(c => c.id === selectedCategory)?.bg} ${categories.find(c => c.id === selectedCategory)?.color} mr-3`}>
                                {categories.find(c => c.id === selectedCategory)?.icon}
                            </div>
                            <h3 className="text-lg font-bold text-gray-800">
                                Recomendaciones de {categories.find(c => c.id === selectedCategory)?.name}
                            </h3>
                        </div>
                        <button onClick={() => setSelectedCategory(null)} className="text-gray-400 hover:text-gray-600">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    
                    <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recurso Afectado</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Suscripción</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Problema Detectado</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Solución Propuesta</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filteredData[selectedCategory]?.map((rec: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{rec.impactedField || 'Desconocido'}</td>
                                        <td className="px-6 py-4 text-sm text-gray-500 truncate max-w-[150px]">{subscriptions.find(s => s.id === rec.subscriptionId)?.name || rec.subscriptionId}</td>
                                        <td className="px-6 py-4 text-sm text-gray-500">{rec.shortDescription?.problem || 'N/A'}</td>
                                        <td className="px-6 py-4 text-sm text-gray-500">{rec.shortDescription?.solution || 'Consulte el Portal de Azure'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            </>
        )}
    </div>
  );
}
"""
    with open(comp_path, "w") as f:
        f.write(content)
    print("Component UI modified.")

if __name__ == "__main__":
    modify_sop()
    modify_api()
    modify_component()
    print("Done.")
