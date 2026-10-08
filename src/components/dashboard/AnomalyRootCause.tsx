"use client";
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useProviderTranslations } from '@/lib/useProviderTranslations';
import { useCurrency } from '@/components/CurrencyProvider';
import { suggestedActions, type RootCauseAction, type RootCauseFact } from '@/types/anomalyRootCause.types';

const ACTION_HREF: Partial<Record<RootCauseAction, string>> = {
    REVIEW_COMMITMENT_COVERAGE: '/intelligence/optimizacion-y-ahorro/reservas-de-instancias-ris',
    CHECK_SCHEDULING: '/governance/power',
    ASSIGN_OWNER: '/governance/tags',
};

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

/** Hechos de causa raíz (Fase 1a) y acciones deterministas de una anomalía. */
export default function AnomalyRootCause({ facts, hasOwner }: { facts?: RootCauseFact[]; hasOwner: boolean }) {
    const t = useProviderTranslations('Anomalies');
    const { format } = useCurrency();
    const locale = useLocale();
    if (!facts?.length) return null;
    const actions = suggestedActions(facts, hasOwner);

    return (
        <div className="mt-2.5 flex flex-col gap-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{t('rootCauseTitle')}</p>
            {facts.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-bold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300">
                        {t(`factType_${f.type}`)}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">
                        {f.meterName && <span className="font-mono">{f.meterName} · </span>}
                        <span className="font-semibold">{f.serviceName}</span>
                        {f.resourceGroup && <> {t('inRg')} <span className="font-mono">{f.resourceGroup}</span></>}
                    </span>
                    <span className="text-gray-400">
                        +{format(f.delta)} · {t('factVsBaseline', { actual: format(f.actual), baseline: format(f.baseline) })}
                        {f.quantityChangePct !== undefined && <> · {t('factQuantityChange', { pct: signed(f.quantityChangePct) })}</>}
                        {f.unitCostChangePct !== undefined && <> · {t('factUnitCostChange', { pct: signed(f.unitCostChangePct) })}</>}
                    </span>
                </div>
            ))}
            {facts.some((f) => f.meterName) && (
                <p className="text-[10px] text-gray-400">{t('rootCauseScopeNote')}</p>
            )}
            {actions.length > 0 && (
                <>
                    <p className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{t('suggestedActionsTitle')}</p>
                    <ul className="flex flex-col gap-0.5 text-xs text-gray-700 dark:text-gray-300">
                        {actions.map((a) => {
                            const href = ACTION_HREF[a];
                            const label = t(`action_${a}`);
                            return (
                                <li key={a}>
                                    {href
                                        ? <Link href={`/${locale}${href}`} className="text-brand-deep dark:text-brand-bright hover:underline">{label} →</Link>
                                        : label}
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </div>
    );
}
