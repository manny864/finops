import React, { createContext, useContext, useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from './TenantProvider';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { isMockTenant } from '@/lib/mockData';

export interface Subscription {
    id: string;
    name: string;
    costAvailability?: 'available' | 'unavailable' | 'unknown';
    costAvailabilityReason?: string | null;
}

interface SubscriptionLimitInfo {
    limitApplied: boolean;
    subscriptionLimit: number | null;
    totalAvailable: number;
    tier: string;
}

interface SubscriptionContextType {
    selectedSubscription: string; // 'All' or subscription ID
    setSelectedSubscription: (id: string) => void;
    subscriptions: Subscription[];
    loading: boolean;
    limitInfo: SubscriptionLimitInfo | null;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [loading, setLoading] = useState(false);
    const [limitInfo, setLimitInfo] = useState<SubscriptionLimitInfo | null>(null);
    
    const selectedSubscription = searchParams.get('sub') || 'All';

    // Reset when tenant changes
    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            setSubscriptions([]);
            if (selectedSubscription !== 'All') {
                const params = new URLSearchParams(searchParams.toString());
                params.delete('sub');
                router.replace(`${pathname}?${params.toString()}`);
            }
            return;
        }

        const fetchSubscriptions = async () => {
            if (accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) return;
            setLoading(true);
            try {
                // Short-circuit for demo to prevent MSAL crash before monkey-patch
                if (isMockTenant(selectedTenant?.id || '')) {
                    setSubscriptions([{ id: 'mock-sub', name: 'Demo Subscription' }]);
                    setLoading(false);
                    return;
                }

                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const res = await fetch(`/api/subscriptions?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                
                if (res.ok && json.subscriptions) {
                    setSubscriptions(json.subscriptions);
                    setLimitInfo({
                        limitApplied: !!json.limitApplied,
                        subscriptionLimit: json.subscriptionLimit ?? null,
                        totalAvailable: json.totalAvailable ?? json.subscriptions.length,
                        tier: json.tier || 'Essential',
                    });
                    // Validate if selected still exists
                    const savedId = localStorage.getItem(`finops_sub_${selectedTenant.id}`);
                    if (savedId && savedId !== 'All') {
                        const exists = json.subscriptions.find((s: Subscription) => s.id === savedId);
                        if (!exists) {
                            setSelectedSubscription('All');
                        }
                    }
                }
            } catch (e: any) {
                console.error("Error fetching subscriptions:", e);
                const errName = e?.name || (e?.constructor && e?.constructor.name) || "";
                const errCode = e?.errorCode || e?.code || "";
                const errMsg = e?.message || e?.errorMessage || "";

                if (
                    errName === "BrowserAuthError" ||
                    errName === "InteractionRequiredAuthError" ||
                    errCode === "block_iframe_reload" ||
                    errCode === "timed_out" ||
                    errCode === "interaction_required" ||
                    errCode === "consent_required" ||
                    errCode === "login_required" ||
                    errMsg.includes("block_iframe_reload") ||
                    errMsg.includes("timed_out")
                ) {
                    console.warn("MSAL silent token failure, redirecting to interactive login...", e);
                    instance.acquireTokenRedirect({
                        scopes: ["User.Read"],
                        account: accounts[0]
                    }).catch(err => console.error("Error initiating redirect login:", err));
                }
            }
            setLoading(false);
        };

        fetchSubscriptions();
    }, [selectedTenant, accounts, instance]);

    const setSelectedSubscription = (id: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (id === 'All') {
            params.delete('sub');
        } else {
            params.set('sub', id);
        }
        router.push(`${pathname}?${params.toString()}`);
    };

    return (
        <SubscriptionContext.Provider value={{ selectedSubscription, setSelectedSubscription, subscriptions, loading, limitInfo }}>
            {children}
        </SubscriptionContext.Provider>
    );
}

export function useSubscription() {
    const context = useContext(SubscriptionContext);
    if (context === undefined) {
        throw new Error('useSubscription must be used within a SubscriptionProvider');
    }
    return context;
}
