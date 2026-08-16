"use client";
import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { 
    IconClock, 
    IconInfoCircle, 
    IconRefresh, 
    IconCheck, 
    IconX, 
    IconServer, 
    IconDatabase 
} from '@tabler/icons-react';

const STORAGE_KEY = 'cscloudsolutions_telemetry_notice_dismissed_v1';

export default function TelemetryDelayModal({ isAuthenticated }: { isAuthenticated: boolean }) {
    const t = useTranslations('TelemetryNotice');
    const [open, setOpen] = useState(false);
    const [dontShowAgain, setDontShowAgain] = useState(false);

    useEffect(() => {
        if (!isAuthenticated) return;
        try {
            const dismissed = localStorage.getItem(STORAGE_KEY);
            if (!dismissed) {
                // Pequeño retardo para no bloquear la animación de carga inicial
                const timer = setTimeout(() => {
                    setOpen(true);
                }, 1200);
                return () => clearTimeout(timer);
            }
        } catch {
            // Ignorar errores de acceso a localStorage en navegadores restrictivos
        }
    }, [isAuthenticated]);

    const handleClose = () => {
        try {
            if (dontShowAgain) {
                localStorage.setItem(STORAGE_KEY, 'true');
            }
        } catch {}
        setOpen(false);
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full border border-gray-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-5 bg-slate-50 dark:bg-slate-800/70 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="p-2 rounded-xl bg-blue-50 text-[#0054A6] dark:bg-blue-900/30 dark:text-blue-300">
                            <IconClock className="w-5 h-5" />
                        </span>
                        <div>
                            <h3 className="font-bold text-base text-[#1B2A41] dark:text-white font-heading">
                                {t('modal_title')}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {t('modal_subtitle')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 text-slate-600 hover:border-slate-500 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 transition-all cursor-pointer"
                        aria-label="Cerrar"
                    >
                        <IconX className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    <div className="p-3.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 flex items-start gap-3">
                        <IconInfoCircle className="w-5 h-5 text-[#0054A6] dark:text-blue-400 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-slate-900 dark:text-white mb-1">
                                {t('section_costmanagement_title')}
                            </h4>
                            <p className="text-slate-600 dark:text-slate-400">
                                {t('section_costmanagement_desc')}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
                            <div className="flex items-center gap-2 mb-1.5 font-bold text-slate-800 dark:text-slate-200">
                                <IconServer className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                <span>{t('section_arg_title')}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {t('section_arg_desc')}
                            </p>
                        </div>

                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
                            <div className="flex items-center gap-2 mb-1.5 font-bold text-slate-800 dark:text-slate-200">
                                <IconRefresh className="w-4 h-4 text-[#0054A6] dark:text-blue-400" />
                                <span>{t('section_cron_title')}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {t('section_cron_desc')}
                            </p>
                        </div>
                    </div>

                    <div className="pt-2 flex items-center justify-between border-t border-gray-100 dark:border-slate-800">
                        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={dontShowAgain}
                                onChange={(e) => setDontShowAgain(e.target.checked)}
                                className="rounded border-gray-300 text-[#0054A6] focus:ring-[#0054A6] cursor-pointer"
                            />
                            <span>{t('dont_show_again')}</span>
                        </label>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800 flex justify-end">
                    <button
                        onClick={handleClose}
                        className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/30 text-xs font-bold transition-all cursor-pointer shadow-xs"
                    >
                        <IconCheck className="w-4 h-4" />
                        <span>{t('btn_understand')}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
