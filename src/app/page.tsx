"use client";
import { useContext, useEffect, useState } from 'react';
import { TabContext } from '@/components/ClientShell';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '@/components/TenantProvider';
import ZombieResourcesTable from "@/components/ZombieResourcesTable";
import TagManager from "@/components/TagManager";
import CostPieChart from "@/components/CostPieChart";
import AdvisorPanel from "@/components/AdvisorPanel";

export default function Home() {
  const { activeTab, setActiveTab } = useContext(TabContext);
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  
  const [dashboardData, setDashboardData] = useState<any[]>([]);
  const totalSavings = dashboardData.reduce((sum, item) => sum + (item.potentialSavings || 0), 0);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [complianceScore, setComplianceScore] = useState<number | null>(null);

  useEffect(() => {
      if (activeTab !== 'dashboard' || accounts.length === 0 || selectedTenant.id === 'default') return;
      
      const fetchData = async () => {
          setLoading(true);
          try {
              const tokenResponse = await instance.acquireTokenSilent({
                  scopes: ["User.Read"],
                  account: accounts[0]
              });
              const res = await fetch(`/api/audit/full?tenantId=${selectedTenant.id}`, {
                  headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
              });
              const json = await res.json();
              if (json.auditResults) {
                  const resourceConfig: any = {
                      unattachedDisks: { type: "Disk", savings: 15.0, issueType: "cost" },
                      unusedIps: { type: "Public IP", savings: 3.5, issueType: "cost" },
                      staleSnapshots: { type: "Snapshot", savings: 5.0, issueType: "cost" },
                      emptyAppServicePlans: { type: "App Service Plan", savings: 45.0, issueType: "cost" },
                      elasticPools: { type: "SQL Elastic Pool", savings: 250.0, issueType: "cost" },
                      loadBalancers: { type: "Load Balancer", savings: 18.0, issueType: "cost" },
                      frontDoorWaf: { type: "Front Door WAF", savings: 5.0, issueType: "cost" },
                      trafficManager: { type: "Traffic Manager", savings: 3.0, issueType: "cost" },
                      appGateways: { type: "App Gateway", savings: 180.0, issueType: "cost" },
                      natGateways: { type: "NAT Gateway", savings: 32.0, issueType: "cost" },
                      privateEndpoints: { type: "Private Endpoint", savings: 7.0, issueType: "cost" },
                      vnetGateways: { type: "VNet Gateway", savings: 130.0, issueType: "cost" },
                      ddos: { type: "DDoS Plan", savings: 2944.0, issueType: "cost" }
                  };
                  let mappedData: any[] = [];
                  for (const [key, config] of Object.entries(resourceConfig)) {
                      const items = json.auditResults[key] || [];
                      mappedData.push(...items.map((r: any) => ({
                          ...r,
                          type: (config as any).type,
                          issueType: (config as any).issueType,
                          potentialSavings: r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : (config as any).savings)
                      })));
                  }
                  setDashboardData(mappedData);

                  // Calculate Compliance Score
                  const polRes = await fetch(`/api/tags?tenantId=${selectedTenant.id}`);
                  const polJson = await polRes.json();
                  const policies = polJson.policies || [];
                  
                  if (policies.length === 0) {
                      setComplianceScore(-1); // -1 means Not Configured
                  } else {
                      const allItems = Object.values(json.auditResults).flat();
                      const requiredKeys = policies.filter((p:any) => p.required).map((p:any) => p.tag_key.toLowerCase());
                      let compliantCount = 0;
                      allItems.forEach((item: any) => {
                          const itemTags = item.tags || {};
                          const itemTagKeys = Object.keys(itemTags).map(k => k.toLowerCase());
                          const missingTags = requiredKeys.filter((reqKey:any) => !itemTagKeys.includes(reqKey));
                          if (missingTags.length === 0) compliantCount++;
                      });
                      setComplianceScore(Math.round((compliantCount / allItems.length) * 100));
                  }
              }
          } catch (e) {}
          setLoading(false);
      };
      fetchData();
  }, [activeTab, selectedTenant, accounts, instance]);

  if (activeTab === 'audit') {
      return (
          <div className="animate-in fade-in duration-300">
              <div className="mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Auditoría Completa FinOps</h2>
                  <p className="text-sm text-gray-500 mt-1">Motor Omni-Scan: Detección y Remediación de 25 tipos de recursos huérfanos.</p>
              </div>
              <ZombieResourcesTable />
          </div>
      );
  }

  
  if (activeTab === 'advisor') {
      return (
          <div className="animate-in fade-in duration-300">
              <AdvisorPanel />
          </div>
      );
  }
  if (activeTab === 'tags') {
      return <TagManager />;
  }

  if (activeTab === 'powerbi' || activeTab === 'config') {
      return (
          <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg border border-gray-200 shadow-sm animate-in fade-in">
              <span className="text-6xl mb-4">🚧</span>
              <h2 className="text-xl font-bold text-gray-700">Módulo en Construcción</h2>
              <p className="text-sm text-gray-500 mt-2">La sección de {activeTab === 'powerbi' ? 'Reportes Power BI' : 'Configuración'} estará disponible en la próxima fase.</p>
          </div>
      );
  }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-200 pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
          <p className="text-sm text-gray-500 mt-1">Visión global de rendimiento y eficiencia en la nube.</p>
        </div>
        
        <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-3 flex flex-col items-end shadow-sm">
            <span className="text-xs font-bold text-green-700 uppercase tracking-widest mb-1">Ahorro Potencial Total</span>
            <span className="text-4xl lg:text-5xl font-extrabold text-green-600">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalSavings)}
            </span>
            <span className="text-xs text-green-600 mt-1">/mes proyectado</span>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 flex flex-col">
             <h3 className="text-lg font-bold text-gray-800 mb-1">Distribución de Fugas Financieras</h3>
             <p className="text-xs text-gray-500 mb-4">Haz clic en un segmento para ver los recursos afectados.</p>
             {loading ? (
                 <div className="flex-1 flex items-center justify-center text-gray-400 animate-pulse">Calculando métricas...</div>
             ) : (
                 <CostPieChart data={dashboardData} onSegmentClick={(cat) => setSelectedCategory(cat)} />
             )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
             <h3 className="text-lg font-bold text-gray-800 mb-4">Estado de Gobernanza</h3>
             <div className="h-64 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                 <p className="text-sm font-medium">Score de Seguridad Financiera</p>
                 <span className={`text-4xl font-bold mt-2 ${complianceScore === -1 ? 'text-gray-400' : 'text-green-500'}`}>
                     {complianceScore === null ? 'Calculando...' : complianceScore === -1 ? 'No Configurado' : `${complianceScore}%`}
                 </span>
                 <p className="text-xs text-gray-400 mt-2 text-center px-8">
                     {complianceScore === -1 ? 'Añade reglas en Gestión de Etiquetas.' : 'Basado en las reglas de etiquetado activas.'}
                 </p>
                 {complianceScore === -1 && (
                     <button 
                         onClick={() => setActiveTab('tags')} 
                         className="mt-4 px-4 py-2 bg-[#0054A6] text-white text-xs font-semibold rounded shadow-sm hover:bg-blue-800 transition-colors"
                     >
                         Configurar Políticas
                     </button>
                 )}
             </div>
        </div>
      </div>

      {selectedCategory && (
          <div className="animate-in slide-in-from-bottom-4 duration-500 mt-4">
              <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-800">
                      Recursos Afectados: <span className="text-[#0054A6]">{selectedCategory}</span>
                  </h3>
                  <button onClick={() => setSelectedCategory(null)} className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
                      ✕ Limpiar Filtro
                  </button>
              </div>
              <ZombieResourcesTable forceFilterType={selectedCategory} />
          </div>
      )}
    </div>
  );
}
