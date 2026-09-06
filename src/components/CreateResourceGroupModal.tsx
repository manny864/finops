"use client";
import { useTranslations } from "next-intl";

import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useMsal } from '@azure/msal-react';
import { fetchWithAuthRetry } from '@/lib/msalToken';
import { errorMessage } from '@/lib/apiErrors';
import { isMockTenant } from '@/lib/mockData';
import {
    IconFolderPlus,
    IconX,
    IconLoader2,
    IconPlus,
    IconTrash,
    IconBuilding,
    IconTag,
} from '@tabler/icons-react';

interface CreateResourceGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    tenantId: string;
    subscriptionId: string;
    onSuccess?: () => void;
}

export default function CreateResourceGroupModal({
    isOpen,
    onClose,
    tenantId,
    subscriptionId,
    onSuccess,
}: CreateResourceGroupModalProps) {
    const t = useTranslations("CreateResourceGroup");
    const { instance, accounts } = useMsal();
    const isMock = isMockTenant(tenantId);

    const [rgName, setRgName] = useState('');
    const [location, setLocation] = useState('eastus2');
    const [regions, setRegions] = useState<{ name: string; displayName: string }[]>([]);
    const [loadingRegions, setLoadingRegions] = useState(false);

    const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
    const [loading, setLoading] = useState(false);

    const [existingRgs, setExistingRgs] = useState<any[]>([]);
    const [loadingRgs, setLoadingRgs] = useState(false);

    useEffect(() => {
        if (!isOpen || !tenantId || !subscriptionId) return;

        if (isMock) {
            setRegions([
                { name: 'eastus2', displayName: 'East US 2 (Virginia)' },
                { name: 'eastus', displayName: 'East US (Virginia)' },
                { name: 'brazilsouth', displayName: 'Brazil South (Sao Paulo)' },
                { name: 'westeurope', displayName: 'West Europe (Netherlands)' },
            ]);
            setExistingRgs([
                { name: 'rg-finops-workbooks-prod', location: 'eastus2' },
                { name: 'rg-cscs-monitoring', location: 'eastus2' },
            ]);
            return;
        }

        if (accounts.length === 0) return;

        const fetchRgs = async () => {
            setLoadingRgs(true);
            try {
                const res = await fetchWithAuthRetry(
                    instance,
                    accounts[0],
                    `/api/resourcegroups?tenantId=${tenantId}&subscriptionId=${subscriptionId}`
                );
                const json = await res.json();
                if (json.resourceGroups) setExistingRgs(json.resourceGroups);
            } catch (e) {
                console.error('[CreateResourceGroupModal] Error fetching existing RGs:', e);
            } finally {
                setLoadingRgs(false);
            }
        };

        const fetchRegions = async () => {
            setLoadingRegions(true);
            try {
                const res = await fetchWithAuthRetry(
                    instance,
                    accounts[0],
                    `/api/locations?tenantId=${tenantId}&subscriptionId=${subscriptionId}`
                );
                const json = await res.json();
                if (res.ok && json.locations && json.locations.length > 0) {
                    setRegions(json.locations);
                    if (!json.locations.find((l: any) => l.name === location)) {
                        setLocation(json.locations[0].name);
                    }
                } else if (!res.ok) {
                    toast.error(t("regionsLoadError"), { description: json.error });
                }
            } catch (e) {
                console.error('[CreateResourceGroupModal] Error fetching locations:', e);
                toast.error(t("regionsLoadError"));
            } finally {
                setLoadingRegions(false);
            }
        };

        fetchRgs();
        fetchRegions();
    }, [isOpen, tenantId, subscriptionId, accounts, instance, isMock, location]);

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
            toast.error(t("nameRequired"));
            return;
        }

        const tagsObject: Record<string, string> = {};
        tags.forEach((t) => {
            if (t.key.trim() && t.value.trim()) {
                tagsObject[t.key.trim()] = t.value.trim();
            }
        });

        if (isMock) {
            setLoading(true);
            setTimeout(() => {
                setLoading(false);
                toast.success(`Resource Group ${rgName} creado exitosamente en ${location}`);
                if (onSuccess) onSuccess();
                onClose();
            }, 800);
            return;
        }

        setLoading(true);
        try {
            if (accounts.length === 0) throw new Error(t("noSession"));
            const res = await fetchWithAuthRetry(instance, accounts[0], '/api/resourcegroups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenantId,
                    subscriptionId,
                    rgName: rgName.trim(),
                    location,
                    tags: tagsObject,
                }),
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Fallo al crear Resource Group');

            toast.success(`Resource Group ${rgName} creado exitosamente en ${location}`);
            if (onSuccess) onSuccess();
            onClose();
        } catch (e) {
            toast.error(t("createError"), { description: errorMessage(e) });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
                {/* Cabecera del Modal */}
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <IconFolderPlus size={20} className="text-[#0078D4]" />
                        <h3
                            className="text-base font-bold text-[#1B2A41] dark:text-white"
                            style={{ fontFamily: 'Montserrat, "Montserrat Fallback", sans-serif' }}
                        >
                            {t("title")}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                        <IconX size={18} />
                    </button>
                </div>

                {/* Cuerpo del Modal */}
                <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
                    {/* Lista de RGs Existentes */}
                    <div>
                        <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                            <IconBuilding size={14} className="text-slate-400" />
                            {t("existing")}
                        </h4>
                        <div className="max-h-28 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50 dark:bg-slate-800/50">
                            {loadingRgs ? (
                                <div className="flex items-center justify-center py-3 text-slate-400 gap-2">
                                    <IconLoader2 size={14} className="animate-spin text-[#0078D4]" />
                                    <span>{t("loadingGroups")}</span>
                                </div>
                            ) : existingRgs.length === 0 ? (
                                <p className="text-slate-400 text-center py-2">
                                    {t("noGroups")}
                                </p>
                            ) : (
                                <ul className="space-y-1">
                                    {existingRgs.map((rg, idx) => (
                                        <li
                                            key={idx}
                                            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-lg shadow-2xs flex justify-between items-center text-slate-700 dark:text-slate-200"
                                        >
                                            <span className="font-mono font-medium">{rg.name}</span>
                                            <span className="text-slate-400 text-[10px] uppercase font-mono">
                                                {rg.location}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3.5">
                        <h4 className="font-bold text-[#0078D4] dark:text-blue-400 flex items-center gap-1.5 text-xs">
                            <IconPlus size={14} />
                            Crear Nuevo Resource Group
                        </h4>

                        {/* Input Nombre RG */}
                        <div>
                            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {t("nameLabel")}
                            </label>
                            <input
                                type="text"
                                value={rgName}
                                onChange={(e) => setRgName(e.target.value)}
                                className="w-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-[#0078D4] focus:outline-none shadow-sm"
                                placeholder="Ej. rg-finops-workbooks-001"
                            />
                        </div>

                        {/* Selector Región / Ubicación */}
                        <div>
                            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {t("regionLabel")}
                            </label>
                            <select
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                disabled={loadingRegions}
                                className="w-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-[#0078D4] focus:outline-none shadow-sm disabled:opacity-60"
                            >
                                {loadingRegions ? (
                                    <option>{t("loadingRegions")}</option>
                                ) : (
                                    regions.map((r) => (
                                        <option key={r.name} value={r.name}>
                                            {r.displayName} ({r.name})
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>

                        {/* Tags */}
                        <div>
                            <div className="flex justify-between items-center mb-1.5">
                                <label className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                    <IconTag size={13} className="text-slate-400" />
                                    {t("tagsLabel")}
                                </label>
                                <button
                                    type="button"
                                    onClick={addTag}
                                    className="text-xs text-[#0078D4] hover:text-[#0060AA] font-semibold flex items-center gap-0.5"
                                >
                                    <IconPlus size={13} />
                                    <span>{t("addTag")}</span>
                                </button>
                            </div>

                            <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                {tags.length === 0 && (
                                    <p className="text-[11px] text-slate-400 italic bg-slate-50 dark:bg-slate-800/40 p-2 rounded-lg text-center">
                                        {t("noTags")}
                                    </p>
                                )}
                                {/* El item se llamaba `t` y tapaba la `t` de useTranslations dentro del map. */}
                                {tags.map((tag, i) => (
                                    <div key={i} className="flex gap-2 items-center">
                                        <input
                                            type="text"
                                            placeholder={t("keyPlaceholder")}
                                            value={tag.key}
                                            onChange={(e) => updateTag(i, 'key', e.target.value)}
                                            className="flex-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-[#0078D4] focus:outline-none"
                                        />
                                        <input
                                            type="text"
                                            placeholder={t("valuePlaceholder")}
                                            value={tag.value}
                                            onChange={(e) => updateTag(i, 'value', e.target.value)}
                                            className="flex-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-[#0078D4] focus:outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeTag(i)}
                                            className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                            title="Eliminar etiqueta"
                                        >
                                            <IconTrash size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer del Modal */}
                <div className="px-6 py-4 bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex justify-end items-center gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors"
                        disabled={loading}
                    >
                        {t("cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={loading || !rgName.trim()}
                        className="px-4 py-2 text-xs font-semibold bg-[#0078D4] text-white hover:bg-[#0060AA] rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                        {loading ? (
                            <>
                                <IconLoader2 size={14} className="animate-spin" />
                                <span>{t("creating")}</span>
                            </>
                        ) : (
                            <>
                                <IconFolderPlus size={14} />
                                <span>{t("create")}</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
