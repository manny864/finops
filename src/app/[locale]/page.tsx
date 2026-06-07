"use client";
import { useContext, useEffect, useState } from 'react';
import { TabContext } from '@/components/ClientShell';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '@/components/TenantProvider';
import ZombieResourcesTable from "@/components/ZombieResourcesTable";
import TagManager from "@/components/TagManager";
import CostPieChart from "@/components/CostPieChart";
import AdvisorPanel from "@/components/AdvisorPanel";
import PowerSchedules from "@/components/dashboard/PowerSchedules";
import BudgetBurnChart from "@/components/dashboard/BudgetBurnChart";
import RightsizingBlade from "@/components/dashboard/RightsizingBlade";
import ExpiredSandboxTable from "@/components/dashboard/ExpiredSandboxTable";
import { useActionLogStore } from "@/store/actionLogStore";
import { useDashboardStore } from "@/store/dashboardStore";
import InteractiveDashboard from "@/components/dashboard/InteractiveDashboard";

export default function Home() {
  const { activeTab, setActiveTab } = useContext(TabContext);
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  
  const { dashboardData, complianceScore, lastFetchedTenantId, anomaliesChecked, setDashboardState, setAnomaliesChecked } = useDashboardStore();
  const totalSavings = dashboardData.reduce((sum, item) => sum + (item.potentialSavings || 0), 0);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { addAction } = useActionLogStore();

  const calculateCO2Savings = (wastedUsd: number) => {
      // Proxy: $100 waste removed = 15 kg CO2 saved
      return ((wastedUsd / 100) * 15).toFixed(1);
  };

  useEffect(() => {
      if (activeTab !== 'dashboard' || accounts.length === 0 || selectedTenant.id === 'default') return;
      if (lastFetchedTenantId === selectedTenant.id && dashboardData.length > 0) return; // Prevent unnecessary refetches
      
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
                          potentialSavings: r.estimatedMonthlyCost || (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : (config as any).savings))
                      })));
                  }
                  // Calculate Compliance Score
                  const polRes = await fetch(`/api/tags?tenantId=${selectedTenant.id}`);
                  const polJson = await polRes.json();
                  const policies = polJson.policies || [];

                  let finalComplianceScore = -1;
                  if (policies.length > 0) {
                      const allItems = Object.values(json.auditResults).flat();
                      const requiredKeys = policies.filter((p:any) => p.required).map((p:any) => p.tag_key.toLowerCase());
                      let compliantCount = 0;
                      allItems.forEach((item: any) => {
                          const itemTags = item.tags || {};
                          const itemTagKeys = Object.keys(itemTags).map(k => k.toLowerCase());
                          const missingTags = requiredKeys.filter((reqKey:any) => !itemTagKeys.includes(reqKey));
                          if (missingTags.length === 0) compliantCount++;
                      });
                      finalComplianceScore = Math.round((compliantCount / allItems.length) * 100);
                  }

                  // Guardar en estado global
                  setDashboardState(selectedTenant.id, mappedData, finalComplianceScore);
              }

              // Check for anomalies solo si no hemos revisado para este tenant
              if (!anomaliesChecked) {
                  const subToUse = json.subscriptionId || (mappedData.length > 0 ? mappedData[0].subscriptionId : 'default');
                  const anomalyRes = await fetch(`/api/intelligence/anomalies?tenantId=${selectedTenant.id}&subscriptionId=${subToUse}`);
                  if (anomalyRes.ok) {
                      const anomalyJson = await anomalyRes.json();
                      if (anomalyJson.isAnomaly) {
                          addAction({
                              message: `Pico inusual de costos detectado (${anomalyJson.percentageIncrease.toFixed(1)}%). Revisa el grupo de recursos: ${anomalyJson.affectedResourceGroup}`,
                              status: 'error'
                          });
                      }
                      setAnomaliesChecked(true);
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
    <div className="animate-in fade-in duration-500">
        <InteractiveDashboard
            totalSavings={totalSavings}
            calculateCO2Savings={calculateCO2Savings}
            loading={loading}
            dashboardData={dashboardData}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            complianceScore={complianceScore}
            setActiveTab={setActiveTab}
        />
    </div>
  );
}
