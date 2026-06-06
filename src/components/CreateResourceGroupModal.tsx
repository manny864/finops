"use client";
import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';

interface CreateResourceGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    tenantId: string;
    subscriptionId: string;
    onSuccess?: () => void;
}

export default function CreateResourceGroupModal({ isOpen, onClose, tenantId, subscriptionId, onSuccess }: CreateResourceGroupModalProps) {
    const [rgName, setRgName] = useState('');
    const [location, setLocation] = useState('eastus');
    const [regions, setRegions] = useState<{name: string, displayName: string}[]>([]);
    const [loadingRegions, setLoadingRegions] = useState(false);
    
    const [tags, setTags] = useState<{key: string, value: string}[]>([]);
    const [loading, setLoading] = useState(false);
    
    const [existingRgs, setExistingRgs] = useState<any[]>([]);
    const [loadingRgs, setLoadingRgs] = useState(false);

    useEffect(() => {
        if (isOpen && tenantId && subscriptionId) {
            const fetchRgs = async () => {
                setLoadingRgs(true);
                try {
                    const res = await fetch(`/api/resourcegroups?tenantId=${tenantId}&subscriptionId=${subscriptionId}`);
                    const json = await res.json();
                    if (json.resourceGroups) setExistingRgs(json.resourceGroups);
                } catch (e) {
                    console.error("Error fetching existing RGs:", e);
                }
                setLoadingRgs(false);
            };

            const fetchRegions = async () => {
                setLoadingRegions(true);
                try {
                    const res = await fetch(`/api/locations?tenantId=${tenantId}&subscriptionId=${subscriptionId}`);
                    const json = await res.json();
                    if (json.locations && json.locations.length > 0) {
                        setRegions(json.locations);
                        // set default location if not in list
                        if (!json.locations.find((l: any) => l.name === location)) {
                            setLocation(json.locations[0].name);
                        }
                    }
                } catch (e) {
                    console.error("Error fetching locations:", e);
                }
                setLoadingRegions(false);
            };

            fetchRgs();
            fetchRegions();
        }
    }, [isOpen, tenantId, subscriptionId]);

    if (!isOpen) return null;

    const addTag = () => setTags([...tags, { key: '', value: '' }]);
    const removeTag = (index: number) => setTags(tags.filter((_, i) => i !== index));
    const updateTag = (index: number, field: 'key' | 'value', val: string) => {
        const newTags = [...tags];
        newTags[index][field] = val;
        setTags(newTags);
    };

    const handleSave = async () => {
        if (!rgName.trim()) {
            toast.error('El nombre del Resource Group es obligatorio');
            return;
        }

        const tagsObject: Record<string, string> = {};
        tags.forEach(t => {
            if (t.key.trim() && t.value.trim()) {
                tagsObject[t.key.trim()] = t.value.trim();
            }
        });

        setLoading(true);
        try {
            const res = await fetch('/api/resourcegroups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenantId,
                    subscriptionId,
                    rgName: rgName.trim(),
                    location,
                    tags: tagsObject
                })
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Fallo al crear Resource Group');

            toast.success(`Resource Group ${rgName} creado exitosamente en ${location}`);
            if (onSuccess) onSuccess();
            onClose();
        } catch (e: any) {
            toast.error('Error al crear Resource Group', { description: e.message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-800">Gestionar Grupos de Recursos</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
                
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Grupos de Recursos Existentes</h4>
                        <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md p-2 bg-gray-50">
                            {loadingRgs ? (
                                <p className="text-xs text-gray-500 text-center py-2 animate-pulse">Cargando...</p>
                            ) : existingRgs.length === 0 ? (
                                <p className="text-xs text-gray-500 text-center py-2">No se encontraron RGs en esta suscripción.</p>
                            ) : (
                                <ul className="space-y-1">
                                    {existingRgs.map((rg, idx) => (
                                        <li key={idx} className="text-xs text-gray-700 px-3 py-2 bg-white border border-gray-100 rounded shadow-sm flex justify-between items-center">
                                            <span className="font-medium">{rg.name}</span>
                                            <span className="text-gray-400 text-[10px] uppercase">{rg.location}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                    
                    <hr className="border-gray-100"/>

                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-[#0054A6]">Crear Nuevo Resource Group</h4>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Nombre del Resource Group</label>
                            <input 
                                type="text" 
                                value={rgName} 
                                onChange={e => setRgName(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-[#0054A6] focus:border-[#0054A6]"
                                placeholder="Ej. rg-finops-prod-001"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Región (Location)</label>
                            <select 
                                value={location}
                                onChange={e => setLocation(e.target.value)}
                                disabled={loadingRegions}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-[#0054A6] focus:border-[#0054A6] bg-white disabled:bg-gray-100"
                            >
                                {loadingRegions ? (
                                    <option>Cargando regiones...</option>
                                ) : (
                                    regions.map(r => (
                                        <option key={r.name} value={r.name}>{r.displayName} ({r.name})</option>
                                    ))
                                )}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1 flex justify-between items-center">
                                Etiquetas (Tags)
                                <button onClick={addTag} className="text-xs text-[#0054A6] hover:underline font-bold">+ Añadir Tag</button>
                            </label>
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                                {tags.length === 0 && <p className="text-xs text-gray-400 italic bg-gray-50 p-2 rounded">No hay etiquetas definidas.</p>}
                                {tags.map((t, i) => (
                                    <div key={i} className="flex gap-2 items-center">
                                        <input 
                                            type="text" 
                                            placeholder="Key" 
                                            value={t.key} 
                                            onChange={e => updateTag(i, 'key', e.target.value)}
                                            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:ring-[#0054A6] focus:border-[#0054A6]"
                                        />
                                        <input 
                                            type="text" 
                                            placeholder="Value" 
                                            value={t.value} 
                                            onChange={e => updateTag(i, 'value', e.target.value)}
                                            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:ring-[#0054A6] focus:border-[#0054A6]"
                                        />
                                        <button onClick={() => removeTag(i)} className="text-red-500 hover:text-red-700 font-bold px-2">✕</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end space-x-3">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        disabled={loading}
                    >
                        Cerrar
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={loading || !rgName.trim()}
                        className="px-4 py-2 text-sm font-semibold bg-[#0054A6] text-white hover:bg-blue-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                    >
                        {loading ? 'Procesando...' : 'Crear y Guardar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
