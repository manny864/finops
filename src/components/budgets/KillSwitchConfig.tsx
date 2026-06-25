"use client";
import React, { useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { hasAccess } from '@/lib/tierLogic';
import { ShieldAlert, AlertTriangle, PowerOff } from 'lucide-react';
import { toast } from 'sonner';

export default function KillSwitchConfig({ subscriptionId, resourceGroups = [] }: { subscriptionId: string, resourceGroups?: string[] }) {
    const { selectedTenant } = useTenant();
    const isPro = hasAccess(selectedTenant.tier || 'Essential', 'Professional');
    const [enabled, setEnabled] = useState(false);
    const [selectedRg, setSelectedRg] = useState('');
    const [loading, setLoading] = useState(false);

    if (!isPro) {
        return (
            <div className="mt-6 border-t border-gray-200 dark:border-slate-700 pt-6 opacity-50">
                <div className="flex items-center gap-2 mb-2">
                    <ShieldAlert className="w-5 h-5 text-gray-500" />
                    <h4 className="font-bold text-gray-800 dark:text-gray-200">Kill Switch (Auto-Suspensión)</h4>
                    <span className="bg-amber-100 text-amber-800 text-[10px] uppercase font-bold px-2 py-0.5 rounded">Requiere Pro</span>
                </div>
                <p className="text-xs text-gray-500">Actualiza a Pro o Enterprise para habilitar el apagado automático de recursos no productivos al exceder el presupuesto.</p>
            </div>
        );
    }

    const handleSave = async () => {
        if (!enabled) {
            toast.success("Kill Switch deshabilitado");
            return;
        }
        if (!selectedRg) {
            toast.error("Debes seleccionar un Resource Group objetivo");
            return;
        }

        setLoading(true);
        // Simulated save for UI interaction
        setTimeout(() => {
            setLoading(false);
            toast.success(`Kill Switch habilitado para ${selectedRg}`);
        }, 800);
    };

    return (
        <div className="mt-6 border-t border-gray-200 dark:border-slate-700 pt-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-rose-500" />
                    <h4 className="font-bold text-gray-800 dark:text-gray-200">Kill Switch (Auto-Suspensión)</h4>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={enabled} onChange={() => setEnabled(!enabled)} />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-rose-500"></div>
                </label>
            </div>
            
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Configura una acción destructiva segura. Si el presupuesto se excede al 100%, todos los recursos en el Resource Group seleccionado serán apagados (Deallocate) automáticamente para frenar el gasto.
            </p>

            {enabled && (
                <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-md p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex gap-2 text-rose-700 dark:text-rose-400">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <p className="text-xs font-semibold">
                            ADVERTENCIA: Esta acción es destructiva y causará tiempo de inactividad. Solo utilícelo para entornos Dev/Test.
                        </p>
                    </div>

                    <div className="flex flex-col gap-1.5 mt-2">
                        <label className="text-[11px] font-bold text-rose-800 dark:text-rose-300 uppercase">Resource Group Objetivo</label>
                        <select 
                            value={selectedRg}
                            onChange={(e) => setSelectedRg(e.target.value)}
                            className="p-2 border border-rose-200 dark:border-rose-700 bg-white dark:bg-slate-800 rounded-md text-sm outline-none focus:border-rose-500"
                        >
                            <option value="">Seleccione un RG...</option>
                            <option value="dev-frontend-rg">dev-frontend-rg</option>
                            <option value="test-backend-rg">test-backend-rg</option>
                            <option value="sandbox-data-rg">sandbox-data-rg</option>
                            {resourceGroups.map(rg => <option key={rg} value={rg}>{rg}</option>)}
                        </select>
                    </div>

                    <button 
                        onClick={handleSave}
                        disabled={loading}
                        className="mt-2 w-full py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-xs font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        <PowerOff className="w-3.5 h-3.5" />
                        {loading ? 'Guardando...' : 'Aplicar Kill Switch'}
                    </button>
                </div>
            )}
        </div>
    );
}
