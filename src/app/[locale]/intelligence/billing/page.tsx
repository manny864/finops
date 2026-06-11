"use client";
import { useContext, useEffect, useState } from 'react';
import { TabContext } from '@/components/ClientShell';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import { useMetric } from '@/components/MetricProvider';
import InteractiveDashboard from "@/components/dashboard/InteractiveDashboard";

export default function BillingPage() {
  const { activeTab, setActiveTab } = useContext(TabContext);
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const { selectedSubscription } = useSubscription();
  const { metricType } = useMetric();
  
  const [loading, setLoading] = useState(false);
  const [billingData, setBillingData] = useState<any[] | null>(null);

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
              
              const res = await fetch('/api/intelligence/billing', {
                  headers: {
                      'Authorization': `Bearer ${tokenResponse.idToken}`,
                      'x-tenant-id': selectedTenant.id,
                      'x-subscription-id': selectedSubscription,
                      'x-metric-type': metricType
                  }
              });
              const json = await res.json();
              if (json.success) {
                  setBillingData(json.data);
              } else {
                  setBillingData([]);
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
        />
    </div>
  );
}
