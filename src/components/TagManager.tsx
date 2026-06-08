"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from './TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function TagManager() {
    const t = useTranslations();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [policies, setPolicies] = useState<any[]>([]);
    const [newTag, setNewTag] = useState('');
    const [loading, setLoading] = useState(false);
    
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [nonCompliantResources, setNonCompliantResources] = useState<any[]>([]);
    const [editingResource, setEditingResource] = useState<any>(null);
    const [tagValues, setTagValues] = useState<Record<string, string>>({});
    const [isApplying, setIsApplying] = useState(false);
    const [complianceScore, setComplianceScore] = useState<number | null>(null);

    const fetchPolicies = async () => {
        if (selectedTenant.id === 'default') return;
        setLoading(true);
        try {
            const res = await fetch(`/api/tags?tenantId=${selectedTenant.id}`);
            const data = await res.json();
            if (data.policies) setPolicies(data.policies);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPolicies();
    }, [selectedTenant]);

    useEffect(() => {
        const analyzeCompliance = async () => {
            if (policies.length === 0 || accounts.length === 0 || selectedTenant.id === 'default') {
                setComplianceScore(policies.length === 0 ? -1 : null);
                setNonCompliantResources([]);
                return;
            }
            
            setIsAnalyzing(true);
            try {
                const res = await fetch(`/api/tags/compliance?tenantId=${selectedTenant.id}`);
                const json = await res.json();
                
                if (json.total !== undefined) {
                    const total = json.total;
                    const nonCompliant = json.nonCompliant || [];
                    const compliantCount = total - nonCompliant.length;
                    
                    const score = total === 0 ? 100 : Math.round((compliantCount / total) * 100);
                    
                    setComplianceScore(score);
                    setNonCompliantResources(nonCompliant);
                }
            } catch (e) {
                console.error("Error analyzing compliance", e);
            }
            setIsAnalyzing(false);
        };
        
        analyzeCompliance();
    }, [policies, selectedTenant, accounts, instance]);

    
    const applyTags = async () => {
        if (!editingResource) return;
        setIsApplying(true);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            const payload = {
                tenantId: selectedTenant.id,
                resourceId: editingResource.id,
                tags: tagValues
            };
            const res = await fetch('/api/tags/apply', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenResponse.idToken}` 
                },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!res.ok) {
                alert(`Error: ${json.details || json.error}`);
            } else {
                alert("¡Etiquetas aplicadas correctamente en Azure!");
                setEditingResource(null);
                setTagValues({});
                fetchPolicies(); // Refrescar compliance
            }
        } catch (e: any) {
            alert(`Error al aplicar etiquetas: ${e.message}`);
        }
        setIsApplying(false);
    };

    const addPolicy = async () => {
        if (!newTag.trim() || selectedTenant.id === 'default') return;
        try {
            await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId: selectedTenant.id, tagKey: newTag.trim(), required: true })
            });
            setNewTag('');
            fetchPolicies();
        } catch (e) {
            console.error(e);
        }
    };

    const deletePolicy = async (id: number) => {
        try {
            await fetch('/api/tags', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            fetchPolicies();
        } catch (e) {
            console.error(e);
        }
    };

    if (selectedTenant.id === 'default') {
        return <div className="bg-white rounded-lg p-12 text-center border border-gray-200 text-gray-500 shadow-sm">Selecciona un cliente en la cabecera para gestionar sus políticas de etiquetado.</div>;
    }

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">🏷️</span>
                        Gobernanza de Etiquetas (Tags)
                    </div>
                    <div className="vs">Fuerza el cumplimiento de etiquetas para el tenant: <span className="font-semibold">{selectedTenant.name}</span></div>
                </div>
                <div className="right flex gap-4 bg-surface-2 px-4 py-2 rounded-xl border border-line">
                    <div className="flex flex-col items-end justify-center">
                        <span className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">Compliance Score</span>
                        {isAnalyzing ? (
                            <span className="text-[12px] font-bold text-brand-deep animate-pulse mt-1">Analizando Azure...</span>
                        ) : (
                            <span className="text-[12px] font-bold text-ink mt-1">
                                {nonCompliantResources.length} infracciones
                            </span>
                        )}
                    </div>
                    <div className={`w-[48px] h-[48px] rounded-full flex items-center justify-center border-[3px] ${complianceScore === null ? 'border-line' : complianceScore === -1 ? 'border-line text-grey' : complianceScore >= 90 ? 'border-green text-green' : complianceScore >= 70 ? 'border-amber text-amber' : 'border-danger text-danger'}`}>
                        <span className="text-[14px] font-heading font-extrabold">
                            {complianceScore === null ? '-' : complianceScore === -1 ? 'N/A' : `${complianceScore}%`}
                        </span>
                    </div>
                </div>
            </div>

            <div className="card p-[18px] mb-6">
                <div className="flex space-x-2 bg-surface-2 p-4 rounded-[10px] border border-line items-center mb-4">
                    <div className="relative group mr-1">
                        <Info className="w-5 h-5 text-grey hover:text-brand-deep cursor-help transition-colors" />
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-ink text-white text-[11px] rounded shadow-sm z-10 text-center pointer-events-none">
                            {t('governance.tagInputTooltip')}
                            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-ink"></div>
                        </div>
                    </div>
                    <input 
                        type="text" 
                        value={newTag} 
                        onChange={e => setNewTag(e.target.value)} 
                        placeholder="Ej. CostCenter, Environment..." 
                        className="flex-1 bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none"
                    />
                    <button onClick={addPolicy} className="bg-brand-deep text-white px-[11px] py-[7px] rounded-[10px] font-heading font-bold text-[12px] hover:brightness-110 shadow-sm transition-colors cursor-pointer">
                        + Añadir Regla Obligatoria
                    </button>
                </div>

                <div className="grid-2 md:grid-cols-3 gap-[11px]">
                    {loading ? <div className="text-[13px] text-ink-soft animate-pulse">Cargando políticas...</div> : 
                     policies.length === 0 ? <div className="text-[13px] text-ink-soft">No hay reglas estrictas.</div> : 
                     policies.map(p => (
                        <div key={p.id} className="flex justify-between items-center bg-surface px-4 py-3 rounded-[10px] border border-line shadow-sm hover:border-brand-bright transition-colors group">
                            <div className="flex items-center space-x-3">
                                <span className="bg-danger-soft text-danger border border-danger/20 text-[9px] font-bold px-2 py-0.5 rounded tracking-wider">REQUERIDO</span>
                                <span className="text-[13px] font-mono font-bold text-ink truncate">{p.tag_key}</span>
                            </div>
                            <button onClick={() => deletePolicy(p.id)} className="text-grey hover:text-danger transition-colors cursor-pointer">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="card overflow-hidden">
                <div className="card-h flex justify-between items-center">
                    <h3 className="m-0">Recursos No Conformes (Infracciones)</h3>
                    {isAnalyzing && <span className="text-[11px] font-bold text-brand-deep animate-pulse">Escaneando infraestructura...</span>}
                </div>
                
                {!isAnalyzing && nonCompliantResources.length === 0 ? (
                    <div className="empty flex flex-col items-center">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${policies.length === 0 ? 'bg-surface-2 text-grey' : 'bg-green-soft text-green'}`}>
                            {policies.length === 0 ? (
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            ) : (
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                            )}
                        </div>
                        <h4 className="text-[16px] font-heading font-bold text-ink">
                            {policies.length === 0 ? 'Sin Reglas Activas' : '¡Infraestructura Impecable!'}
                        </h4>
                        <p className="text-[13px] text-ink-soft mt-1">
                            {policies.length === 0 ? 'Añade una etiqueta obligatoria arriba para comenzar a medir el compliance.' : 'Todos los recursos cumplen con las políticas de etiquetado requeridas.'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="tbl">
                            <thead>
                                <tr>
                                    <th>Recurso</th>
                                    <th>Tipo</th>
                                    <th>Etiquetas Faltantes</th>
                                    <th className="num">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {nonCompliantResources.map((item, i) => (
                                    <tr key={`item-${i}`}>
                                        <td>
                                            <div className="font-bold text-ink text-[13px]">{item.name || item.resourceName || 'Unknown'}</div>
                                        </td>
                                        <td>
                                            <span className="tag grey font-mono">
                                                {item.type ? item.type.split("/").pop() : 'Resource'}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="flex flex-wrap gap-[7px]">
                                                {item.missingTags.map((tag: string, idx: number) => (
                                                    <span key={idx} className="tag red">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="num">
                                            <button 
                                                onClick={() => {
                                                    setEditingResource(item);
                                                    const initVals: Record<string,string> = {};
                                                    item.missingTags.forEach((t: string) => initVals[t] = "");
                                                    setTagValues(initVals);
                                                }}
                                                className="bg-brand-soft text-brand-deep border border-brand-bright/20 hover:border-brand-bright hover:bg-brand-deep hover:text-white px-[11px] py-[7px] rounded-[10px] text-[12px] font-heading font-semibold transition-colors cursor-pointer"
                                            >
                                                Editar Etiquetas
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal de Edición de Etiquetas */}
            {editingResource && (
                <div className="fixed inset-0 bg-ink/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in">
                    <div className="card w-full max-w-lg overflow-hidden shadow-xl">
                        <div className="card-h border-b border-line bg-surface-2">
                            <h3 className="text-[16px] font-heading font-bold text-ink m-0">Aplicar Etiquetas Requeridas</h3>
                            <p className="text-[13px] text-ink-soft m-0 mt-1 truncate">{editingResource.name || editingResource.resourceName}</p>
                        </div>
                        <div className="p-6 space-y-4">
                            {editingResource.missingTags.map((tag: string) => (
                                <div key={tag}>
                                    <label className="block text-[11px] font-bold text-grey uppercase tracking-[0.5px] mb-2">{tag}</label>
                                    <input 
                                        type="text" 
                                        value={tagValues[tag] || ''} 
                                        onChange={e => setTagValues({...tagValues, [tag]: e.target.value})}
                                        className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none"
                                        placeholder={`Valor para ${tag}`}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="px-6 py-4 bg-surface-2 border-t border-line flex justify-end space-x-3">
                            <button 
                                onClick={() => setEditingResource(null)}
                                className="px-[11px] py-[7px] text-[12px] font-heading font-semibold text-grey hover:text-ink hover:bg-surface rounded-[10px] transition-colors cursor-pointer"
                                disabled={isApplying}
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={applyTags}
                                disabled={isApplying || Object.values(tagValues).some(v => !v.trim())}
                                className="px-[11px] py-[7px] text-[12px] font-heading font-bold bg-brand-deep text-white hover:brightness-110 rounded-[10px] shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center cursor-pointer"
                            >
                                {isApplying ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                        Aplicando en Azure...
                                    </>
                                ) : "Aplicar a Azure"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
