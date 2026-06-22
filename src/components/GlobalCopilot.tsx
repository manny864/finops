"use client";
import React, { useState } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { useAIContext } from '@/hooks/useAIContext';
import { useTranslations } from 'next-intl';
import FeatureGuard from './FeatureGuard';
import { useTenant } from './TenantProvider';
import { useMsal } from '@azure/msal-react';
import { hasAccess } from '@/lib/tierLogic';
import { getMockDataForRoute, isMockTenant } from '@/lib/mockData';

export default function GlobalCopilot() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const currentTier = (selectedTenant as any).tier || 'Essential';
    const canAccessCopilot = hasAccess(currentTier, 'Professional');
    
    const { currentPage, currentDataPayload, isOpen, setIsOpen, injectedPrompt, triggerCopilotWithPrompt } = useAIContext();
    const [messages, setMessages] = useState<{role: 'user'|'ai', content: string}[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const t = useTranslations('Copilot');

    const getAuthHeaders = async (): Promise<Record<string, string>> => {
        if (accounts.length === 0) return { 'Content-Type': 'application/json' };
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            return {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokenResponse.idToken}`
            };
        } catch (e) {
            return { 'Content-Type': 'application/json' };
        }
    };

    React.useEffect(() => {
        if (!canAccessCopilot) return;
        const timer = setTimeout(() => {
            setIsOpen(true);
        }, 7000);
        return () => clearTimeout(timer);
    }, [setIsOpen, canAccessCopilot]);

    const handleSend = async (overridePrompt?: string) => {
        const promptText = overridePrompt || input;
        if (!promptText.trim() || loading) return;
        setMessages(prev => [...prev, { role: 'user', content: promptText }]);
        if (!overridePrompt) setInput("");
        setLoading(true);

        try {
            if (isMockTenant(selectedTenant.id)) {
                setTimeout(() => {
                    setMessages(prev => [...prev, { role: 'ai', content: "¡Claro! En este entorno de demostración puedo asistirte con simulaciones de optimización FinOps." }]);
                    setLoading(false);
                }, 1000);
                return;
            }
            const headers = await getAuthHeaders();
            const res = await fetch('/api/intelligence/copilot', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    prompt: promptText,
                    pageContext: currentPage,
                    dataPayload: currentDataPayload,
                    tenantId: selectedTenant.id
                })
            });
            const json = await res.json();
            if (json.reply) {
                setMessages(prev => [...prev, { role: 'ai', content: json.reply }]);
            } else if (json.error) {
                setMessages(prev => [...prev, { role: 'ai', content: `⚠️ Error: ${json.details || json.error}` }]);
            }
        } catch(e: any) {
            console.error("[Copilot] Error:", e);
            setMessages(prev => [...prev, { role: 'ai', content: "⚠️ Error de conexión con el servicio de IA." }]);
        }
        setLoading(false);
    };

    React.useEffect(() => {
        if (injectedPrompt) {
            handleSend(injectedPrompt);
            triggerCopilotWithPrompt(null);
        }
    }, [injectedPrompt, triggerCopilotWithPrompt]);

    // Reset chat history when page context changes
    React.useEffect(() => {
        setMessages([]);
    }, [currentPage]);

    // Auto-fetch summary and suggestions when opened and there are no messages
    React.useEffect(() => {
        if (!isOpen || !canAccessCopilot || messages.length > 0 || !currentDataPayload || injectedPrompt) return;
        
        const fetchInitialSummary = async () => {
            setLoading(true);
            try {
                if (isMockTenant(selectedTenant.id)) {
                    const mock = getMockDataForRoute('copilot_history', selectedTenant.id);
                    if (mock?.success) {
                        setMessages((mock.history as {role: 'user'|'ai', content: string}[]) || []);
                    }
                } else {
                    const headers = await getAuthHeaders();
                    const res = await fetch('/api/intelligence/copilot', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            prompt: `He analizado los datos de la página "${currentPage}". Explica brevemente el estado actual reflejado en los datos y proporciona 2 o 3 sugerencias clave o acciones de optimización para esta sección. Responde en español de forma concisa.`,
                            pageContext: currentPage,
                            dataPayload: currentDataPayload,
                            tenantId: selectedTenant.id
                        })
                    });
                    const json = await res.json();
                    if (json.reply) {
                        setMessages([{ role: 'ai', content: json.reply }]);
                    } else if (json.error) {
                        setMessages([{ role: 'ai', content: `⚠️ ${json.details || json.error}` }]);
                    }
                }
            } catch(e: any) {
                console.error("[Copilot] Auto-summary error:", e);
                setMessages([{ role: 'ai', content: "⚠️ No se pudo conectar con el servicio de IA." }]);
            }
            setLoading(false);
        };
        
        fetchInitialSummary();
    }, [isOpen, currentDataPayload, currentPage, messages.length, injectedPrompt]);

    return (
        <>
            <div className="fixed bottom-6 right-6 z-50">
                <FeatureGuard requiredTier="Professional" featureName="FinOps Copilot" className="w-14 h-14">
                    <button 
                        onClick={() => { if (canAccessCopilot) setIsOpen(true); }}
                        className="w-full h-full bg-gradient-to-br from-brand-deep to-[#00AEEF] rounded-full shadow-lg flex items-center justify-center text-white hover:scale-105 transition-transform"
                    >
                        <MessageSquare className="w-6 h-6" />
                    </button>
                </FeatureGuard>
            </div>

            {isOpen && canAccessCopilot && (
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
                            className="flex-1 bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm outline-none placeholder-ink-soft"
                            placeholder={t('placeholder')}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSend()}
                        />
                        <button onClick={() => handleSend()} disabled={loading} className="p-2 bg-brand text-white rounded-lg"><Send className="w-4 h-4"/></button>
                    </div>
                </div>
            )}
        </>
    );
}
