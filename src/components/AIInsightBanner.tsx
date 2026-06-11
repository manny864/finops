"use client";
import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';

interface Props {
    pageName: string;
    dataPayload: any;
}

export default function AIInsightBanner({ pageName, dataPayload }: Props) {
    const [insight, setInsight] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!dataPayload) return;
        let isMounted = true;
        
        async function fetchInsight() {
            setLoading(true);
            try {
                const res = await fetch('/api/intelligence/copilot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: "Provide a 2-sentence executive summary highlighting the most critical insight from this data.",
                        pageContext: pageName,
                        dataPayload
                    })
                });
                const json = await res.json();
                if (isMounted && json.reply) setInsight(json.reply);
            } catch(e) {}
            if (isMounted) setLoading(false);
        }
        fetchInsight();
        
        return () => { isMounted = false; };
    }, [dataPayload, pageName]);

    if (!insight && !loading) return null;

    return (
        <div className="bg-gradient-to-r from-brand-deep/10 to-emerald-500/10 border border-brand-bright/20 rounded-xl p-4 mb-6 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-brand-bright mt-0.5 shrink-0" />
            <div className="flex-1">
                <h4 className="text-[11px] font-bold uppercase tracking-widest text-brand-deep mb-1">AI Executive Insight</h4>
                {loading ? (
                    <div className="flex items-center text-sm text-ink-soft"><Loader2 className="w-4 h-4 animate-spin mr-2"/> Analyzing metrics...</div>
                ) : (
                    <p className="text-sm text-ink">{insight}</p>
                )}
            </div>
        </div>
    );
}
