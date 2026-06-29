"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import { Leaf, Wind, Zap, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import MockBanner from '@/components/MockBanner';

export default function SustainabilityPage() {
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const t = useTranslations('Sustainability');
    const [emissions, setEmissions] = useState({ footprint: 0, avoided: 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchEmissions() {
            if (!selectedTenant || selectedTenant.id === 'default' || !selectedSubscription) return;
            
            setLoading(true);
            try {
                const res = await fetch(`/api/intelligence/sustainability?tenantId=${selectedTenant.id}&subscriptionId=${selectedSubscription}`);
                const data = await res.json();
                if (data && !data.error) {
                    setEmissions({ footprint: data.footprint || 0, avoided: data.avoided || 0 });
                }
            } catch (e) {
                console.error("Error fetching sustainability data", e);
            } finally {
                setLoading(false);
            }
        }
        
        fetchEmissions();
    }, [selectedTenant, selectedSubscription]);

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#10b981] to-[#047857]">🌱</span>
                        {t('greenFinops')}
                    </div>
                    <div className="vs">{t('subtitle')}</div>
                </div>
            </div>
            <MockBanner />

            <div className="grid-3 mb-6">
                <div className="card">
                    <div className="p-5 flex items-center justify-between">
                        <div>
                            <p className="text-grey text-[11px] font-bold uppercase tracking-wider mb-1">{t('totalCarbonFootprint')}</p>
                            <h3 className="text-ink font-heading font-extrabold text-2xl">{emissions.footprint.toFixed(2)} <span className="text-sm font-normal text-ink-soft">kg CO2e</span></h3>
                        </div>
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                            <Leaf className="w-5 h-5" />
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="p-5 flex items-center justify-between">
                        <div>
                            <p className="text-grey text-[11px] font-bold uppercase tracking-wider mb-1">{t('avoidedEmissions')}</p>
                            <h3 className="text-ink font-heading font-extrabold text-2xl text-emerald-600">{emissions.avoided.toFixed(2)} <span className="text-sm font-normal text-emerald-600/70">kg CO2e</span></h3>
                        </div>
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                            <Wind className="w-5 h-5" />
                        </div>
                    </div>
                </div>
                
                <div className="card">
                    <div className="p-5 flex items-center justify-between">
                        <div>
                            <p className="text-grey text-[11px] font-bold uppercase tracking-wider mb-1">{t('avgPowerEfficiency')}</p>
                            <h3 className="text-ink font-heading font-extrabold text-2xl">{t('highGrade')}</h3>
                        </div>
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                            <Zap className="w-5 h-5" />
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="card p-6 flex flex-col items-center justify-center h-64 text-center">
                <Leaf className="w-12 h-12 text-emerald-500 mb-4 opacity-50" />
                <h4 className="text-lg font-bold text-ink mb-2">{t('sustainableCloudComputing')}</h4>
                <p className="text-ink-soft max-w-md" dangerouslySetInnerHTML={{ __html: t('sustainabilityDesc').replace('northeurope', '<code>northeurope</code>').replace('francecentral', '<code>francecentral</code>') }}></p>
            </div>
        </div>
    );
}
