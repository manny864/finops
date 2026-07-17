"use client";
import React, { useEffect, useState, useCallback } from 'react';
import { useTenant } from './TenantProvider';
import { useSubscription } from './SubscriptionProvider';
import { useMsal } from '@azure/msal-react';
import { Info, ShieldAlert, Tag, CheckCircle2, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Pagination, { usePagination } from './Pagination';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import FeatureGuard from './FeatureGuard';
import { csvEscape } from '@/lib/csvExport';

// Autorefresh: la auditoría escanea Azure Resource Graph (llamada con costo),
// así que refrescamos cada 60s SÓLO con la pestaña visible para no malgastar
// consultas en tabs en background.
const AUTO_REFRESH_MS = 60_000;

export default function TagManager() {
    const t = useTranslations();
    const { selectedTenant } = useTenant();
    const { selectedSubscription, subscriptions } = useSubscription();
    const { instance, accounts } = useMsal();
    
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [resources, setResources] = useState<any[]>([]);
    const [resourceGroups, setResourceGroups] = useState<any[]>([]);
    const [editingResource, setEditingResource] = useState<any>(null);
    const [editingScope, setEditingScope] = useState<'resource' | 'rg'>('resource');
    const [tagValues, setTagValues] = useState<Record<string, string>>({});
    const [isApplying, setIsApplying] = useState(false);
    const [complianceScore, setComplianceScore] = useState<number | null>(null);
    const [rgComplianceScore, setRgComplianceScore] = useState<number | null>(null);

    const analyzeCompliance = useCallback(async () => {
        if ((accounts.length === 0 && !isMockTenant(selectedTenant.id)) || selectedTenant.id === 'default') {
            setComplianceScore(null);
            setResources([]);
            setRgComplianceScore(null);
            setResourceGroups([]);
            return;
        }

        setIsAnalyzing(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(
                `/api/tags/compliance?tenantId=${selectedTenant.id}&subscriptionId=${selectedSubscription}`,
                { headers: { 'Authorization': `Bearer ${idToken}` } }
            );
            const json = await res.json();
            
            if (json.success && json.data) {
                setComplianceScore(json.data.complianceScore);
                setResources(json.data.allResources || []);
                setRgComplianceScore(json.data.rgComplianceScore ?? null);
                setResourceGroups(json.data.resourceGroups || []);
            } else {
                setComplianceScore(0);
                setResources([]);
                setRgComplianceScore(0);
                setResourceGroups([]);
            }
        } catch (e) {
            console.error("Error analyzing compliance", e);
        }
        setIsAnalyzing(false);
    }, [selectedTenant, selectedSubscription, accounts]);

    useEffect(() => {
        analyzeCompliance();
    }, [analyzeCompliance]);

    // Autorefresh cada 60s, sólo con la pestaña visible (ahorra llamadas a Azure).
    useEffect(() => {
        if (selectedTenant.id === 'default') return;
        const id = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            analyzeCompliance();
        }, AUTO_REFRESH_MS);
        return () => clearInterval(id);
    }, [analyzeCompliance, selectedTenant]);

    // Paginación de ambas tablas (recursos y grupos de recursos).
    const resPage = usePagination(resources, 10);
    const rgPage = usePagination(resourceGroups, 10);

    // Reporte descargable para auditoría externa (compliance/seguridad):
    // combina recursos + resource groups auditados en un solo CSV, con el
    // mismo detalle que ya se ve en pantalla (estado + etiquetas faltantes).
    const downloadComplianceReport = () => {
        const rows: string[] = [
            ["Ambito", "Nombre", "Tipo", "Suscripcion", "Grupo de Recursos", "Region", "Estado de Cumplimiento", "Etiquetas Faltantes"].map(csvEscape).join(","),
        ];
        const subName = (id: string) => subscriptions.find(s => s.id === id)?.name || id;
        resources.forEach(item => {
            rows.push([
                "Recurso",
                item.name || "Unknown",
                item.type ? item.type.split("/").pop() : "Resource",
                subName(item.subscriptionId),
                item.resourceGroup || "",
                "",
                item.isCompliant ? "Conforme" : "No Conforme",
                item.isCompliant ? "" : (item.missingTags || []).join("; "),
            ].map(csvEscape).join(","));
        });
        resourceGroups.forEach(item => {
            rows.push([
                "Grupo de Recursos",
                item.name || "Unknown",
                "",
                subName(item.subscriptionId),
                item.name || "",
                item.location || "",
                item.isCompliant ? "Conforme" : "No Conforme",
                item.isCompliant ? "" : (item.missingTags || []).join("; "),
            ].map(csvEscape).join(","));
        });
        const csv = rows.join("\n");
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `cumplimiento-etiquetas-${selectedTenant.name || selectedTenant.id}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const applyTags = async () => {
        if (!editingResource) return;
        setIsApplying(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const payload = {
                tenantId: selectedTenant.id,
                resourceId: editingResource.id,
                tags: tagValues
            };
            const res = await fetch('/api/tags/apply', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
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
                analyzeCompliance(); // Refrescar compliance
            }
        } catch (e: any) {
            alert(`Error al aplicar etiquetas: ${e.message}`);
        }
        setIsApplying(false);
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
                <div className="right flex gap-4 bg-surface-2 px-4 py-2 rounded-xl border border-line items-center">
                    <div className="flex flex-col items-end justify-center">
                        <span className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">Recursos</span>
                        {isAnalyzing ? (
                            <span className="text-[12px] font-bold text-brand-deep animate-pulse mt-1">Analizando...</span>
                        ) : (
                            <span className="text-[12px] font-bold text-ink mt-1">
                                {resources.filter(r => !r.isCompliant).length} infracciones
                            </span>
                        )}
                    </div>
                    
                    <div className="relative flex items-center justify-center">
                        <svg className="w-16 h-16 transform -rotate-90">
                            <circle
                                cx="32"
                                cy="32"
                                r="24"
                                stroke="#f1f5f9"
                                strokeWidth="5"
                                fill="transparent"
                            />
                            <circle
                                cx="32"
                                cy="32"
                                r="24"
                                stroke={
                                    complianceScore === null ? '#cbd5e1' :
                                    complianceScore >= 90 ? '#10b981' :
                                    complianceScore >= 70 ? '#f59e0b' : '#ef4444'
                                }
                                strokeWidth="5"
                                fill="transparent"
                                strokeDasharray={150.8}
                                strokeDashoffset={
                                    complianceScore === null
                                        ? 150.8
                                        : 150.8 - (complianceScore / 100) * 150.8
                                }
                                strokeLinecap="round"
                                className="transition-all duration-1000 ease-in-out"
                            />
                        </svg>
                        <div className="absolute text-center">
                            <span className={`text-[12px] font-black ${
                                complianceScore === null ? 'text-slate-400' :
                                complianceScore >= 90 ? 'text-emerald-600' :
                                complianceScore >= 70 ? 'text-amber-500' : 'text-rose-600'
                            }`}>
                                {complianceScore === null ? '-' : `${complianceScore}%`}
                            </span>
                        </div>
                    </div>

                    <div className="w-px h-12 bg-line mx-1" />

                    <div className="flex flex-col items-end justify-center">
                        <span className="text-[11px] font-bold text-grey uppercase tracking-[0.5px]">Grupos de Recursos</span>
                        {isAnalyzing ? (
                            <span className="text-[12px] font-bold text-brand-deep animate-pulse mt-1">Analizando...</span>
                        ) : (
                            <span className="text-[12px] font-bold text-ink mt-1">
                                {resourceGroups.filter(r => !r.isCompliant).length} infracciones
                            </span>
                        )}
                    </div>

                    <div className="relative flex items-center justify-center">
                        <svg className="w-16 h-16 transform -rotate-90">
                            <circle
                                cx="32"
                                cy="32"
                                r="24"
                                stroke="#f1f5f9"
                                strokeWidth="5"
                                fill="transparent"
                            />
                            <circle
                                cx="32"
                                cy="32"
                                r="24"
                                stroke={
                                    rgComplianceScore === null ? '#cbd5e1' :
                                    rgComplianceScore >= 90 ? '#10b981' :
                                    rgComplianceScore >= 70 ? '#f59e0b' : '#ef4444'
                                }
                                strokeWidth="5"
                                fill="transparent"
                                strokeDasharray={150.8}
                                strokeDashoffset={
                                    rgComplianceScore === null
                                        ? 150.8
                                        : 150.8 - (rgComplianceScore / 100) * 150.8
                                }
                                strokeLinecap="round"
                                className="transition-all duration-1000 ease-in-out"
                            />
                        </svg>
                        <div className="absolute text-center">
                            <span className={`text-[12px] font-black ${
                                rgComplianceScore === null ? 'text-slate-400' :
                                rgComplianceScore >= 90 ? 'text-emerald-600' :
                                rgComplianceScore >= 70 ? 'text-amber-500' : 'text-rose-600'
                            }`}>
                                {rgComplianceScore === null ? '-' : `${rgComplianceScore}%`}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tarjeta de Políticas Activas */}
            <div className="card p-[18px] mb-6">
                <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-brand-deep" />
                    Políticas de Etiquetado Globales Activas
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-[11px]">
                    {['Environment', 'Role', 'CostCenter', 'Department'].map((tag) => (
                        <div key={tag} className="flex items-center space-x-3 bg-surface px-4 py-3 rounded-[10px] border border-line shadow-sm">
                            <span className="bg-amber-100 text-amber-800 text-[9px] font-bold px-2 py-0.5 rounded tracking-wider">REQUERIDO</span>
                            <span className="text-[13px] font-mono font-bold text-slate-700">{tag}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Listado de Infracciones */}
            <div className="card overflow-hidden">
                <div className="card-h flex justify-between items-center gap-3">
                    <h3 className="m-0">Auditoría de Etiquetas de Recursos</h3>
                    <div className="flex items-center gap-3">
                        {isAnalyzing && <span className="text-[11px] font-bold text-brand-deep animate-pulse">Escaneando infraestructura...</span>}
                        <button
                            onClick={downloadComplianceReport}
                            disabled={isAnalyzing || (resources.length === 0 && resourceGroups.length === 0)}
                            className="flex items-center gap-[6px] bg-brand-soft text-brand-deep border border-brand-bright/20 hover:border-brand-bright hover:bg-brand-deep hover:text-white px-[11px] py-[7px] rounded-[10px] text-[12px] font-heading font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Descargar Reporte (CSV)
                        </button>
                    </div>
                </div>
                
                {!isAnalyzing && resources.length === 0 ? (
                    <div className="empty flex flex-col items-center py-12">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-slate-100 text-slate-400">
                            <Info className="w-8 h-8" />
                        </div>
                        <h4 className="text-[16px] font-heading font-bold text-ink">
                            No se encontraron etiquetas asignadas en los recursos actuales
                        </h4>
                        <p className="text-[13px] text-ink-soft mt-1">
                            Asegúrate de tener recursos provisionados en Azure para poder auditar sus etiquetas.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="tbl">
                            <thead>
                                <tr>
                                    <th>Recurso</th>
                                    <th>Tipo</th>
                                    <th>Suscripción</th>
                                    <th>Grupo de Recursos</th>
                                    <th>Estado de Cumplimiento</th>
                                    <th>Etiquetas Faltantes</th>
                                    <th className="num">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {resPage.paged.map((item, i) => {
                                    const sub = subscriptions.find(s => s.id === item.subscriptionId);
                                    const subName = sub ? sub.name : item.subscriptionId;
                                    return (
                                        <tr key={`item-${(resPage.page - 1) * resPage.pageSize + i}`}>
                                            <td>
                                                <div className="font-bold text-ink text-[13px]">{item.name || 'Unknown'}</div>
                                            </td>
                                            <td>
                                                <span className="tag grey font-mono">
                                                    {item.type ? item.type.split("/").pop() : 'Resource'}
                                                </span>
                                            </td>
                                            <td className="text-slate-600 text-[13px]">{subName}</td>
                                            <td className="text-slate-600 text-[13px]">{item.resourceGroup}</td>
                                            <td>
                                                {item.isCompliant ? (
                                                    <div className="inline-flex items-center space-x-1 bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-1 rounded-full">
                                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                                        <span>100% Compliant</span>
                                                    </div>
                                                ) : (
                                                    <div className="inline-flex items-center space-x-1 bg-rose-100 text-rose-800 text-[11px] font-bold px-2 py-1 rounded-full">
                                                        <ShieldAlert className="w-3.5 h-3.5" />
                                                        <span>No Conforme</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                <div className="flex flex-wrap gap-[7px]">
                                                    {item.isCompliant ? (
                                                        <span className="text-slate-400 text-xs italic">Ninguna</span>
                                                    ) : (
                                                        item.missingTags.map((tag: string, idx: number) => (
                                                            <span key={idx} className="tag red">
                                                                {tag}
                                                            </span>
                                                        ))
                                                    )}
                                                </div>
                                            </td>
                                            <td className="num">
                                                {!item.isCompliant && (
                                                    <FeatureGuard requiredTier="Business" featureName="Remediación de Etiquetas" className="inline-block">
                                                        <button
                                                            onClick={() => {
                                                                setEditingResource(item);
                                                                setEditingScope('resource');
                                                                const initVals: Record<string,string> = {};
                                                                item.missingTags.forEach((t: string) => initVals[t] = "");
                                                                setTagValues(initVals);
                                                            }}
                                                            className="bg-brand-soft text-brand-deep border border-brand-bright/20 hover:border-brand-bright hover:bg-brand-deep hover:text-white px-[11px] py-[7px] rounded-[10px] text-[12px] font-heading font-semibold transition-colors cursor-pointer"
                                                        >
                                                            Editar Etiquetas
                                                        </button>
                                                    </FeatureGuard>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div className="px-4 pb-3">
                            <Pagination
                                page={resPage.page} setPage={resPage.setPage}
                                pageSize={resPage.pageSize} setPageSize={resPage.setPageSize}
                                total={resPage.total} totalPages={resPage.totalPages}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Auditoría de Grupos de Recursos */}
            <div className="card overflow-hidden mt-6">
                <div className="card-h flex justify-between items-center">
                    <h3 className="m-0">Auditoría de Etiquetas de Grupos de Recursos</h3>
                    {isAnalyzing && <span className="text-[11px] font-bold text-brand-deep animate-pulse">Escaneando grupos...</span>}
                </div>

                {!isAnalyzing && resourceGroups.length === 0 ? (
                    <div className="empty flex flex-col items-center py-12">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-slate-100 text-slate-400">
                            <Info className="w-8 h-8" />
                        </div>
                        <h4 className="text-[16px] font-heading font-bold text-ink">
                            No se encontraron grupos de recursos
                        </h4>
                        <p className="text-[13px] text-ink-soft mt-1">
                            Asegúrate de tener Resource Groups provisionados en las suscripciones seleccionadas.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="tbl">
                            <thead>
                                <tr>
                                    <th>Grupo de Recursos</th>
                                    <th>Suscripción</th>
                                    <th>Región</th>
                                    <th>Estado de Cumplimiento</th>
                                    <th>Etiquetas Faltantes</th>
                                    <th className="num">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rgPage.paged.map((item, i) => {
                                    const sub = subscriptions.find(s => s.id === item.subscriptionId);
                                    const subName = sub ? sub.name : item.subscriptionId;
                                    return (
                                        <tr key={`rg-${(rgPage.page - 1) * rgPage.pageSize + i}`}>
                                            <td>
                                                <div className="font-bold text-ink text-[13px]">{item.name || 'Unknown'}</div>
                                            </td>
                                            <td className="text-slate-600 text-[13px]">{subName}</td>
                                            <td className="text-slate-600 text-[13px]">{item.location || '-'}</td>
                                            <td>
                                                {item.isCompliant ? (
                                                    <div className="inline-flex items-center space-x-1 bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-1 rounded-full">
                                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                                        <span>100% Compliant</span>
                                                    </div>
                                                ) : (
                                                    <div className="inline-flex items-center space-x-1 bg-rose-100 text-rose-800 text-[11px] font-bold px-2 py-1 rounded-full">
                                                        <ShieldAlert className="w-3.5 h-3.5" />
                                                        <span>No Conforme</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                <div className="flex flex-wrap gap-[7px]">
                                                    {item.isCompliant ? (
                                                        <span className="text-slate-400 text-xs italic">Ninguna</span>
                                                    ) : (
                                                        item.missingTags.map((tag: string, idx: number) => (
                                                            <span key={idx} className="tag red">
                                                                {tag}
                                                            </span>
                                                        ))
                                                    )}
                                                </div>
                                            </td>
                                            <td className="num">
                                                {!item.isCompliant && (
                                                    <FeatureGuard requiredTier="Business" featureName="Remediación de Etiquetas" className="inline-block">
                                                        <button
                                                            onClick={() => {
                                                                setEditingResource(item);
                                                                setEditingScope('rg');
                                                                const initVals: Record<string,string> = {};
                                                                item.missingTags.forEach((t: string) => initVals[t] = "");
                                                                setTagValues(initVals);
                                                            }}
                                                            className="bg-brand-soft text-brand-deep border border-brand-bright/20 hover:border-brand-bright hover:bg-brand-deep hover:text-white px-[11px] py-[7px] rounded-[10px] text-[12px] font-heading font-semibold transition-colors cursor-pointer"
                                                        >
                                                            Editar Etiquetas
                                                        </button>
                                                    </FeatureGuard>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div className="px-4 pb-3">
                            <Pagination
                                page={rgPage.page} setPage={rgPage.setPage}
                                pageSize={rgPage.pageSize} setPageSize={rgPage.setPageSize}
                                total={rgPage.total} totalPages={rgPage.totalPages}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Modal de Edición de Etiquetas */}
            {editingResource && (
                <div className="fixed inset-0 bg-ink/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in">
                    <div className="card w-full max-w-lg overflow-hidden shadow-xl">
                        <div className="card-h border-b border-line bg-surface-2">
                            <h3 className="text-[16px] font-heading font-bold text-ink m-0">
                                Aplicar Etiquetas Requeridas {editingScope === 'rg' ? '— Grupo de Recursos' : '— Recurso'}
                            </h3>
                            <p className="text-[13px] text-ink-soft m-0 mt-1 truncate">{editingResource.name}</p>
                        </div>
                        <div className="p-6 space-y-4">
                            {editingResource.missingTags.map((tag: string) => (
                                <div key={tag}>
                                    <label className="block text-[11px] font-bold text-grey uppercase tracking-[0.5px] mb-2">{tag}</label>
                                    <input 
                                        type="text" 
                                        value={tagValues[tag] || ''} 
                                        onChange={e => setTagValues({...tagValues, [tag]: e.target.value})}
                                        className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none placeholder-ink-soft"
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
