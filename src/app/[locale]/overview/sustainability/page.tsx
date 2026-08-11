"use client";
import React, { useState, useEffect } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { Leaf, Wind, Zap, Loader2, Car, TreePine, Smartphone, MapPin, TrendingDown } from "lucide-react";
import { IconLeaf } from "@tabler/icons-react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import MockBanner from "@/components/MockBanner";
import { useMsal } from "@azure/msal-react";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";

interface RegionRow { region: string; kgCO2e: number; resources: number; intensity: number; }
interface Recommendation {
    fromRegion: string; toRegion: string; currentIntensity: number; targetIntensity: number;
    reductionPct: number; projectedReductionKgCO2: number; impactedResources: number;
}
interface Equivalencies { carKm: number; treesYear: number; phoneCharges: number; }
interface SustainData {
    footprint: number; avoided: number; vmCount: number; zombieCount: number; storageCount: number;
    byRegion: RegionRow[]; recommendations: Recommendation[]; equivalencies: Equivalencies;
}

export default function SustainabilityPage() {
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const t = useProviderTranslations("Sustainability");
    const { instance, accounts } = useMsal();
    const account = accounts[0];
    const [data, setData] = useState<SustainData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchData() {
            if (!selectedTenant || selectedTenant.id === "default" || !selectedSubscription || (!account && !isMockTenant(selectedTenant.id))) {
                setLoading(false); return;
            }
            setLoading(true); setError(null);
            try {
                const res = await fetchWithAuthRetry(
                    instance, account,
                    `/api/intelligence/sustainability?tenantId=${selectedTenant.id}&subscriptionId=${selectedSubscription}`
                );
                const json = await res.json();
                if (!json.success) { setError(json.error || "Error"); }
                else { setData(json); }
            } catch (e: any) {
                setError(e?.message || "Error de red");
            } finally { setLoading(false); }
        }
        fetchData();
    }, [selectedTenant, selectedSubscription, account]);

    const fp = data?.footprint || 0;
    const av = data?.avoided || 0;

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#10b981] to-[#047857]">
                            <IconLeaf className="w-5 h-5" />
                        </span>
                        {t("greenFinops")}
                    </div>
                    <div className="vs">{t("subtitle")}</div>
                </div>
            </div>
            <MockBanner />

            {loading && (
                <div className="flex items-center gap-2 text-ink-soft mb-4">
                    <Loader2 className="w-4 h-4 animate-spin" /> Calculando emisiones...
                </div>
            )}
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm mb-4">{error}</div>
            )}

            <div className="grid-3 mb-6">
                <div className="card">
                    <div className="p-5 flex items-center justify-between">
                        <div>
                            <p className="text-grey text-[11px] font-bold uppercase tracking-wider mb-1">{t("totalCarbonFootprint")}</p>
                            <h3 className="text-ink font-heading font-extrabold text-2xl">{fp.toFixed(2)} <span className="text-sm font-normal text-ink-soft">kg CO2e/mes</span></h3>
                            {data && <p className="text-xs text-ink-soft mt-1">{data.vmCount} VMs · {data.storageCount} storage accts</p>}
                        </div>
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                            <Leaf className="w-5 h-5" />
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="p-5 flex items-center justify-between">
                        <div>
                            <p className="text-grey text-[11px] font-bold uppercase tracking-wider mb-1">{t("avoidedEmissions")}</p>
                            <h3 className="text-ink font-heading font-extrabold text-2xl text-emerald-600">{av.toFixed(2)} <span className="text-sm font-normal text-emerald-600/70">kg CO2e</span></h3>
                            {data && <p className="text-xs text-ink-soft mt-1">eliminando {data.zombieCount} discos zombi</p>}
                        </div>
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                            <Wind className="w-5 h-5" />
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="p-5 flex items-center justify-between">
                        <div>
                            <p className="text-grey text-[11px] font-bold uppercase tracking-wider mb-1">Reducción potencial</p>
                            <h3 className="text-ink font-heading font-extrabold text-2xl text-amber-600">
                                {data?.recommendations.reduce((a, r) => a + r.projectedReductionKgCO2, 0).toFixed(2) || "0.00"}
                                <span className="text-sm font-normal text-amber-600/70 ml-1">kg CO2e</span>
                            </h3>
                            <p className="text-xs text-ink-soft mt-1">migrando a regiones verdes</p>
                        </div>
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                            <Zap className="w-5 h-5" />
                        </div>
                    </div>
                </div>
            </div>

            {data && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="card p-4 text-center">
                        <Car className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                        <p className="text-2xl font-bold">{data.equivalencies.carKm.toLocaleString()}</p>
                        <p className="text-xs text-ink-soft">km en auto a gasolina equivalente</p>
                    </div>
                    <div className="card p-4 text-center">
                        <TreePine className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                        <p className="text-2xl font-bold">{data.equivalencies.treesYear}</p>
                        <p className="text-xs text-ink-soft">árboles maduros absorbiendo CO2 un año</p>
                    </div>
                    <div className="card p-4 text-center">
                        <Smartphone className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                        <p className="text-2xl font-bold">{data.equivalencies.phoneCharges.toLocaleString()}</p>
                        <p className="text-xs text-ink-soft">cargas de smartphone</p>
                    </div>
                </div>
            )}

            {data && data.byRegion.length > 0 && (
                <div className="card p-6 mb-6">
                    <h4 className="text-lg font-bold mb-4 flex items-center gap-2"><MapPin className="w-5 h-5" /> Emisiones por región</h4>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead><tr className="border-b text-left text-xs uppercase text-gray-500">
                                <th className="py-2">Región</th><th className="py-2">Recursos</th>
                                <th className="py-2">Intensidad (g/kWh)</th><th className="py-2">kg CO2e/mes</th>
                            </tr></thead>
                            <tbody>
                                {data.byRegion.sort((a, b) => b.kgCO2e - a.kgCO2e).map(r => (
                                    <tr key={r.region} className="border-b">
                                        <td className="py-2 font-medium">{r.region}</td>
                                        <td className="py-2">{r.resources}</td>
                                        <td className="py-2">
                                            <span className={r.intensity < 100 ? "text-emerald-600" : r.intensity < 300 ? "text-amber-600" : "text-red-600"}>
                                                {r.intensity}
                                            </span>
                                        </td>
                                        <td className="py-2 font-mono">{r.kgCO2e.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {data && data.recommendations.length > 0 && (
                <div className="card p-6">
                    <h4 className="text-lg font-bold mb-4 flex items-center gap-2"><TrendingDown className="w-5 h-5 text-emerald-600" /> Recomendaciones de migración a regiones verdes</h4>
                    <div className="space-y-2">
                        {data.recommendations.map((r, i) => (
                            <div key={i} className="flex flex-wrap items-center justify-between p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded">
                                <div>
                                    <span className="font-medium">{r.fromRegion}</span> <span className="text-ink-soft">({r.currentIntensity} g/kWh)</span>
                                    {" → "}
                                    <span className="font-medium text-emerald-700 dark:text-emerald-300">{r.toRegion}</span> <span className="text-ink-soft">({r.targetIntensity} g/kWh)</span>
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-emerald-600">-{r.reductionPct}%</div>
                                    <div className="text-xs text-ink-soft">~{r.projectedReductionKgCO2} kg CO2e/mes evitados · {r.impactedResources} recursos</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
