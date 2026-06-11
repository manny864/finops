"use client";
import { useContext, useEffect, useState } from 'react';
import { TabContext } from '@/components/ClientShell';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import { useMetric } from '@/components/MetricProvider';
import InteractiveDashboard from "@/components/dashboard/InteractiveDashboard";
import { useAIContext } from '@/hooks/useAIContext';

export default function BillingPage() {
  const { activeTab, setActiveTab } = useContext(TabContext);
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const { selectedSubscription } = useSubscription();
  const { metricType } = useMetric();
  
  const [loading, setLoading] = useState(false);
  const [billingData, setBillingData] = useState<any[] | null>(null);
  const [advisorData, setAdvisorData] = useState<any | null>(null);
  const [zombieData, setZombieData] = useState<any | null>(null);
  const [tagsData, setTagsData] = useState<any | null>(null);
  const setPageContext = useAIContext(state => state.setPageContext);

  useEffect(() => {
      if (billingData) {
          setPageContext('Billing / Consumo (Dashboard)', billingData);
      }
  }, [billingData, setPageContext]);

  useEffect(() => {
      console.log('[BillingPage] useEffect triggered', { activeTab, tenantId: selectedTenant.id, selectedSubscription, accountsLen: accounts.length });
      
      if (activeTab !== 'dashboard' && activeTab !== 'consumo' && activeTab !== 'billing') {
          console.log('[BillingPage] SKIPPED: activeTab mismatch', activeTab);
          return;
      }
      if (accounts.length === 0 || selectedTenant.id === 'default' || !selectedSubscription) {
          console.log('[BillingPage] SKIPPED: precondition failed', { accounts: accounts.length, tenant: selectedTenant.id, sub: selectedSubscription });
          return;
      }
      
      const fetchData = async () => {
          setLoading(true);
          try {
              const tokenResponse = await instance.acquireTokenSilent({
                  scopes: ["User.Read"],
                  account: accounts[0]
              });
              
              const headers = {
                  'Authorization': `Bearer ${tokenResponse.idToken}`,
                  'x-tenant-id': selectedTenant.id,
                  'x-subscription-id': selectedSubscription,
                  'x-metric-type': metricType
              };

              const subParam = (!selectedSubscription || selectedSubscription.toLowerCase() === 'all') ? '' : `&subscriptionId=${selectedSubscription}`;
              console.log('[BillingPage] Fetching APIs with subParam:', subParam);
              
              const [billingRes, advisorRes, zombieRes, tagsRes] = await Promise.allSettled([
                  fetch('/api/intelligence/billing', { headers }),
                  fetch(`/api/advisor?tenantId=${selectedTenant.id}${subParam}`, { headers }),
                  fetch(`/api/audit/full?tenantId=${selectedTenant.id}${subParam}`, { headers }),
                  fetch(`/api/tags/compliance?tenantId=${selectedTenant.id}${subParam}`, { headers })
              ]);

              console.log('[BillingPage] API responses:', {
                  billing: billingRes.status === 'fulfilled' ? billingRes.value.status : 'rejected',
                  advisor: advisorRes.status === 'fulfilled' ? advisorRes.value.status : 'rejected',
                  zombie: zombieRes.status === 'fulfilled' ? zombieRes.value.status : 'rejected',
                  tags: tagsRes.status === 'fulfilled' ? tagsRes.value.status : 'rejected',
              });

              if (billingRes.status === 'fulfilled' && billingRes.value.ok) {
                  try {
                      const j = await billingRes.value.json();
                      setBillingData(j.success ? j.data : []);
                  } catch(e) { setBillingData([]); }
              } else setBillingData([]);

              if (advisorRes.status === 'fulfilled' && advisorRes.value.ok) {
                  try {
                      const advisorJson = await advisorRes.value.json();
                      console.log('[BillingPage] advisorData:', JSON.stringify(advisorJson).substring(0, 500));
                      setAdvisorData(advisorJson);
                  } catch(e) { console.error('[BillingPage] advisor parse error', e); }
              } else {
                  console.warn('[BillingPage] advisor NOT ok:', advisorRes.status === 'fulfilled' ? advisorRes.value.status : 'rejected');
              }

              if (zombieRes.status === 'fulfilled' && zombieRes.value.ok) {
                  try {
                      const zombieJson = await zombieRes.value.json();
                      console.log('[BillingPage] zombieData keys:', Object.keys(zombieJson), 'auditResults keys:', Object.keys(zombieJson.auditResults || {}));
                      setZombieData(zombieJson);
                  } catch(e) { console.error('[BillingPage] zombie parse error', e); }
              } else {
                  console.warn('[BillingPage] zombie NOT ok:', zombieRes.status === 'fulfilled' ? zombieRes.value.status : 'rejected');
              }

              if (tagsRes.status === 'fulfilled' && tagsRes.value.ok) {
                  try {
                      const tagsJson = await tagsRes.value.json();
                      console.log('[BillingPage] tagsData:', JSON.stringify(tagsJson).substring(0, 300));
                      setTagsData(tagsJson);
                  } catch(e) { console.error('[BillingPage] tags parse error', e); }
              } else {
                  console.warn('[BillingPage] tags NOT ok:', tagsRes.status === 'fulfilled' ? tagsRes.value.status : 'rejected');
              }

          } catch (e) {
              console.error("Billing fetch error", e);
              setBillingData([]);
          }
          setLoading(false);
      };
      fetchData();
  }, [selectedTenant, selectedSubscription, accounts, instance, metricType]);

  return (
    <div className="animate-in fade-in duration-500">
        <InteractiveDashboard
            loading={loading}
            billingData={billingData}
            advisorData={advisorData}
            zombieData={zombieData}
            tagsData={tagsData}
        />
    </div>
  );
}
