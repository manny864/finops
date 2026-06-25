"use client";
import React, { useState } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, ShieldAlert, CheckCircle2, XCircle, Plus, Trash2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { hasAccess } from '@/lib/tierLogic';

export default function PoliciesAsCode() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tier = (selectedTenant as any)?.tier || 'Essential';
    const isEnterprise = hasAccess(tier, 'Enterprise');
    
    const [toggling, setToggling] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 5;

    const [selectedNewMg, setSelectedNewMg] = useState('');
    const [selectedNewPolicy, setSelectedNewPolicy] = useState('');
    const [policySearch, setPolicySearch] = useState('');
    const [showPolicyDropdown, setShowPolicyDropdown] = useState(false);
    const [assignmentName, setAssignmentName] = useState('');
    const [policyParams, setPolicyParams] = useState<Record<string, any>>({});
    const [nonComplianceMessage, setNonComplianceMessage] = useState('');
    const [createIdentity, setCreateIdentity] = useState(false);
    const [identityLocation, setIdentityLocation] = useState('eastus');
    const [activeTab, setActiveTab] = useState('all');

    const fetcher = async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error("No hay cuenta autenticada");

        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: account
        });

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
        });

        if (!res.ok) {
            const json = await res.json();
            console.error("Detalles del error del servidor:", json);
            throw new Error(json.details || json.error || "Error al aplicar la política");
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (isEnterprise && selectedTenant && selectedTenant.id !== 'default' && accounts.length > 0) 
            ? `/api/admin/governance-policies?tenantId=${selectedTenant.id}&tier=${tier}` 
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const { data: defData, error: defError } = useSWR(
        (isEnterprise && selectedTenant && selectedTenant.id !== 'default' && accounts.length > 0) 
            ? `/api/admin/azure-policies?tenantId=${selectedTenant.id}&tier=${tier}&subscriptionId=${(accounts[0] as any)?.id || ''}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const handleAssignNew = async () => {
        if (!selectedNewMg || !selectedNewPolicy) {
            toast.error("Selecciona Scope y Política");
            return;
        }
        setToggling('new');
        try {
            const account = accounts[0];
            const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
            
            const response = await fetch(`/api/admin/governance-policies`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenResponse.idToken}`
                },
                body: JSON.stringify({ 
                    tenantId: selectedTenant.id, 
                    policyId: selectedNewPolicy,
                    displayName: assignmentName || undefined,
                    action: 'Assign', 
                    targetMg: selectedNewMg,
                    parameters: policyParams,
                    nonComplianceMessages: nonComplianceMessage ? [nonComplianceMessage] : [],
                    identity: createIdentity,
                    location: createIdentity ? identityLocation : undefined
                })
            });

            const resData = await response.json();
            if (!response.ok) {
                console.error("Error al asignar política:", resData);
                throw new Error(resData.details || resData.error || "Fallo en la inyección de la política");
            }
            
            toast.success(resData.message);
            setSelectedNewPolicy('');
            setPolicySearch('');
            setAssignmentName('');
            setSelectedNewMg('');
            setPolicyParams({});
            setNonComplianceMessage('');
            setCreateIdentity(false);
            mutate();
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setToggling(null);
        }
    };

    const handleDeleteAssignment = async (assignmentId: string, targetMg: string) => {
        if (!confirm("¿Seguro que deseas remover esta política?")) return;
        setToggling(assignmentId);
        try {
            const account = accounts[0];
            const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
            
            const response = await fetch(`/api/admin/governance-policies`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenResponse.idToken}`
                },
                body: JSON.stringify({ tenantId: selectedTenant.id, policyId: assignmentId, action: 'Deactivate', targetMg })
            });

            const resData = await response.json();
            if (!response.ok) throw new Error(resData.error || "Fallo al remover la política");
            
            toast.success(resData.message);
            mutate();
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setToggling(null);
        }
    };

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (!isEnterprise) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Policies as Code</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        Despliega restricciones automatizadas mediante Azure Policy para prevenir gastos indeseados desde el momento del aprovisionamiento.
                        Esta característica está disponible exclusivamente en el plan <b>Enterprise</b>.
                    </p>
                    <button className="px-6 py-3 bg-brand-deep text-white font-bold rounded-lg shadow hover:bg-brand-bright transition-colors">
                        Actualizar a Enterprise
                    </button>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Escaneando asignaciones de Azure Policy...</p>
            </div>
        );
    }

    if (error) {
        if (error.message.includes("permisos") || error.message.includes("Reader") || error.message.includes("403")) {
            return (
                <div className="p-6">
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                        <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-4" />
                        <h2 className="text-2xl font-bold text-red-900 dark:text-red-100 mb-2">Permisos Insuficientes</h2>
                        <p className="text-red-700 dark:text-red-300 mb-6">
                            Para gestionar dinámicamente las políticas y descubrir los Management Groups, el Service Principal asociado a este Tenant requiere el rol <b>Reader (Lector)</b> o superior a nivel de <b>Tenant Root Group</b>.
                        </p>
                        <p className="text-sm text-red-600/80 dark:text-red-400/80">Si acabas de otorgar los permisos, por favor espera unos minutos para que Azure propague el cambio.</p>
                    </div>
                </div>
            );
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <p className="text-sm font-bold">Error: {error.message}</p>
            </div>
        );
    }

    const policies = data?.data || [];
    const managementGroups = data?.managementGroups || [];
    const subscriptions = data?.subscriptions || [];
    const activePolicies = data?.data || [];
    
    // Tab filtering logic
    const uniqueScopes = Array.from(new Set(activePolicies.map((p: any) => p.targetMg))) as string[];
    const filteredPolicies = activeTab === 'all' 
        ? activePolicies 
        : activePolicies.filter((p: any) => p.targetMg === activeTab);

    const totalPages = Math.max(1, Math.ceil(filteredPolicies.length / ITEMS_PER_PAGE));
    const paginatedPolicies = filteredPolicies.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    const searchFilteredPolicies = defData?.data?.filter((p: any) => p.displayName.toLowerCase().includes(policySearch.toLowerCase())) || [];

    return (
        <div className="space-y-8">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-5 rounded-xl border border-blue-100 dark:border-blue-900/50 flex gap-4 items-start">
                <ShieldAlert className="w-6 h-6 text-brand-deep dark:text-brand-bright shrink-0 mt-1" />
                <div>
                    <h3 className="font-bold text-blue-900 dark:text-blue-100 text-lg">Gobernanza Dinámica</h3>
                    <p className="text-blue-800 dark:text-blue-300 text-sm mt-1">
                        Asigna cualquier política nativa de Azure directamente desde aquí. Las políticas aplicadas se inyectarán en el Management Group seleccionado para prevenir configuraciones inseguras o costosas.
                    </p>
                </div>
            </div>

            {/* Asignar Nueva Política Form */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    <Plus className="w-5 h-5 text-brand-deep dark:text-brand-bright" />
                    Asignar Nueva Política
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                    <div className="flex flex-col">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Alcance (Scope)</label>
                        <select 
                            value={selectedNewMg}
                            onChange={(e) => setSelectedNewMg(e.target.value)}
                            className="text-sm p-2.5 border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 rounded-lg outline-none focus:border-brand-deep w-full"
                        >
                            <option value="">Seleccionar Management Group...</option>
                            {managementGroups.map((mg: any) => (
                                <option key={mg.id} value={mg.id}>{mg.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col relative">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Definición de Política</label>
                        {defError ? (
                            <div className="text-sm p-2 text-red-500 bg-red-50 rounded">Error: {defError.message}</div>
                        ) : (
                            <div className="relative">
                                <div className="flex items-center border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 rounded-lg focus-within:border-brand-deep overflow-hidden">
                                    <Search className="w-4 h-4 ml-3 text-gray-400 shrink-0" />
                                    <input 
                                        type="text" 
                                        value={policySearch}
                                        onChange={(e) => {
                                            setPolicySearch(e.target.value);
                                            setShowPolicyDropdown(true);
                                            if (e.target.value === '') {
                                                setSelectedNewPolicy('');
                                                setPolicyParams({});
                                            }
                                        }}
                                        onFocus={() => setShowPolicyDropdown(true)}
                                        onBlur={() => setTimeout(() => setShowPolicyDropdown(false), 200)}
                                        placeholder="Buscar política de Azure..."
                                        className="text-sm p-2.5 outline-none bg-transparent w-full dark:text-white"
                                    />
                                    {selectedNewPolicy && (
                                        <button 
                                            onClick={() => { 
                                                setSelectedNewPolicy(''); 
                                                setPolicySearch(''); 
                                                setAssignmentName('');
                                                setPolicyParams({}); 
                                            }} 
                                            className="pr-3 text-gray-400 hover:text-red-500 transition-colors"
                                        >
                                            <XCircle className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                                
                                {showPolicyDropdown && (
                                    <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                                        {searchFilteredPolicies.length === 0 ? (
                                            <div className="p-3 text-sm text-gray-500">No se encontraron políticas.</div>
                                        ) : (
                                            searchFilteredPolicies.map((p: any) => (
                                                <div 
                                                    key={p.id}
                                                    className={`p-3 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-700 border-b border-gray-100 dark:border-slate-700/50 last:border-0 transition-colors ${selectedNewPolicy === p.id ? 'bg-blue-50 dark:bg-slate-700 font-bold text-brand-deep dark:text-brand-bright' : 'text-gray-700 dark:text-gray-200'}`}
                                                    onMouseDown={(e) => {
                                                        e.preventDefault(); // Previene que el input pierda el foco antes del click
                                                        setSelectedNewPolicy(p.id);
                                                        setPolicySearch(p.displayName);
                                                        setAssignmentName(p.displayName.substring(0, 100)); // Por defecto el nombre original
                                                        
                                                        // Pre-popular parámetros con defaultValues si existen
                                                        const initialParams: Record<string, any> = {};
                                                        if (p.parameters) {
                                                            Object.entries(p.parameters).forEach(([k, v]: [string, any]) => {
                                                                if (v.defaultValue !== undefined) {
                                                                    initialParams[k] = v.defaultValue;
                                                                } else if (v.allowedValues && v.allowedValues.length > 0) {
                                                                    initialParams[k] = v.allowedValues[0];
                                                                }
                                                            });
                                                        }
                                                        setPolicyParams(initialParams);
                                                        setShowPolicyDropdown(false);
                                                    }}
                                                >
                                                    {p.displayName}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Parámetros Dinámicos y Opciones Avanzadas */}
                    {selectedNewPolicy && defData?.data?.find((p: any) => p.id === selectedNewPolicy) && (
                        <div className="md:col-span-2 space-y-6 mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
                            <div>
                                <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Nombre de la Asignación</h4>
                                <input 
                                    type="text" 
                                    value={assignmentName}
                                    onChange={(e) => setAssignmentName(e.target.value)}
                                    placeholder="Nombre personalizado para la asignación..."
                                    className="w-full text-sm p-2.5 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded outline-none focus:border-brand-deep"
                                />
                            </div>

                            {/* Parameters */}
                            {Object.keys(defData.data.find((p: any) => p.id === selectedNewPolicy).parameters || {}).length > 0 && (
                                <div>
                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Parámetros Requeridos</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {Object.entries(defData.data.find((p: any) => p.id === selectedNewPolicy).parameters).map(([key, schema]: [string, any]) => (
                                            <div key={key} className="flex flex-col">
                                                <label className="text-xs font-bold text-gray-500 mb-1">
                                                    {schema.metadata?.displayName || key}
                                                    {schema.defaultValue !== undefined && <span className="ml-1 font-normal text-[10px] text-gray-400">(Default: {JSON.stringify(schema.defaultValue)})</span>}
                                                </label>
                                                <p className="text-[10px] text-gray-400 mb-2 line-clamp-2" title={schema.metadata?.description}>{schema.metadata?.description}</p>
                                                
                                                {schema.allowedValues && schema.allowedValues.length > 0 ? (
                                                    <select
                                                        value={policyParams[key] || ''}
                                                        onChange={(e) => setPolicyParams(prev => ({ ...prev, [key]: e.target.value }))}
                                                        className="text-sm p-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded outline-none focus:border-brand-deep"
                                                    >
                                                        {schema.allowedValues.map((av: any) => (
                                                            <option key={av} value={av}>{av}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <input 
                                                        type="text" 
                                                        placeholder={schema.type === 'Array' ? 'valor1, valor2' : `Valor (${schema.type})`}
                                                        value={policyParams[key] || ''}
                                                        onChange={(e) => {
                                                            const val = schema.type === 'Array' ? e.target.value.split(',').map(s => s.trim()) : e.target.value;
                                                            setPolicyParams(prev => ({ ...prev, [key]: val }));
                                                        }}
                                                        className="text-sm p-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded outline-none focus:border-brand-deep"
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Opciones Avanzadas */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-200 dark:border-slate-800">
                                <div>
                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Mensaje de No Cumplimiento</h4>
                                    <p className="text-xs text-gray-500 mb-2">Mensaje que verán los usuarios si el recurso es denegado.</p>
                                    <textarea 
                                        value={nonComplianceMessage}
                                        onChange={(e) => setNonComplianceMessage(e.target.value)}
                                        placeholder="Ej: Solo se permiten Storage Accounts con LRS en este entorno."
                                        className="w-full text-sm p-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded outline-none focus:border-brand-deep h-20 resize-none"
                                    />
                                </div>
                                
                                <div>
                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Identidad Administrada (Remediación)</h4>
                                    <p className="text-xs text-gray-500 mb-3">Requerido para políticas que modifican o despliegan recursos.</p>
                                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-4 cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            checked={createIdentity}
                                            onChange={(e) => setCreateIdentity(e.target.checked)}
                                            className="w-4 h-4 text-brand-deep rounded border-gray-300 focus:ring-brand-deep"
                                        />
                                        Crear Managed Identity (System Assigned)
                                    </label>
                                    
                                    {createIdentity && (
                                        <div className="flex flex-col">
                                            <label className="text-xs font-bold text-gray-500 mb-1">Región (Location)</label>
                                            <select 
                                                value={identityLocation}
                                                onChange={(e) => setIdentityLocation(e.target.value)}
                                                className="text-sm p-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded outline-none focus:border-brand-deep"
                                            >
                                                <option value="eastus">East US</option>
                                                <option value="westus">West US</option>
                                                <option value="northeurope">North Europe</option>
                                                <option value="westeurope">West Europe</option>
                                                <option value="brazilsouth">Brazil South</option>
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="md:col-span-2 mt-4">
                        <button 
                            onClick={handleAssignNew}
                            disabled={toggling === 'new' || !selectedNewMg || !selectedNewPolicy}
                            className="w-full flex items-center justify-center gap-2 bg-brand-deep hover:bg-brand-bright text-white font-bold py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {toggling === 'new' ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Desplegar Política'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Políticas Aplicadas - Paginación */}
            <div>
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Políticas Activas en el Entorno</h3>
                    
                    {uniqueScopes.length > 0 && (
                        <div className="flex bg-gray-100 dark:bg-slate-800 p-1 rounded-lg overflow-x-auto no-scrollbar">
                            <button
                                onClick={() => { setActiveTab('all'); setPage(1); }}
                                className={`px-4 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${activeTab === 'all' ? 'bg-white dark:bg-slate-700 text-brand-deep shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                            >
                                Todos
                            </button>
                            {uniqueScopes.map(scope => {
                                // Match against Management Groups OR Subscriptions
                                const mgName = managementGroups.find((m: any) => m.id === scope)?.name 
                                    || subscriptions.find((s: any) => s.id === scope)?.name 
                                    || scope;
                                return (
                                    <button
                                        key={scope}
                                        onClick={() => { setActiveTab(scope); setPage(1); }}
                                        className={`px-4 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${activeTab === scope ? 'bg-white dark:bg-slate-700 text-brand-deep shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                                    >
                                        {mgName}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {filteredPolicies.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-gray-300 dark:border-slate-700">
                        <p className="text-gray-500 dark:text-gray-400">No hay políticas asignadas en este entorno.</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 gap-4">
                            {paginatedPolicies.map((policy: any) => {
                                const isProcessing = toggling === policy.id;
                                return (
                                    <div key={policy.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-sm transition-all hover:border-brand-deep/30">
                                        <div className="flex-1 pr-6 mb-4 sm:mb-0">
                                            <h4 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 text-md">
                                                {policy.name}
                                                <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 rounded-full flex items-center gap-1 uppercase tracking-wider">
                                                    Scope: {managementGroups.find((m: any) => m.id === policy.targetMg)?.name 
                                                        || subscriptions.find((s: any) => s.id === policy.targetMg)?.name 
                                                        || policy.targetMg}
                                                </span>
                                            </h4>
                                            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1.5 line-clamp-2">
                                                {policy.description}
                                            </p>
                                        </div>
                                        
                                        <div className="shrink-0 flex items-center gap-4 sm:border-l sm:border-gray-200 dark:border-slate-700 sm:pl-6 sm:ml-6">
                                            <button 
                                                onClick={() => handleDeleteAssignment(policy.id, policy.targetMg)}
                                                disabled={isProcessing}
                                                title="Remover asignación"
                                                className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                                            >
                                                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between mt-6 bg-white dark:bg-slate-900 px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-800">
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                    Página <span className="font-bold text-gray-900 dark:text-white">{page}</span> de {totalPages}
                                </span>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                        className="p-1.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                                    >
                                        <ChevronLeft className="w-5 h-5" />
                                    </button>
                                    <button 
                                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                        disabled={page === totalPages}
                                        className="p-1.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                                    >
                                        <ChevronRight className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
