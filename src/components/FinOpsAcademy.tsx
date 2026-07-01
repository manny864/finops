"use client";
import React, { useState } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { useRouter, useParams } from 'next/navigation';
import { Loader2, BookOpen, CheckCircle, GraduationCap, PlayCircle, Trophy, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import { generateOnboardingScript } from '@/lib/onboardingScriptTemplate';

export default function FinOpsAcademy() {
    const { selectedTenant, setSelectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const router = useRouter();
    const { locale } = useParams() as { locale: string };
    const [markingComplete, setMarkingComplete] = useState<string | null>(null);

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

        if (!res.ok) throw new Error("Error al cargar la Academia");
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && accounts.length > 0) 
            ? `/api/academy/content?tenantId=${selectedTenant.id}` 
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const handleMarkComplete = async (moduleId: string) => {
        setMarkingComplete(moduleId);
        try {
            const account = accounts[0];
            const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });

            const response = await fetch(`/api/academy/content`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenResponse.idToken}`
                },
                body: JSON.stringify({ tenantId: selectedTenant?.id, moduleId })
            });

            if (!response.ok) throw new Error("Fallo al guardar progreso");
            
            toast.success("¡Lección completada!");
            mutate(); // Refresh progress
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setMarkingComplete(null);
        }
    };

    // A very simple markdown parser for our controlled academy content
    const parseMarkdown = (md: string) => {
        let html = md;
        html = html.replace(/### (.*)/g, '<h3 class="text-xl font-bold text-gray-900 dark:text-white mt-4 mb-2">$1</h3>');
        html = html.replace(/#### (.*)/g, '<h4 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-1">$1</h4>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/- (.*)/g, '<li class="ml-4 list-disc text-gray-600 dark:text-gray-300">$1</li>');
        html = html.replace(/\n/g, '<br/>');
        return { __html: html };
    };

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500">Cargando módulos de la Academia FinOps...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-100">
                <p className="font-bold">Error: {error.message}</p>
            </div>
        );
    }

    const { modules, totalCompleted, isCertified } = data;
    const progressPercentage = (totalCompleted / modules.length) * 100;

    return (
        <div className="max-w-4xl space-y-6">
            {/* Progress Header */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <GraduationCap className="w-6 h-6 text-brand-deep dark:text-brand-bright" />
                            Tu Ruta de Aprendizaje FinOps
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Comprende la nube antes de optimizarla. Completado {totalCompleted} de {modules.length} módulos.
                        </p>
                    </div>
                    {isCertified && (
                        <div className="flex flex-col items-center animate-in zoom-in">
                            <Trophy className="w-10 h-10 text-yellow-500 mb-1 drop-shadow-md" />
                            <span className="text-xs font-bold text-yellow-600 uppercase tracking-widest">FinOps Certified</span>
                            <button 
                                onClick={() => {
                                    // Mark is_onboarded in React state + localStorage BEFORE navigating
                                    // to avoid TenantProvider's academy-redirect loop on remount.
                                    setSelectedTenant({ ...selectedTenant, is_onboarded: true });
                                    router.push(`/${locale}`);
                                }}
                                className="mt-2 px-3 py-1.5 bg-brand-deep text-white text-xs font-bold rounded hover:bg-brand-bright shadow-sm transition-colors"
                            >
                                Ingresar al SaaS
                            </button>
                        </div>
                    )}
                </div>
                
                <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2.5 mb-1 overflow-hidden">
                    <div 
                        className="bg-brand-deep dark:bg-brand-bright h-2.5 rounded-full transition-all duration-1000 ease-out" 
                        style={{ width: `${progressPercentage}%` }}
                    ></div>
                </div>
            </div>

            {/* Modules List */}
            <div className="space-y-6">
                {modules.map((mod: any, index: number) => {
                    const isFirstModuleCompleted = mod.id === 'module-1' && mod.isCompleted;

                    return (
                        <div key={mod.id} className={`bg-white dark:bg-slate-900 rounded-xl border ${mod.isCompleted ? 'border-green-200 dark:border-green-900/50' : 'border-gray-200 dark:border-slate-800'} overflow-hidden shadow-sm transition-all`}>
                            <div className={`p-6 ${mod.isCompleted ? 'bg-green-50/30 dark:bg-green-900/10' : ''}`}>
                                <div className="flex items-start justify-between">
                                    <div className="flex gap-4">
                                        <div className={`p-3 rounded-xl ${mod.isCompleted ? 'bg-green-100 dark:bg-green-900/50 text-green-600' : 'bg-blue-50 dark:bg-blue-900/30 text-brand-deep'}`}>
                                            {mod.isCompleted ? <CheckCircle className="w-6 h-6" /> : <BookOpen className="w-6 h-6" />}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Módulo {index + 1}</span>
                                                <span className="text-xs font-semibold px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 rounded-full flex items-center gap-1">
                                                    <PlayCircle className="w-3 h-3" /> {mod.duration}
                                                </span>
                                            </div>
                                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">{mod.title}</h3>
                                            <p className="text-gray-500 dark:text-gray-400 mt-1">{mod.description}</p>
                                        </div>
                                    </div>
                                    {!mod.isCompleted && (
                                        <button 
                                            onClick={() => handleMarkComplete(mod.id)}
                                            disabled={markingComplete === mod.id}
                                            className="px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-bold rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-50"
                                        >
                                            {markingComplete === mod.id ? 'Guardando...' : 'Marcar Completado'}
                                        </button>
                                    )}
                                </div>

                                <div className="mt-6 pt-6 border-t border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">
                                    <div dangerouslySetInnerHTML={parseMarkdown(mod.content)} />
                                </div>

                                {/* Intelligent Onboarding Suggestion */}
                                {mod.suggestOnboardingScript && isFirstModuleCompleted && (
                                    <div className="mt-6 bg-brand-deep/5 dark:bg-brand-deep/10 border border-brand-deep/20 rounded-lg p-5 animate-in fade-in">
                                        <div className="flex items-center gap-3 mb-2">
                                            <Terminal className="w-5 h-5 text-brand-deep dark:text-brand-bright" />
                                            <h4 className="font-bold text-gray-900 dark:text-white">¡Estás listo para conectar Azure!</h4>
                                        </div>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                                            Ya que entiendes la importancia de la visibilidad, ejecuta tu script de Onboarding seguro (Read-Only) en Azure Cloud Shell para empezar a jalar datos reales.
                                        </p>
                                        <pre className="bg-gray-900 p-4 rounded-lg overflow-x-auto text-xs font-mono text-green-400 shadow-inner">
                                            {(() => {
                                                const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
                                                const safeTenantId = isValidUUID(selectedTenant.id) ? selectedTenant.id : '00000000-0000-4000-8000-000000000000';
                                                const placeholderSub = '00000000-0000-4000-8000-000000000000';
                                                return generateOnboardingScript(safeTenantId, placeholderSub);
                                            })()}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
