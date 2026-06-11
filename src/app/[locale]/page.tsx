"use client";
import { useContext, useEffect, useState, useCallback } from 'react';
import { TabContext } from '@/components/ClientShell';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import ZombieResourcesTable from "@/components/ZombieResourcesTable";
import TagManager from "@/components/TagManager";
import CostPieChart from "@/components/CostPieChart";
import AdvisorPanel from "@/components/AdvisorPanel";
import PowerSchedules from "@/components/dashboard/PowerSchedules";
import BudgetBurnChart from "@/components/dashboard/BudgetBurnChart";
import RightsizingBlade from "@/components/dashboard/RightsizingBlade";
import ExpiredSandboxTable from "@/components/dashboard/ExpiredSandboxTable";
import ExecutiveSummaryCard from "@/components/dashboard/ExecutiveSummaryCard";
import { useActionLogStore } from "@/store/actionLogStore";
import { Leaf } from "lucide-react";
import { useTranslations } from 'next-intl';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

export default function Home() {
  const { activeTab, setActiveTab } = useContext(TabContext);
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const { selectedSubscription } = useSubscription();
  
  const [dashboardData, setDashboardData] = useState<any[]>([]);
  const totalSavings = dashboardData.reduce((sum, item) => sum + (item.potentialSavings || 0), 0);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [complianceScore, setComplianceScore] = useState<number | null>(null);
  const [advisorSavings, setAdvisorSavings] = useState<number>(0);
  const [zombieCount, setZombieCount] = useState<number>(0);
  const { addAction } = useActionLogStore();

  const calculateCO2Savings = (wastedUsd: number) => {
      // Proxy: $100 waste removed = 15 kg CO2 saved
      return ((wastedUsd / 100) * 15).toFixed(1);
  };

  useEffect(() => {
      if (activeTab !== 'dashboard' || accounts.length === 0 || selectedTenant.id === 'default') return;
      
      const fetchData = async () => {
          setLoading(true);
          try {
              const tokenResponse = await instance.acquireTokenSilent({
                  scopes: ["User.Read"],
                  account: accounts[0]
              });
              const subParam = (!selectedSubscription || selectedSubscription.toLowerCase() === 'all') ? '' : `&subscriptionId=${selectedSubscription}`;
              // Fetch audit + advisor in parallel
              const [auditRes, advisorRes] = await Promise.allSettled([
                  fetch(`/api/audit/full?tenantId=${selectedTenant.id}${subParam}`, {
                      headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                  }),
                  fetch(`/api/advisor?tenantId=${selectedTenant.id}${subParam}`, {
                      headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                  })
              ]);

              // Process Advisor data
              if (advisorRes.status === 'fulfilled' && advisorRes.value.ok) {
                  try {
                      const advisorJson = await advisorRes.value.json();
                      const costRecs = advisorJson?.recommendations?.Cost || [];
                      const savings = costRecs.reduce((acc: number, curr: any) =>
                          acc + parseFloat(curr.extendedProperties?.savingsAmount || '0'), 0);
                      setAdvisorSavings(savings);
                  } catch (e) { console.warn('Advisor parse error', e); }
              }

              // Process Audit data
              const res = auditRes.status === 'fulfilled' ? auditRes.value : null;
              const json = res && res.ok ? await res.json() : {};
              if (json.auditResults) {
                  // Count total zombies
                  const totalZombies = Object.values(json.auditResults).reduce((acc: number, arr: any) => acc + (Array.isArray(arr) ? arr.length : 0), 0) as number;
                  setZombieCount(totalZombies);

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
                      ddos: { type: "DDoS Plan", savings: 2944.0, issueType: "cost" },
                      orphanedNics: { type: "NIC", savings: 0, issueType: "governance" },
                      orphanedNsgs: { type: "NSG", savings: 0, issueType: "governance" },
                      availabilitySets: { type: "Availability Set", savings: 0, issueType: "governance" },
                      routeTables: { type: "Route Table", savings: 0, issueType: "governance" },
                      emptyVnets: { type: "VNet", savings: 0, issueType: "governance" },
                      emptySubnets: { type: "Subnet", savings: 0, issueType: "governance" },
                      ipGroups: { type: "IP Group", savings: 0, issueType: "governance" },
                      privateDnsZones: { type: "Private DNS", savings: 0.25, issueType: "cost" },
                      emptyRgs: { type: "Resource Group", savings: 0, issueType: "governance" },
                      apiConnections: { type: "API Connection", savings: 0, issueType: "governance" },
                      expiredCerts: { type: "Certificate", savings: 0, issueType: "governance" },
                      emptySqlServers: { type: "SQL Server", savings: 0, issueType: "governance" },
                      stoppedFlexibleServers: { type: "Flexible Server", savings: 25.0, issueType: "cost" },
                      emptyCosmosDbAccounts: { type: "Cosmos DB", savings: 24.0, issueType: "cost" },
                      emptyEventHubNamespaces: { type: "Event Hub", savings: 11.0, issueType: "cost" },
                      emptyServiceBusNamespaces: { type: "Service Bus", savings: 10.0, issueType: "cost" },
                      emptyApiManagement: { type: "API Management", savings: 50.0, issueType: "cost" },
                      unprovisionedExpressRoute: { type: "ExpressRoute", savings: 55.0, issueType: "cost" },
                      unattachedWafPolicies: { type: "WAF Policy", savings: 5.0, issueType: "cost" },
                      stoppedVirtualMachines: { type: "VM (Stopped)", savings: 30.0, issueType: "cost" },
                      emptyAse: { type: "App Service Env", savings: 300.0, issueType: "cost" },
                      taggingNonCompliance: { type: "Tag Issue", savings: 0, issueType: "governance" },
                      allVirtualMachines: { type: "__skip__", savings: 0, issueType: "governance" },
                      devVirtualMachines: { type: "__skip__", savings: 0, issueType: "governance" },
                      expiredTtlResources: { type: "TTL Expired", savings: 10.0, issueType: "cost" }
                  };
                  let mappedData: any[] = [];
                  for (const [key, config] of Object.entries(resourceConfig)) {
                      if ((config as any).type === '__skip__') continue;
                      const items = json.auditResults[key] || [];
                      mappedData.push(...items.map((r: any) => ({
                          ...r,
                          type: (config as any).type,
                          issueType: (config as any).issueType,
                          potentialSavings: r.estimatedMonthlyCost || (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : (config as any).savings))
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

              // Check for anomalies
              const anomalyRes = await fetch(`/api/intelligence/anomalies?tenantId=${selectedTenant.id}&subscriptionId=${json.subscriptionId || 'default'}`);
              if (anomalyRes.ok) {
                  const anomalyJson = await anomalyRes.json();
                  if (anomalyJson.isAnomaly) {
                      addAction({
                          message: `Pico inusual de costos detectado (${anomalyJson.percentageIncrease.toFixed(1)}%). Revisa el grupo de recursos: ${anomalyJson.affectedResourceGroup}`,
                          status: 'error'
                      });
                  }
              }

          } catch (e) {}
          setLoading(false);
      };
      fetchData();
  }, [activeTab, selectedTenant, selectedSubscription, accounts, instance]);

  const t = useTranslations('Dashboard');
  const tCommon = useTranslations('Common');

  const [layouts, setLayouts] = useState<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem('finops_dashboard_layout_v2');
    if (saved) {
      try {
        setLayouts(JSON.parse(saved));
      } catch (e) {}
    } else {
      setLayouts({
        lg: [
          { i: 'exec', x: 0, y: 0, w: 12, h: 2 },
          { i: 'pie', x: 0, y: 2, w: 6, h: 4 },
          { i: 'gov', x: 6, y: 2, w: 6, h: 4 },
          { i: 'burn', x: 0, y: 6, w: 6, h: 4 },
          { i: 'power', x: 6, y: 6, w: 6, h: 4 },
          { i: 'right', x: 0, y: 10, w: 6, h: 4 },
          { i: 'sandbox', x: 6, y: 10, w: 6, h: 4 }
        ]
      });
    }
  }, []);

  const onLayoutChange = (layout: any, allLayouts: any) => {
    setLayouts(allLayouts);
    localStorage.setItem('finops_dashboard_layout_v2', JSON.stringify(allLayouts));
  };

  const handleBudgetResize = useCallback((newH: number) => {
    setLayouts((prev: any) => {
      if (!prev || !prev.lg) return prev;
      let changed = false;
      const nextLayouts = { ...prev };
      Object.keys(nextLayouts).forEach(bp => {
        nextLayouts[bp] = nextLayouts[bp].map((l: any) => {
          if (l.i === 'burn' && l.h !== newH) {
            changed = true;
            return { ...l, h: newH };
          }
          return l;
        });
      });
      if (!changed) return prev;
      return nextLayouts;
    });
  }, []);

  if (activeTab === 'audit') {
      return (
          <div className="content animate-in fade-in duration-300">
              <div className="vhead">
                  <div className="title">
                      <h1>Auditoría Completa FinOps</h1>
                      <p>Motor Omni-Scan: Detección y Remediación de 25 tipos de recursos huérfanos.</p>
                  </div>
              </div>
              <ZombieResourcesTable />
          </div>
      );
  }

  
  if (activeTab === 'advisor') {
      return (
          <div className="content animate-in fade-in duration-300">
              <AdvisorPanel />
          </div>
      );
  }
  if (activeTab === 'tags') {
      return <div className="content"><TagManager /></div>;
  }

  if (activeTab === 'powerbi' || activeTab === 'config') {
      return (
          <div className="content">
              <div className="card h-96 flex flex-col items-center justify-center animate-in fade-in">
                  <span className="text-6xl mb-4">🚧</span>
                  <h2 className="text-xl font-bold text-[var(--brand-deep)]">Módulo en Construcción</h2>
                  <p className="text-sm text-gray-500 mt-2">La sección de {activeTab === 'powerbi' ? 'Reportes Power BI' : 'Configuración'} estará disponible en la próxima fase.</p>
              </div>
          </div>
      );
  }

  if (!layouts) return null; // Avoid hydration mismatch

  return (
    <div className="content animate-in fade-in duration-500">
      <div className="vhead">
        <div className="title">
          <h1>{t('title')}</h1>
          <p>{t('subtitle')} <span className="text-xs text-brand/60 ml-2">({t('drag_hint')})</span></p>
        </div>
        
        <div className="flex gap-3 flex-wrap">
            <div className="bg-sky-50 border border-sky-200 rounded-xl px-5 py-3 flex flex-col items-end shadow-sm">
                <span className="text-[10px] font-bold text-sky-700 uppercase tracking-widest mb-1">Ahorro Advisor</span>
                <span className="text-3xl lg:text-4xl font-extrabold text-sky-600">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(advisorSavings)}
                </span>
                <span className="text-[10px] text-sky-600 mt-1">potencial / mes</span>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-3 flex flex-col items-end shadow-sm">
                <span className="text-[10px] font-bold text-green-700 uppercase tracking-widest mb-1">{t('potential_savings')}</span>
                <span className="text-3xl lg:text-4xl font-extrabold text-green-600">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalSavings)}
                </span>
                <span className="text-[10px] text-green-600 mt-1">{t('monthly_projected')}</span>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex flex-col items-end shadow-sm">
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1">Recursos Zombies</span>
                <span className="text-3xl lg:text-4xl font-extrabold text-amber-600">
                    {zombieCount}
                </span>
                <span className="text-[10px] text-amber-600 mt-1">detectados</span>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex flex-col items-end shadow-sm">
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest mb-1 flex items-center">
                    <Leaf className="w-3 h-3 mr-1" /> {t('environmental_impact')}
                </span>
                <span className="text-3xl lg:text-4xl font-extrabold text-emerald-600">
                    {calculateCO2Savings(totalSavings)}
                </span>
                <span className="text-[10px] text-emerald-600 mt-1">{t('co2_avoided')}</span>
            </div>
        </div>
      </div>
      
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={80}
        onLayoutChange={onLayoutChange}
        draggableHandle=".drag-handle"
      >
        <div key="exec">
            <div className="drag-handle cursor-move w-full h-full">
                <ExecutiveSummaryCard title={t('captured_savings')} amount={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalSavings)} trend={t('vs_last_month')} />
            </div>
        </div>
        
        <div key="pie">
            <div className="card h-full flex flex-col overflow-hidden">
                 <div className="card-h drag-handle cursor-move shrink-0 border-b-0 pb-0">
                     <div className="flex flex-col">
                         <h3 className="m-0 text-[var(--brand-deep)]">{t('financial_leak_distribution')}</h3>
                         <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">{t('click_segment_hint')}</p>
                     </div>
                 </div>
                 <div className="p-[18px] flex-1 overflow-hidden flex flex-col">
                     {loading ? (
                         <div className="flex-1 flex items-center justify-center text-gray-400 animate-pulse">{t('calculating')}</div>
                     ) : (
                         <CostPieChart data={dashboardData} onSegmentClick={(cat) => setSelectedCategory(cat)} />
                     )}
                 </div>
            </div>
        </div>

        <div key="gov">
            <div className="card h-full flex flex-col overflow-hidden">
             <div className="card-h drag-handle cursor-move shrink-0 border-b-0 pb-0">
                 <div className="flex flex-col">
                     <h3 className="m-0 text-[var(--brand-deep)]">{t('governance_state')}</h3>
                     <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">{t('based_on_rules')}</p>
                 </div>
             </div>
             <div className="p-[18px] flex-1 overflow-hidden flex flex-col">
                 <div className="flex-1 flex flex-col items-center justify-center text-gray-400 bg-[var(--surface-sunken)] rounded-lg border border-dashed border-gray-300">
                     <p className="text-sm font-medium">{t('financial_security_score')}</p>
                     <span className={`text-4xl font-bold mt-2 ${complianceScore === -1 ? 'text-gray-400' : 'text-green-500'}`}>
                         {complianceScore === null ? t('calculating') : complianceScore === -1 ? t('unconfigured') : `${complianceScore}%`}
                     </span>
                     <p className="text-xs text-gray-400 mt-2 text-center px-8">
                         {complianceScore === -1 ? t('no_rules') : t('based_on_rules')}
                     </p>
                     {complianceScore === -1 && (
                         <button 
                             onClick={(e) => { e.stopPropagation(); setActiveTab('tags'); }}
                             className="mt-4 px-4 py-2 bg-[var(--brand)] text-white text-xs font-semibold rounded shadow-sm hover:opacity-90 transition-colors"
                         >
                             {t('configure_policies')}
                         </button>
                     )}
                 </div>
             </div>
            </div>
        </div>

        <div key="burn">
            <div className="drag-handle cursor-move h-full w-full">
                <BudgetBurnChart onHeightChange={handleBudgetResize} />
            </div>
        </div>

        <div key="power">
            <div className="drag-handle cursor-move h-full w-full">
                <PowerSchedules />
            </div>
        </div>

        <div key="right">
            <div className="drag-handle cursor-move h-full w-full">
                <RightsizingBlade />
            </div>
        </div>

        <div key="sandbox">
            <div className="drag-handle cursor-move h-full w-full overflow-hidden">
                <ExpiredSandboxTable />
            </div>
        </div>
      </ResponsiveGridLayout>

      {selectedCategory && (
          <div className="animate-in slide-in-from-bottom-4 duration-500 mt-4 card">
              <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-[var(--brand-deep)]">
                      Recursos Afectados: <span className="text-[var(--brand)]">{selectedCategory}</span>
                  </h3>
                  <button onClick={() => setSelectedCategory(null)} className="text-sm text-gray-500 hover:text-[var(--brand-deep)] transition-colors">
                      ✕ Limpiar Filtro
                  </button>
              </div>
              <ZombieResourcesTable forceFilterType={selectedCategory} />
          </div>
      )}
    </div>
  );
}
