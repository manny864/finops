"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from './TenantProvider';
import { useMsal } from '@azure/msal-react';

export default function TagManager() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [policies, setPolicies] = useState<any[]>([]);
    const [newTag, setNewTag] = useState('');
    const [loading, setLoading] = useState(false);
    
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [nonCompliantResources, setNonCompliantResources] = useState<any[]>([]);
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
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const res = await fetch(`/api/audit/full?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                
                if (json.auditResults) {
                    const allItems = Object.values(json.auditResults).flat();
                    const requiredKeys = policies.filter(p => p.required).map(p => p.tag_key.toLowerCase());
                    
                    let compliantCount = 0;
                    let nonCompliant: any[] = [];

                    allItems.forEach((item: any) => {
                        const itemTags = item.tags || {};
                        const itemTagKeys = Object.keys(itemTags).map(k => k.toLowerCase());
                        
                        const missingTags = requiredKeys.filter(reqKey => !itemTagKeys.includes(reqKey));
                        
                        if (missingTags.length === 0) {
                            compliantCount++;
                        } else {
                            nonCompliant.push({
                                ...item,
                                missingTags
                            });
                        }
                    });

                    const total = allItems.length;
                    const score = total === 0 ? 100 : Math.round((compliantCount / total) * 100);
                    
                    const uniqueNonCompliant = Array.from(new Map(nonCompliant.map(item => [item.id, item])).values());
                    
                    setComplianceScore(score);
                    setNonCompliantResources(uniqueNonCompliant);
                }
            } catch (e) {
                console.error("Error analyzing compliance", e);
            }
            setIsAnalyzing(false);
        };
        
        analyzeCompliance();
    }, [policies, selectedTenant, accounts, instance]);

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
                            <h3 className="text-xl font-bold text-gray-800">Gobernanza de Etiquetas (Tags)</h3>
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
                
                <div className="flex space-x-2 mb-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
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
