import React, { createContext, useContext, useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from './TenantProvider';

export interface Subscription {
    id: string;
    name: string;
}

interface SubscriptionContextType {
    selectedSubscription: string; // 'All' or subscription ID
    setSelectedSubscription: (id: string) => void;
    subscriptions: Subscription[];
    loading: boolean;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [loading, setLoading] = useState(false);
    
    const [selectedSubscription, setSelectedSubscription] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem(`finops_sub_${selectedTenant?.id}`) || 'All';
        }
        return 'All';
    });

    // Reset when tenant changes
    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            setSubscriptions([]);
            setSelectedSubscription('All');
            return;
        }

        const saved = localStorage.getItem(`finops_sub_${selectedTenant.id}`);
        setSelectedSubscription(saved || 'All');

        const fetchSubscriptions = async () => {
            if (accounts.length === 0) return;
            setLoading(true);
            try {
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
                    // Validate if selected still exists
                    const savedId = localStorage.getItem(`finops_sub_${selectedTenant.id}`);
                    if (savedId && savedId !== 'All') {
                        const exists = json.subscriptions.find((s: Subscription) => s.id === savedId);
                        if (!exists) {
                            setSelectedSubscription('All');
                        }
                    }
                }
            } catch (e) {
                console.error("Error fetching subscriptions:", e);
            }
            setLoading(false);
        };

        fetchSubscriptions();
    }, [selectedTenant, accounts, instance]);

    // Sync to localStorage
    useEffect(() => {
        if (selectedTenant && selectedTenant.id !== 'default') {
            localStorage.setItem(`finops_sub_${selectedTenant.id}`, selectedSubscription);
        }
    }, [selectedSubscription, selectedTenant]);

    return (
        <SubscriptionContext.Provider value={{ selectedSubscription, setSelectedSubscription, subscriptions, loading }}>
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
