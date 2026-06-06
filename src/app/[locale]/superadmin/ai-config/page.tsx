"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useRouter } from 'next/navigation';
import { isSuperAdmin } from '@/lib/authGuard';
import { toast } from 'sonner';
import { Cpu, Key, Save, Loader2, Server } from 'lucide-react';

export default function AIConfigPage() {
    const { accounts } = useMsal();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    const [provider, setProvider] = useState('openai');
    const [apiKey, setApiKey] = useState('');

    useEffect(() => {
        if (accounts.length > 0) {
            const email = accounts[0].username;
            if (!isSuperAdmin(email)) {
                toast.error("No tienes permisos para ver esta página.");
                router.replace('/');
                return;
            }
            fetchConfig();
        }
    }, [accounts, router]);

    const fetchConfig = async () => {
        try {
            const res = await fetch('/api/admin/ai-config');
            if (res.ok) {
                const json = await res.json();
                if (json.provider) setProvider(json.provider);
                if (json.apiKey) setApiKey(json.apiKey);
            }
        } catch (e) {
            console.error("Error fetching AI config", e);
        }
        setLoading(false);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await fetch('/api/admin/ai-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, apiKey })
            });
            if (res.ok) {
                toast.success('Configuración de IA guardada correctamente.');
            } else {
                toast.error('Error al guardar configuración.');
            }
        } catch (e) {
            console.error(e);
            toast.error('Error de red al guardar.');
        }
        setSaving(false);
    };

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>;

    return (
        <div className="max-w-4xl mx-auto p-6 animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-slate-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center">
                    <Cpu className="w-8 h-8 mr-3 text-indigo-500" />
                    Configuración Agnóstica de IA
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    Super Admin Panel: Configura el proveedor de inteligencia artificial global para los Reportes Ejecutivos.
                </p>
            </div>

            <form onSubmit={handleSave} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 space-y-6">
                <div>
                    <label className="flex items-center text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        <Server className="w-4 h-4 mr-2 text-indigo-500" /> Proveedor de Inteligencia Artificial
                    </label>
                    <select
                        value={provider}
                        onChange={(e) => setProvider(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        <option value="openai">OpenAI (ChatGPT)</option>
                        <option value="google">Google (Gemini)</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                    </select>
                </div>

                <div>
                    <label className="flex items-center text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        <Key className="w-4 h-4 mr-2 text-indigo-500" /> API Key
                    </label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-..."
                        required
                        className="w-full px-4 py-2 border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <p className="text-xs text-gray-400 mt-2">Esta llave se almacenará de manera segura en la plataforma.</p>
                </div>

                <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
                    <button
                        type="submit"
                        disabled={saving}
                        className="flex items-center px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
                        Guardar Configuración Global
                    </button>
                </div>
            </form>
        </div>
    );
}
