"use client";
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useContext, useEffect, useState } from 'react';
import { TabContext } from '@/components/ClientShell';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import { useMetric } from '@/components/MetricProvider';
import InteractiveDashboard from "@/components/dashboard/InteractiveDashboard";
import { useAIContext } from '@/hooks/useAIContext';
import { isMockTenant, getMockDataForRoute } from '@/lib/mockData';

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
  
  const [isUpdatingPayment, setIsUpdatingPayment] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  const t = useTranslations('Billing');

  const handleUpdatePayment = async () => {
    if (accounts.length === 0) return;
    setIsUpdatingPayment(true);
    try {
      const tokenResponse = await instance.acquireTokenSilent({
          scopes: ["User.Read"],
          account: accounts[0]
      });
      const res = await fetch('/api/billing', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
      });
      const data = await res.json();
      if (data.success && data.url) {
         if (typeof window !== 'undefined' && (window as any).Paddle) {
            (window as any).Paddle.Checkout.open({ override: data.url });
         } else {
            window.location.href = data.url;
         }
      } else {
        toast.error(data.error || 'Failed to get payment url');
      }
    } catch(e) {
      toast.error('Error updating payment method');
    }
    setIsUpdatingPayment(false);
  };

  const handleCancelSubscription = async () => {
    if (accounts.length === 0) return;
    setIsCancelling(true);
    try {
      const tokenResponse = await instance.acquireTokenSilent({
          scopes: ["User.Read"],
          account: accounts[0]
      });
      const res = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
      });
      const data = await res.json();
      if (data.success) {
         toast.success('Subscription cancelled');
         setShowConfirmCancel(false);
      } else {
        toast.error(data.error || 'Failed to cancel subscription');
      }
    } catch(e) {
      toast.error('Error cancelling subscription');
    }
    setIsCancelling(false);
  };

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
      if ((accounts.length === 0 && !isMockTenant(selectedTenant.id)) || selectedTenant.id === 'default' || !selectedSubscription) {
          console.log('[BillingPage] SKIPPED: precondition failed', { accounts: accounts.length, tenant: selectedTenant.id, sub: selectedSubscription });
          return;
      }
      
      const fetchData = async () => {
          setLoading(true);
          try {
              if (isMockTenant(selectedTenant.id)) {
                  const bMock = getMockDataForRoute('billing', selectedTenant.id);
                  setBillingData(bMock?.data || []);
                  setAdvisorData(getMockDataForRoute('advisor', selectedTenant.id));
                  setZombieData(getMockDataForRoute('audit_full', selectedTenant.id));
                  setTagsData(getMockDataForRoute('tags_compliance', selectedTenant.id));
                  setLoading(false);
                  return;
              }
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
        
        <div className="mt-8 p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Billing Settings</h3>
            <div className="flex flex-col sm:flex-row gap-4">
                <button
                    onClick={handleUpdatePayment}
                    disabled={isUpdatingPayment}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                    {isUpdatingPayment ? 'Loading...' : t('changePaymentMethod')}
                </button>
                <button
                    onClick={() => setShowConfirmCancel(true)}
                    className="px-4 py-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-900/50 hover:bg-red-50 hover:dark:bg-red-950/30 text-red-600 dark:text-red-400 font-medium rounded-lg shadow-sm transition-colors"
                >
                    {t('cancelSubscription')}
                </button>
            </div>
        </div>

        {showConfirmCancel && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
                <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-slate-800">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('cancelSubscription')}</h3>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">{t('confirmCancel')}</p>
                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setShowConfirmCancel(false)}
                            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleCancelSubscription}
                            disabled={isCancelling}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center"
                        >
                            {isCancelling ? 'Processing...' : 'Confirm'}
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
}
