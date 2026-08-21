"use client";
import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { IconClock, IconChevronDown, IconChevronUp } from '@tabler/icons-react';

export default function TelemetryDisclaimerBanner({ compact = false }: { compact?: boolean }) {
    const t = useTranslations('TelemetryNotice');
    const [expanded, setExpanded] = useState(false);

    if (compact) {
        return (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 text-xs text-slate-600 dark:text-slate-300">
                <IconClock className="w-4 h-4 text-[#0054A6] dark:text-blue-400 shrink-0" />
                <span className="flex-1">
                    <strong className="text-slate-800 dark:text-slate-200">{t('banner_short_title')}:</strong> {t('banner_short_desc')}
                </span>
            </div>
        );
    }

    return (
        <div className="rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 p-3.5 transition-all text-xs">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <span className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6]/30 text-[#0054A6] dark:text-blue-400 shrink-0 shadow-xs">
                        <IconClock className="w-4 h-4" />
                    </span>
                    <div>
                        <span className="font-bold text-slate-900 dark:text-white">
                            {t('banner_title')}
                        </span>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {t('banner_subtitle')}
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-300 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-all shadow-xs cursor-pointer"
                >
                    <span>{expanded ? t('banner_btn_less') : t('banner_btn_more')}</span>
                    {expanded ? <IconChevronUp className="w-3 h-3" /> : <IconChevronDown className="w-3 h-3" />}
                </button>
            </div>

            {expanded && (
                <div className="mt-3 pt-3 border-t border-blue-100 dark:border-blue-900/30 grid grid-cols-1 md:grid-cols-2 gap-3 animate-in fade-in duration-200">
                    <div className="text-slate-600 dark:text-slate-300">
                        <strong className="text-slate-800 dark:text-slate-200 block mb-1">
                            1. Latencia de facturación (Azure Cost Management)
                        </strong>
                        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {t('banner_expanded_cost')}
                        </p>
                    </div>
                    <div className="text-slate-600 dark:text-slate-300">
                        <strong className="text-slate-800 dark:text-slate-200 block mb-1">
                            2. Telemetría de recursos e inferencia viva
                        </strong>
                        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {t('banner_expanded_live')}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
