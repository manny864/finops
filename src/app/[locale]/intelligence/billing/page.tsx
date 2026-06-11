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
      if (activeTab !== 'dashboard' && activeTab !== 'consumo' && activeTab !== 'billing') return;
      if (accounts.length === 0 || selectedTenant.id === 'default' || !selectedSubscription) return;
      
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

              const [billingRes, advisorRes, zombieRes, tagsRes] = await Promise.allSettled([
                  fetch('/api/intelligence/billing', { headers }),
                  fetch(`/api/advisor?subscriptionId=${selectedSubscription}`, { headers }),
                  fetch(`/api/cleanup/zombies?subscriptionId=${selectedSubscription}`, { headers }),
                  fetch(`/api/tags/compliance?subscriptionId=${selectedSubscription}`, { headers })
              ]);

              if (billingRes.status === 'fulfilled' && billingRes.value.ok) {
                  try {
                      const j = await billingRes.value.json();
                      setBillingData(j.success ? j.data : []);
                  } catch(e) { setBillingData([]); }
              } else setBillingData([]);

              if (advisorRes.status === 'fulfilled' && advisorRes.value.ok) {
                  try { setAdvisorData(await advisorRes.value.json()); } catch(e) {}
              }

              if (zombieRes.status === 'fulfilled' && zombieRes.value.ok) {
                  try { setZombieData(await zombieRes.value.json()); } catch(e) {}
              }

              if (tagsRes.status === 'fulfilled' && tagsRes.value.ok) {
                  try { setTagsData(await tagsRes.value.json()); } catch(e) {}
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
