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
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
            <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-200">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
                    <div className="flex items-center space-x-4">
                        <div className="p-3 bg-blue-50 text-[#0054A6] rounded-lg">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path></svg>
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-gray-800 flex items-center">
                                Gobernanza de Etiquetas (Tags)
                                <div className="relative group ml-2 flex items-center">
                                    <Info className="w-5 h-5 text-gray-400 hover:text-[#0054A6] cursor-help transition-colors" />
                                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg z-10 text-center pointer-events-none">
                                        {t('governance.tagInfoTooltip')}
                                        <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900"></div>
                                    </div>
                                </div>
                            </h3>
                            <p className="text-sm text-gray-500">Fuerza el cumplimiento de etiquetas para el tenant: <span className="font-semibold text-gray-700">{selectedTenant.name}</span></p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 bg-gray-50 px-6 py-4 rounded-xl border border-gray-100">
                        <div className="flex flex-col items-end">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Compliance Score</span>
                            {isAnalyzing ? (
                                <span className="text-sm font-medium text-blue-500 animate-pulse mt-1">Analizando Azure...</span>
                            ) : (
                                <span className="text-sm font-medium text-gray-600 mt-1">
                                    {nonCompliantResources.length} infracciones
                                </span>
                            )}
                        </div>
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center border-4 ${complianceScore === null ? 'border-gray-200' : complianceScore === -1 ? 'border-gray-300 text-gray-500' : complianceScore >= 90 ? 'border-green-500 text-green-600' : complianceScore >= 70 ? 'border-amber-400 text-amber-500' : 'border-red-500 text-red-600'}`}>
                            <span className="text-xl font-bold">
                                {complianceScore === null ? '-' : complianceScore === -1 ? 'N/A' : `${complianceScore}%`}
                            </span>
                        </div>
                    </div>
                </div>
                
                <div className="flex space-x-2 mb-6 bg-gray-50 p-4 rounded-lg border border-gray-100 items-center">
                    <div className="relative group mr-1">
                        <Info className="w-5 h-5 text-gray-400 hover:text-[#0054A6] cursor-help transition-colors" />
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-gray-900 text-white text-xs rounded shadow-lg z-10 text-center pointer-events-none">
                            {t('governance.tagInputTooltip')}
                            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900"></div>
                        </div>
                    </div>
                    <input 
                        type="text" 
                        value={newTag} 
                        onChange={e => setNewTag(e.target.value)} 
                        placeholder="Ej. CostCenter, Environment..." 
                        className="flex-1 border border-gray-300 rounded-md px-4 py-2 text-sm focus:ring-[#0054A6] focus:border-[#0054A6] shadow-sm"
                    />
                    <button onClick={addPolicy} className="bg-[#0054A6] text-white px-6 py-2 rounded-md text-sm font-semibold hover:bg-blue-800 transition-colors shadow-sm">
                        + Añadir Regla Obligatoria
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {loading ? <div className="text-sm text-gray-400 animate-pulse">Cargando políticas...</div> : 
                     policies.length === 0 ? <div className="text-sm text-gray-400">No hay reglas estrictas.</div> : 
                     policies.map(p => (
                        <div key={p.id} className="flex justify-between items-center bg-white px-4 py-3 rounded-lg border border-gray-200 shadow-sm hover:border-blue-200 transition-colors group">
                            <div className="flex items-center space-x-3">
                                <span className="bg-red-50 text-red-700 border border-red-100 text-[9px] font-bold px-2 py-0.5 rounded tracking-wider">REQUERIDO</span>
                                <span className="text-sm font-mono font-bold text-gray-800 truncate">{p.tag_key}</span>
                            </div>
                            <button onClick={() => deletePolicy(p.id)} className="text-gray-300 hover:text-red-600 transition-colors">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-gray-800">Recursos No Conformes (Infracciones)</h3>
                    {isAnalyzing && <span className="text-xs text-blue-600 font-medium animate-pulse">Escaneando infraestructura...</span>}
                </div>
                
                {!isAnalyzing && nonCompliantResources.length === 0 ? (
                    <div className="p-12 text-center flex flex-col items-center">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${policies.length === 0 ? 'bg-gray-50 text-gray-400' : 'bg-green-50 text-green-500'}`}>
                            {policies.length === 0 ? (
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            ) : (
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                            )}
                        </div>
                        <h4 className="text-lg font-bold text-gray-800">
                            {policies.length === 0 ? 'Sin Reglas Activas' : '¡Infraestructura Impecable!'}
                        </h4>
                        <p className="text-sm text-gray-500 mt-1">
                            {policies.length === 0 ? 'Añade una etiqueta obligatoria arriba para comenzar a medir el compliance.' : 'Todos los recursos cumplen con las políticas de etiquetado requeridas.'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                                    <th className="p-4">Recurso</th>
                                    <th className="p-4">Tipo</th>
                                    <th className="p-4">Etiquetas Faltantes</th>
                                    <th className="p-4 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {nonCompliantResources.map((item, i) => (
                                    <tr key={`item-${i}`} className="border-b border-gray-100 hover:bg-red-50/30 transition-colors">
                                        <td className="p-4 text-sm font-semibold text-gray-800">
                                            {item.name || item.resourceName || 'Unknown'}
                                        </td>
                                        <td className="p-4 text-xs font-mono text-gray-500">
                                            {item.type ? item.type.split("/").pop() : 'Resource'}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-wrap gap-2">
                                                {item.missingTags.map((tag: string, idx: number) => (
                                                    <span key={idx} className="bg-red-100 text-red-700 border border-red-200 text-xs font-medium px-2 py-0.5 rounded shadow-sm">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <button 
                                                onClick={() => {
                                                    setEditingResource(item);
                                                    const initVals: Record<string,string> = {};
                                                    item.missingTags.forEach((t: string) => initVals[t] = "");
                                                    setTagValues(initVals);
                                                }}
                                                className="px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 rounded text-xs font-semibold transition-colors"
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
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-gray-200">
                        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                            <h3 className="text-lg font-bold text-gray-800">Aplicar Etiquetas Requeridas</h3>
                            <p className="text-sm text-gray-500 mt-1 truncate">{editingResource.name || editingResource.resourceName}</p>
                        </div>
                        <div className="p-6 space-y-4">
                            {editingResource.missingTags.map((tag: string) => (
                                <div key={tag}>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">{tag}</label>
                                    <input 
                                        type="text" 
                                        value={tagValues[tag] || ''} 
                                        onChange={e => setTagValues({...tagValues, [tag]: e.target.value})}
                                        className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-[#0054A6] focus:border-[#0054A6]"
                                        placeholder={`Valor para ${tag}`}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end space-x-3">
                            <button 
                                onClick={() => setEditingResource(null)}
                                className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                disabled={isApplying}
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={applyTags}
                                disabled={isApplying || Object.values(tagValues).some(v => !v.trim())}
                                className="px-4 py-2 text-sm font-semibold bg-[#0054A6] text-white hover:bg-blue-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
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
