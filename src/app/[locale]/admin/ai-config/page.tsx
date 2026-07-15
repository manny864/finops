"use client";
import React, { useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Cpu, Save, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { getFreshIdToken } from '@/lib/msalToken';

export default function AiConfigPage() {
    const { selectedTenant, userRole, systemRole } = useTenant();
    const { instance, accounts } = useMsal();
    
    const [provider, setProvider] = useState('system');
    const [apiKey, setApiKey] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            toast.error("Selecciona un tenant válido primero.");
            return;
        }

        setSaving(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
            const res = await fetch('/api/admin/config/ai', {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    tenantId: selectedTenant.id, 
                    aiProvider: provider,
                    aiApiKey: provider === 'system' ? null : apiKey
                })
            });

            if (res.ok) {
                toast.success("Configuración de IA actualizada exitosamente.");
            } else {
                const data = await res.json();
                toast.error(data.error || "Error al guardar la configuración.");
            }
        } catch (e) {
            console.error("Error saving AI config:", e);
            toast.error("Error al conectar con el servidor.");
        }
        setSaving(false);
    };

    if (userRole !== 'Admin' && systemRole !== 'SUPERADMIN') {
        return (
            <div className="flex flex-col items-center justify-center h-96">
                <Lock className="w-12 h-12 text-gray-400 mb-4" />
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Acceso Denegado</h2>
                <p className="text-sm text-gray-500 mt-2">Solo los administradores pueden configurar la IA.</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <Cpu className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
                    Configuración de Inteligencia Artificial (BYOK)
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    Trae tu propia llave (Bring Your Own Key) para maximizar la privacidad y eliminar los límites de cuota de uso.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Proveedor de IA</h3>
                </div>
                <div className="p-6">
                    <div className="flex flex-col mb-6">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Selecciona el motor de LLM</label>
                        <select 
                            value={provider}
                            onChange={(e) => setProvider(e.target.value)}
                            className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                        >
                            <option value="system">Sistema (Compartido - Con límites de cuota)</option>
                            <option value="openai">OpenAI (Trae tu propia API Key)</option>
                            <option value="azure_openai">Azure OpenAI (Privado y Seguro)</option>
                            <option value="anthropic">Anthropic (Claude Opus 4.8)</option>
                            <option value="google">Google (Gemini Flash · última versión gratis)</option>
                            <option value="deepseek">DeepSeek (DeepSeek Chat)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-2">
                            Recomendamos usar tu propia llave para garantizar que tus datos no sean utilizados para entrenamiento de modelos públicos y para obtener respuestas más rápidas sin throttling.
                        </p>
                    </div>

                    {provider !== 'system' && (
                        <div className="flex flex-col mb-6">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">API Key</label>
                            <input 
                                type="password" 
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="sk-..."
                                className="w-full max-w-md px-4 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                            />
                        </div>
                    )}

                    <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
                        <button
                            onClick={handleSave}
                            disabled={saving || (provider !== 'system' && !apiKey)}
                            className="flex items-center px-4 py-2 bg-[#0054A6] text-white rounded-md shadow-sm text-sm font-semibold hover:bg-[#004080] disabled:opacity-50 transition-colors"
                        >
                            <Save className="w-4 h-4 mr-2" />
                            {saving ? 'Guardando...' : 'Guardar Configuración'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
