"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';

export default function RightsizingBlade() {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [recommendations, setRecommendations] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;
        
        const fetchRightsizing = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                // Usando el motor de inteligencia (la misma formula que en la página principal)
                const res = await fetch(`/api/intelligence/rightsizing`, {
                    headers: { 
                        'Authorization': `Bearer ${tokenResponse.idToken}`,
                        'x-tenant-id': selectedTenant.id,
                        'x-subscription-id': 'All'
                    }
                });
                const json = await res.json();
                if (json.success && json.data) {
                    setRecommendations(json.data);
                }
            } catch (e) {
                console.error("Error fetching rightsizing data:", e);
            }
            setLoading(false);
        };
        fetchRightsizing();
    }, [accounts, instance, selectedTenant.id]);

    let t: any = (key: string) => key;
    try {
      const nextIntl = require('next-intl');
      if (nextIntl && nextIntl.useTranslations) {
        t = nextIntl.useTranslations('Rightsizing');
      }
    } catch (e) {}

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="card h-full flex flex-col overflow-hidden">
            <div className="card-h shrink-0">
                <div className="flex flex-col">
                    <h3 className="m-0">{t('title') || 'Motor de Rightsizing (Ajuste de Tamaño)'}</h3>
                    <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">{t('subtitle') || 'Máquinas virtuales con bajo uso de CPU.'}</p>
                </div>
            </div>
            
            <div className="p-[18px] flex-1 overflow-y-auto custom-scrollbar">
                {loading ? (
                    <div className="h-40 flex items-center justify-center">
                        <div className="text-sm text-gray-400 animate-pulse">{t('analyzing') || 'Analizando métricas históricas de Azure Monitor...'}</div>
                    </div>
                ) : recommendations.length === 0 ? (
                    <div className="text-sm text-green-600 bg-green-50 p-4 rounded-[10px] border border-green-100 flex items-center justify-center text-center font-medium">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                        {t('optimized_desc') || 'Excelente. Ninguna VM está severamente subutilizada en este momento.'}
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-line rounded-[14px]">
                        <table className="tbl w-full">
                            <thead>
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-grey uppercase tracking-wider border-b border-line">{t('col_vm_name') || 'Máquina Virtual'}</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-grey uppercase tracking-wider border-b border-line">{t('col_current_sku') || 'SKU Actual'}</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-grey uppercase tracking-wider border-b border-line">{t('col_recommended_sku') || 'SKU Sugerido (Downgrade)'}</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-grey uppercase tracking-wider border-b border-line">{t('col_peak_cpu') || 'Pico Máx CPU'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recommendations.map((rec, idx) => (
                                    <tr key={idx} className="hover:bg-surface-2 transition-colors border-b border-line last:border-0">
                                        <td className="px-6 py-4 whitespace-nowrap text-[13px] font-bold text-ink">{rec.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[13px] text-ink-soft">{rec.currentSku}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[13px] font-bold text-brand">{rec.recommendedSku}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[13px] text-ink-soft">
                                            <span className="px-2 py-1 bg-[#fff3cd] text-[#856404] rounded-full text-[11px] font-bold">
                                                {rec.maxCpu?.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
