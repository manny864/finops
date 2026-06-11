"use client";
import React, { useState } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { useAIContext } from '@/hooks/useAIContext';
import { useTranslations } from 'next-intl';

export default function GlobalCopilot() {
    const [isOpen, setIsOpen] = useState(false);
    const { currentPage, currentDataPayload } = useAIContext();
    const [messages, setMessages] = useState<{role: 'user'|'ai', content: string}[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const t = useTranslations('Copilot');

    React.useEffect(() => {
        const timer = setTimeout(() => {
            setIsOpen(true);
        }, 7000);
        return () => clearTimeout(timer);
    }, []);

    // Auto-fetch summary when opened and there are no messages
    React.useEffect(() => {
        if (!isOpen || messages.length > 0 || !currentDataPayload) return;
        
        const fetchInitialSummary = async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/intelligence/copilot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: `Provide a brief 2-sentence executive summary of the data. Start the response by explicitly stating which module you are analyzing (e.g. "He analizado los datos de la página ${currentPage}").`,
                        pageContext: currentPage,
                        dataPayload: currentDataPayload
                    })
                });
                const json = await res.json();
                if (json.reply) {
                    setMessages([{ role: 'ai', content: json.reply }]);
                }
            } catch(e) {}
            setLoading(false);
        };
        
        fetchInitialSummary();
    }, [isOpen, currentDataPayload, currentPage, messages.length]);

    const handleSend = async () => {
        if (!input.trim() || loading) return;
        const prompt = input;
        setMessages(prev => [...prev, { role: 'user', content: prompt }]);
        setInput("");
        setLoading(true);

        try {
            const res = await fetch('/api/intelligence/copilot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    pageContext: currentPage,
                    dataPayload: currentDataPayload
                })
            });
            const json = await res.json();
            if (json.reply) {
                setMessages(prev => [...prev, { role: 'ai', content: json.reply }]);
            }
        } catch(e) {}
        setLoading(false);
    };

    return (
        <>
            <button 
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-brand-deep to-[#00AEEF] rounded-full shadow-lg flex items-center justify-center text-white hover:scale-105 transition-transform z-50"
            >
                <MessageSquare className="w-6 h-6" />
            </button>

            {isOpen && (
                <div className="fixed bottom-24 right-6 w-96 bg-surface border border-line rounded-2xl shadow-2xl z-50 flex flex-col h-[500px] overflow-hidden animate-in slide-in-from-bottom-5">
                    <div className="bg-brand-deep p-4 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="w-5 h-5 text-white" />
                            <h3 className="text-white font-bold">{t('title')}</h3>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white"><X className="w-5 h-5"/></button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        <div className="bg-surface-2 p-3 rounded-lg text-sm text-ink max-w-[85%]">
                            {t.rich('welcome_message', { page: currentPage, b: (chunks) => <b>{chunks}</b> })}
                        </div>
                        {messages.map((m, i) => (
                            <div key={i} className={`p-3 rounded-lg text-sm max-w-[85%] ${m.role === 'user' ? 'bg-brand text-white ml-auto' : 'bg-surface-2 text-ink mr-auto'}`}>
                                {m.content}
                            </div>
                        ))}
                        {loading && <div className="text-sm text-ink-soft flex items-center"><Loader2 className="w-4 h-4 animate-spin mr-2"/> Thinking...</div>}
                    </div>

                    <div className="p-3 border-t border-line bg-surface flex gap-2">
                        <input 
                            type="text" 
                            className="flex-1 bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm outline-none"
                            placeholder={t('placeholder')}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSend()}
                        />
                        <button onClick={handleSend} disabled={loading} className="p-2 bg-brand text-white rounded-lg"><Send className="w-4 h-4"/></button>
                    </div>
                </div>
            )}
        </>
    );
}
