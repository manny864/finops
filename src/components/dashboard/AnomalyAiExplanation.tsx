"use client";
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { useMsal } from '@azure/msal-react';
import { Loader2, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { useProviderTranslations } from '@/lib/useProviderTranslations';
import type { AnomalyExplanationResult } from '@/types/anomalyRootCause.types';

type Feedback = 'up' | 'down';

/** Explicación con IA de una anomalía (Fase 1b). Se pide con un clic: cada una puede costar una llamada. */
export default function AnomalyAiExplanation({ tenantId, anomalyId }: { tenantId: string; anomalyId: number | string }) {
    const t = useProviderTranslations('Anomalies');
    const locale = useLocale();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<AnomalyExplanationResult | null>(null);
    const [feedback, setFeedback] = useState<Feedback | null>(null);

    const url = `/api/intelligence/anomalies/${anomalyId}/explanation`;
    const auth = async () => `Bearer ${await getFreshIdToken(instance, accounts[0], ['User.Read'])}`;

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${url}?tenantId=${encodeURIComponent(tenantId)}&locale=${locale}`, {
                headers: { Authorization: await auth() },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setResult(json);
            if (json.aiAvailable) setFeedback(json.feedback);
        } catch {
            setResult({ aiAvailable: false, reason: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const send = async (value: Feedback) => {
        if (!result?.aiAvailable) return;
        const previous = feedback;
        setFeedback(value);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: await auth() },
                body: JSON.stringify({ tenantId, locale, factsHash: result.factsHash, feedback: value }),
            });
            if (!res.ok) throw new Error();
        } catch {
            setFeedback(previous);
        }
    };

    if (!result) {
        return (
            <button
                type="button"
                onClick={load}
                disabled={loading}
                className="mt-2 inline-flex items-center gap-1.5 self-start text-xs font-semibold text-brand-deep dark:text-brand-bright hover:underline disabled:opacity-60"
            >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {loading ? t('aiExplaining') : t('aiExplain')}
            </button>
        );
    }
    if (!result.aiAvailable) return <p className="mt-2 text-xs text-gray-400">{t(`aiReason_${result.reason}`)}</p>;

    return (
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 p-2.5 text-xs">
            <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                <Sparkles className="w-3 h-3" />
                {t('aiGeneratedLabel')}
            </p>
            <p className="text-gray-700 dark:text-gray-300">{result.explanation.summary}</p>
            {result.explanation.causes.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-gray-600 dark:text-gray-400">
                    {result.explanation.causes.map((c, i) => <li key={i}>{c.text}</li>)}
                </ul>
            )}
            <div className="mt-1.5 flex items-center gap-2 text-gray-400">
                <span>{feedback ? t('aiFeedbackThanks') : t('aiFeedbackPrompt')}</span>
                {(['up', 'down'] as const).map((v) => {
                    const Icon = v === 'up' ? ThumbsUp : ThumbsDown;
                    return (
                        <button
                            key={v}
                            type="button"
                            onClick={() => send(v)}
                            aria-label={t(v === 'up' ? 'aiFeedbackUp' : 'aiFeedbackDown')}
                            aria-pressed={feedback === v}
                            className={`p-0.5 rounded hover:text-gray-700 dark:hover:text-gray-200 ${feedback === v ? 'text-brand-deep dark:text-brand-bright' : ''}`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
