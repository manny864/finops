"use client";
import React, { useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { useRouter, useParams } from 'next/navigation';
import { Loader2, BookOpen, CheckCircle, GraduationCap, PlayCircle, Trophy, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateOnboardingScript } from '@/lib/onboardingScriptTemplate';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { errorMessage } from '@/lib/apiErrors';

export default function FinOpsAcademy() {
    const t = useTranslations('Academy');
    const { selectedTenant, setAcademyCertified, systemRole } = useTenant();
    const { instance, accounts } = useMsal();
    const router = useRouter();
    const { locale } = useParams() as { locale: string };
    const [markingComplete, setMarkingComplete] = useState<string | null>(null);
    // Un SuperAdmin de CSCloudSolutions viendo el tenant de un cliente nunca
    // tiene fila propia en Users de ESE tenant (su cuenta pertenece a su
    // propio dominio corporativo) — el backend correctamente rechaza con 409
    // cualquier intento de completar un módulo porque no hay a quién
    // atribuirle el progreso. Antes el botón quedaba activo igual y fallaba
    // en silencio (bug reportado: "los botones no completan el paso").
    // La Academia es un requisito para usuarios reales del tenant, no para
    // staff que solo está inspeccionando la cuenta — se deshabilita la
    // interacción y se explica por qué en vez de dejar un botón roto.
    const isSuperAdminViewing = systemRole === 'SUPERADMIN';

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!res.ok) throw new Error(t("errors.loadFailed"));
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id)))
            ? `/api/academy/content?tenantId=${selectedTenant.id}&locale=${locale}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const handleMarkComplete = async (moduleId: string) => {
        setMarkingComplete(moduleId);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);

            const response = await fetch(`/api/academy/content`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ tenantId: selectedTenant?.id, moduleId })
            });

            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error || t("errors.saveProgressFailed"));
            }

            toast.success(t("toasts.lessonCompleted"));
            mutate(); // Refresh progress
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setMarkingComplete(null);
        }
    };

    // Componentes de render para el markdown de la Academia. Reemplaza el
    // parser manual + dangerouslySetInnerHTML (XSS A-1): ReactMarkdown escapa
    // cualquier HTML embebido y no usamos rehype-raw, así que el contenido del
    // módulo no puede inyectar scripts aunque provenga de la DB.
    const mdComponents = {
        h3: (props: any) => <h3 className="text-xl font-bold text-gray-900 dark:text-white mt-4 mb-2" {...props} />,
        h4: (props: any) => <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-1" {...props} />,
        li: (props: any) => <li className="ml-4 list-disc text-gray-600 dark:text-gray-300" {...props} />,
        p: (props: any) => <p className="mb-2" {...props} />,
    };

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500">{t("loading")}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-100">
                <p className="font-bold">{t("errorPrefix", { message: error.message })}</p>
            </div>
        );
    }

    if (!data) return null;

    const { modules, totalCompleted, isCertified } = data;
    const progressPercentage = (totalCompleted / modules.length) * 100;

    return (
        <div className="max-w-4xl space-y-6">
            {isSuperAdminViewing ? (
                <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/50 rounded-xl p-4 flex items-start gap-3">
                    <GraduationCap className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-sky-800 dark:text-sky-300">
                        <strong>{t("superAdminBanner.title")}</strong> {t("superAdminBanner.body")}
                    </p>
                </div>
            ) : !isCertified && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4 flex items-start gap-3">
                    <GraduationCap className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                        <strong>{t("requiredBanner.title")}</strong> {t("requiredBanner.body", { count: modules.length })}
                    </p>
                </div>
            )}
            {/* Progress Header */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <GraduationCap className="w-6 h-6 text-brand-deep dark:text-brand-bright" />
                            {t("header.title")}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {t("header.subtitle", { completed: totalCompleted, total: modules.length })}
                        </p>
                    </div>
                    {isCertified && (
                        <div className="flex flex-col items-center animate-in zoom-in">
                            <Trophy className="w-10 h-10 text-yellow-500 mb-1 drop-shadow-md" />
                            <span className="text-xs font-bold text-yellow-600 uppercase tracking-widest">{t("certified")}</span>
                            <button
                                onClick={() => {
                                    // Marca la certificación en el contexto ANTES de navegar, para
                                    // que el efecto de TenantProvider que fuerza el redirect a
                                    // /academy no dispare un loop mientras el remount todavía no
                                    // hizo el refetch de /api/academy/content.
                                    setAcademyCertified(true);
                                    router.push(`/${locale}`);
                                }}
                                className="mt-2 px-3 py-1.5 bg-brand-deep text-white text-xs font-bold rounded hover:bg-brand-bright shadow-sm transition-colors"
                            >
                                {t("enterSaaS")}
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
                                                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{t("moduleLabel", { number: index + 1 })}</span>
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
                                            disabled={markingComplete === mod.id || isSuperAdminViewing}
                                            title={isSuperAdminViewing ? t("superAdminTooltip") : undefined}
                                            className="px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-bold rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {markingComplete === mod.id ? t("saving") : t("markComplete")}
                                        </button>
                                    )}
                                </div>

                                <div className="mt-6 pt-6 border-t border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                        {mod.content}
                                    </ReactMarkdown>
                                </div>

                                {/* Intelligent Onboarding Suggestion */}
                                {mod.suggestOnboardingScript && isFirstModuleCompleted && (
                                    <div className="mt-6 bg-brand-deep/5 dark:bg-brand-deep/10 border border-brand-deep/20 rounded-lg p-5 animate-in fade-in">
                                        <div className="flex items-center gap-3 mb-2">
                                            <Terminal className="w-5 h-5 text-brand-deep dark:text-brand-bright" />
                                            <h4 className="font-bold text-gray-900 dark:text-white">{t("onboardingSuggestion.title")}</h4>
                                        </div>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                                            {t("onboardingSuggestion.body")}
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
